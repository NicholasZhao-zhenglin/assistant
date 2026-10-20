use crate::model::{validate, Attachment, Entry, Snapshot};
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub struct Store {
    pub root: PathBuf,
    conn: Connection,
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Backup {
    format: String,
    version: u32,
    snapshot: Snapshot,
}
const MAX_BACKUP: u64 = 512 * 1024 * 1024;

impl Store {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("attachments")).map_err(err)?;
        let conn = Connection::open(root.join("assistant.sqlite3")).map_err(err)?;
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
        )
        .map_err(err)?;
        let version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(err)?;
        if version > 1 {
            return Err("数据库来自更新版本，请升级应用".into());
        }
        if version == 0 {
            conn.execute_batch(include_str!("../migrations/001_initial.sql"))
                .map_err(err)?;
        }
        Ok(Self { root, conn })
    }
    pub fn snapshot(&self) -> Result<Snapshot, String> {
        fn rows<T: serde::de::DeserializeOwned>(
            conn: &Connection,
            sql: &str,
        ) -> Result<Vec<T>, String> {
            let mut stmt = conn.prepare(sql).map_err(err)?;
            let items = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(err)?;
            items
                .map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
                .collect()
        }
        Ok(Snapshot {
            entries: rows(&self.conn, "SELECT data FROM entries ORDER BY rowid DESC")?,
            attachments: rows(&self.conn, "SELECT data FROM attachments")?,
        })
    }
    pub(crate) fn commit(&mut self, s: &Snapshot) -> Result<(), String> {
        validate(s)?;
        let tx = self.conn.transaction().map_err(err)?;
        tx.execute("DELETE FROM entries", []).map_err(err)?;
        tx.execute("DELETE FROM attachments", []).map_err(err)?;
        for a in &s.attachments {
            tx.execute(
                "INSERT INTO attachments(id,data) VALUES(?1,?2)",
                params![a.id, serde_json::to_string(a).map_err(err)?],
            )
            .map_err(err)?;
        }
        for e in s.entries.iter().rev() {
            tx.execute(
                "INSERT INTO entries(id,kind,project_id,data) VALUES(?1,?2,?3,?4)",
                params![
                    e.id,
                    e.kind,
                    e.project_id,
                    serde_json::to_string(e).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn save(&mut self, mut e: Entry) -> Result<Snapshot, String> {
        let mut s = self.snapshot()?;
        let now = chrono::Utc::now().to_rfc3339();
        e.updated_at = now.clone();
        if let Some(old) = s.entries.iter_mut().find(|x| x.id == e.id) {
            if old.kind != e.kind || old.source_id != e.source_id {
                return Err("不能改变记录类型或来源".into());
            }
            if old.kind == "inbox" && old.status != e.status {
                return Err("请通过整理操作处理收件".into());
            }
            if old.kind == "inbox"
                && old.status == "processed"
                && (old.title != e.title || old.body != e.body || old.attachments != e.attachments)
            {
                return Err("已整理的收件保留原文，请修改整理后的记录".into());
            }
            e.file_source = old.file_source.clone();
            e.created_at = old.created_at.clone();
            *old = e;
        } else {
            if e.kind == "inbox" && e.status != "pending" {
                return Err("新收件必须为待处理状态".into());
            }
            e.created_at = now;
            s.entries.insert(0, e);
        }
        self.commit(&s)?;
        Ok(s)
    }
    pub fn triage(
        &mut self,
        source_id: &str,
        mut destinations: Vec<Entry>,
    ) -> Result<Snapshot, String> {
        let mut s = self.snapshot()?;
        let source = s
            .entries
            .iter_mut()
            .find(|x| x.id == source_id && x.kind == "inbox")
            .ok_or("收件不存在")?;
        if source.status != "pending" || source.archived {
            return Err("这条收件已经处理，请刷新列表".into());
        }
        if destinations.is_empty() {
            return Err("请至少选择一个整理结果，或直接归档收件".into());
        }
        source.status = "processed".into();
        source.updated_at = chrono::Utc::now().to_rfc3339();
        for d in &mut destinations {
            if d.kind == "inbox" || s.entries.iter().any(|x| x.id == d.id) {
                return Err("整理目标无效或已存在".into());
            }
            d.source_id = Some(source_id.into());
            d.created_at = chrono::Utc::now().to_rfc3339();
            d.updated_at = d.created_at.clone();
        }
        s.entries.splice(0..0, destinations);
        self.commit(&s)?;
        Ok(s)
    }
    pub fn import_file(&mut self, path: &Path) -> Result<Attachment, String> {
        let meta = fs::metadata(path).map_err(err)?;
        if !meta.is_file() || meta.len() > 25 * 1024 * 1024 {
            return Err("请选择不超过 25 MB 的文件".into());
        }
        let bytes = fs::read(path).map_err(err)?;
        let a = Attachment {
            entry_point: None,
            id: uuid::Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .ok_or("文件名无效")?
                .to_string_lossy()
                .into(),
            size: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        let mut s = self.snapshot()?;
        s.attachments.push(a.clone());
        validate(&s)?;
        let dest = self.attachment_path(&a);
        fs::create_dir_all(dest.parent().unwrap()).map_err(err)?;
        fs::write(dest, bytes).map_err(err)?;
        self.commit(&s)?;
        Ok(a)
    }
    pub fn attachment_path(&self, a: &Attachment) -> PathBuf {
        self.root.join("attachments").join(&a.id).join(&a.name)
    }
    pub fn backup(&self, path: &Path) -> Result<(), String> {
        let backup = Backup {
            format: "qixu-assistant".into(),
            version: 1,
            snapshot: self.snapshot()?,
        };
        let manifest = serde_json::to_vec(&backup).map_err(err)?;
        if manifest.len() > 16 * 1024 * 1024
            || backup
                .snapshot
                .attachments
                .iter()
                .map(|a| a.size)
                .sum::<u64>()
                > MAX_BACKUP - 32 * 1024 * 1024
        {
            return Err("数据超过当前备份上限（清单 16 MB，附件合计 480 MB）".into());
        }
        if path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("assistant.sqlite3"))
        {
            return Err("备份文件不能使用数据库文件名".into());
        }
        let parent = path.parent().ok_or("备份路径无效")?;
        let temp = parent.join(format!(".assistant-backup-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut zip = ZipWriter::new(fs::File::create(&temp).map_err(err)?);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zip.start_file("manifest.json", options).map_err(err)?;
            zip.write_all(&manifest).map_err(err)?;
            for a in &backup.snapshot.attachments {
                let bytes = fs::read(self.attachment_path(a)).map_err(err)?;
                if bytes.len() as u64 != a.size
                    || format!("{:x}", Sha256::digest(&bytes)) != a.sha256
                {
                    return Err(format!("附件校验失败：{}", a.name));
                }
                zip.start_file(format!("attachments/{}", a.id), options)
                    .map_err(err)?;
                zip.write_all(&bytes).map_err(err)?;
            }
            zip.finish().map_err(err)?.sync_all().map_err(err)?;
            fs::rename(&temp, path).map_err(err)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
    pub fn restore(&mut self, path: &Path) -> Result<Snapshot, String> {
        if fs::metadata(path).map_err(err)?.len() > MAX_BACKUP {
            return Err("备份超过 512 MB，无法恢复".into());
        }
        let mut zip = ZipArchive::new(fs::File::open(path).map_err(err)?).map_err(err)?;
        let manifest = zip.by_name("manifest.json").map_err(err)?;
        if manifest.size() > 16 * 1024 * 1024 {
            return Err("备份清单过大".into());
        }
        let b: Backup = serde_json::from_reader(manifest).map_err(err)?;
        if b.format != "qixu-assistant" || b.version != 1 {
            return Err("不支持的备份格式或版本".into());
        }
        validate(&b.snapshot)?;
        let mut total = 0;
        let mut files = Vec::new();
        for a in &b.snapshot.attachments {
            let f = zip.by_name(&format!("attachments/{}", a.id)).map_err(err)?;
            total += f.size();
            if f.size() != a.size || total > MAX_BACKUP {
                return Err("附件大小校验失败".into());
            }
            let mut bytes = Vec::new();
            f.take(25 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(err)?;
            if bytes.len() as u64 != a.size || format!("{:x}", Sha256::digest(&bytes)) != a.sha256 {
                return Err("附件内容校验失败".into());
            }
            files.push((a.clone(), bytes));
        }
        // Keep a recoverable copy before replacing any current data.
        let safety = self.root.join("before-restore.assistant-backup");
        self.backup(&safety)?;
        // New attachment IDs ensure failed restores cannot overwrite current attachments.
        let mut snapshot = b.snapshot;
        for (old, bytes) in files {
            let new_id = uuid::Uuid::new_v4().to_string();
            let metadata = snapshot
                .attachments
                .iter_mut()
                .find(|a| a.id == old.id)
                .unwrap();
            metadata.id = new_id.clone();
            let dest = self.attachment_path(metadata);
            fs::create_dir_all(dest.parent().unwrap()).map_err(err)?;
            fs::write(dest, bytes).map_err(err)?;
            for e in &mut snapshot.entries {
                if let Some(source) = &mut e.file_source {
                    if source.attachment_id == old.id {
                        source.attachment_id = new_id.clone();
                    }
                }
                for id in &mut e.attachments {
                    if *id == old.id {
                        *id = new_id.clone();
                    }
                }
            }
        }
        self.commit(&snapshot)?;
        Ok(snapshot)
    }
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
