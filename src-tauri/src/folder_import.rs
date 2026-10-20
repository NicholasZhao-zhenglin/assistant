//! Local HTML ingestion. Parsing never executes scripts or fetches network URLs.
use crate::{
    model::{Attachment, Entry, FileSource, Snapshot},
    storage::Store,
};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};
use url::Url;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const LIMIT: u64 = 25 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub path: String,
    pub title: String,
    pub sha256: String,
    pub status: String,
    pub detail: String,
}
struct Prepared {
    title: String,
    hash: String,
    files: BTreeMap<String, Vec<u8>>,
    entry: String,
}
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(error)?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 > LIMIT {
        return Err("页面及配套文件合计不能超过 25 MB".into());
    }
    Ok(bytes)
}
fn css_links(text: &str) -> Vec<String> {
    // Covers static url(...) and @import "...". Dynamic JavaScript loads are not inferred.
    let re =
        regex::Regex::new(r#"(?is)url\(\s*["']?([^\s"')]+)["']?\s*\)|@import\s+["']([^"']+)["']"#)
            .unwrap();
    re.captures_iter(text)
        .filter_map(|c| {
            c.get(1)
                .or_else(|| c.get(2))
                .map(|m| m.as_str().to_string())
        })
        .collect()
}
fn prepare(path: &Path) -> Result<Prepared, String> {
    let path = path.canonicalize().map_err(error)?;
    let root = path.parent().ok_or("目录无效")?;
    let entry = path
        .file_name()
        .ok_or("文件名无效")?
        .to_string_lossy()
        .to_string();
    if !matches!(
        path.extension()
            .and_then(|x| x.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("html" | "htm")
    ) {
        return Err("请选择 HTML 文件".into());
    }
    let mut pending = vec![path.clone()];
    let mut files = BTreeMap::new();
    let mut title = path.file_stem().unwrap().to_string_lossy().to_string();
    let mut total = 0;
    while let Some(file) = pending.pop() {
        let canonical = file
            .canonicalize()
            .map_err(|e| format!("配套文件无法读取：{}（{e}）", file.display()))?;
        if !canonical.starts_with(root) {
            return Err("配套文件位于页面目录外，请先将其整理到同一目录".into());
        }
        let relative = file
            .strip_prefix(root)
            .map_err(error)?
            .to_string_lossy()
            .to_string();
        if files.contains_key(&relative) {
            continue;
        }
        if files.len() >= 500 {
            return Err("单个页面配套文件超过 500 个".into());
        }
        let bytes = read_limited(&canonical)?;
        total += bytes.len() as u64;
        if total > LIMIT {
            return Err("页面及配套文件合计不能超过 25 MB".into());
        }
        let ext = file
            .extension()
            .and_then(|x| x.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mut links = Vec::new();
        if ext == "html" || ext == "htm" {
            let text =
                std::str::from_utf8(&bytes).map_err(|_| "仅支持 UTF-8 HTML，请先转换编码")?;
            let doc = Html::parse_document(text);
            if doc
                .select(&Selector::parse("base[href]").unwrap())
                .next()
                .is_some()
            {
                return Err("页面包含 base 地址，请先导出为独立 HTML".into());
            }
            if file == path {
                if let Some(t) = doc.select(&Selector::parse("title").unwrap()).next() {
                    let extracted = t
                        .text()
                        .collect::<String>()
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" ");
                    if !extracted.is_empty() {
                        title = extracted;
                    }
                }
            }
            for element in doc.select(
                &Selector::parse("[src], link[href], [poster], [data], [srcset], [style], style")
                    .unwrap(),
            ) {
                for attr in ["src", "href", "poster", "data"] {
                    if let Some(value) = element.value().attr(attr) {
                        links.push(value.to_string());
                    }
                }
                if let Some(srcset) = element.value().attr("srcset") {
                    if !srcset.trim().starts_with("data:") {
                        links.extend(
                            srcset
                                .split(',')
                                .filter_map(|x| x.split_whitespace().next())
                                .map(String::from),
                        );
                    }
                }
                if let Some(style) = element.value().attr("style") {
                    links.extend(css_links(style));
                }
                if element.value().name() == "style" {
                    links.extend(css_links(&element.text().collect::<String>()));
                }
            }
        } else if ext == "css" {
            links.extend(css_links(&String::from_utf8_lossy(&bytes)));
        }
        let base = Url::from_file_path(&file).map_err(|_| "文件路径无效")?;
        for value in links {
            let value = value.trim();
            if value.is_empty() || value.starts_with('#') || value.starts_with("//") {
                continue;
            }
            let mut resolved = base.join(value).map_err(error)?;
            if resolved.scheme() != "file" {
                continue;
            }
            if value.starts_with('/') || value.starts_with("file:") {
                return Err("页面包含绝对本地资源地址，请先改为相对路径".into());
            }
            resolved.set_query(None);
            resolved.set_fragment(None);
            let dep = resolved.to_file_path().map_err(|_| "配套文件路径无效")?;
            if !dep.starts_with(root) {
                return Err("配套文件位于页面目录外".into());
            }
            pending.push(dep);
        }
        files.insert(relative, bytes);
    }
    let mut hash = Sha256::new();
    // Main filename is excluded so identical standalone pages renamed elsewhere deduplicate.
    for (name, bytes) in &files {
        let key = if name == &entry { "__main__" } else { name };
        hash.update((key.len() as u64).to_le_bytes());
        hash.update(key.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    Ok(Prepared {
        title: title.chars().take(300).collect(),
        hash: format!("{:x}", hash.finalize()),
        files,
        entry,
    })
}
fn status(snapshot: &Snapshot, path: &str, hash: &str) -> &'static str {
    if let Some(e) = snapshot
        .entries
        .iter()
        .find(|e| e.file_source.as_ref().is_some_and(|s| s.path == path))
    {
        let source = e.file_source.as_ref().unwrap();
        return if source.sha256 == hash && e.attachments.contains(&source.attachment_id) {
            "duplicate"
        } else {
            "update"
        };
    }
    if snapshot.entries.iter().any(|e| {
        e.file_source
            .as_ref()
            .is_some_and(|s| s.sha256 == hash && e.attachments.contains(&s.attachment_id))
    }) {
        "duplicate"
    } else {
        "new"
    }
}
impl Store {
    pub fn scan_folder(&self, directory: &Path) -> Result<Vec<Candidate>, String> {
        let directory = directory.canonicalize().map_err(error)?;
        let snapshot = self.snapshot()?;
        let mut paths = Vec::new();
        // Deliberately top-level only: never silently crawl unrelated subdirectories.
        for item in fs::read_dir(directory).map_err(error)? {
            let item = item.map_err(error)?;
            if !item.file_type().map_err(error)?.is_file() {
                continue;
            }
            let path = item.path();
            if matches!(
                path.extension()
                    .and_then(|x| x.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("html" | "htm")
            ) {
                paths.push(path);
            }
            if paths.len() > 1000 {
                return Err("目录超过 1000 份 HTML，请分目录整理".into());
            }
        }
        paths.sort();
        Ok(paths
            .into_iter()
            .map(|path| {
                let source = path.to_string_lossy().to_string();
                match prepare(&path) {
                    Ok(p) => Candidate {
                        status: status(&snapshot, &source, &p.hash).into(),
                        path: source,
                        title: p.title,
                        sha256: p.hash,
                        detail: format!("{} 个文件（含页面）", p.files.len()),
                    },
                    Err(detail) => Candidate {
                        path: source,
                        title: path.file_name().unwrap().to_string_lossy().into(),
                        sha256: String::new(),
                        status: "error".into(),
                        detail,
                    },
                }
            })
            .collect())
    }
    pub fn import_html(&mut self, selected: Vec<Candidate>) -> Result<Snapshot, String> {
        if selected.is_empty() || selected.len() > 1000 {
            return Err("请选择 1–1000 份资料".into());
        }
        let mut snapshot = self.snapshot()?;
        let mut written = Vec::new();
        let result = (|| {
            for candidate in selected {
                let path = PathBuf::from(&candidate.path)
                    .canonicalize()
                    .map_err(error)?;
                let source_path = path.to_string_lossy().to_string();
                let p = prepare(&path)?;
                if p.hash != candidate.sha256 {
                    return Err(format!("文件在预览后发生变化，请重新扫描：{}", p.title));
                }
                if status(&snapshot, &source_path, &p.hash) == "duplicate" {
                    continue;
                }
                let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
                for (name, bytes) in &p.files {
                    zip.start_file(
                        name,
                        SimpleFileOptions::default()
                            .compression_method(zip::CompressionMethod::Deflated),
                    )
                    .map_err(error)?;
                    zip.write_all(bytes).map_err(error)?;
                }
                let bytes = zip.finish().map_err(error)?.into_inner();
                if bytes.len() as u64 > LIMIT {
                    return Err("打包后的资料超过 25 MB".into());
                }
                let a = Attachment {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: format!("{}.zip", p.entry),
                    size: bytes.len() as u64,
                    sha256: format!("{:x}", Sha256::digest(&bytes)),
                    entry_point: Some(p.entry),
                };
                let destination = self.attachment_path(&a);
                fs::create_dir_all(destination.parent().unwrap()).map_err(error)?;
                written.push(destination.parent().unwrap().to_path_buf());
                fs::write(destination, bytes).map_err(error)?;
                let source = FileSource {
                    path: source_path,
                    sha256: p.hash,
                    attachment_id: a.id.clone(),
                };
                let now = chrono::Utc::now().to_rfc3339();
                if let Some(entry) = snapshot.entries.iter_mut().find(|e| {
                    e.file_source
                        .as_ref()
                        .is_some_and(|s| s.path == source.path)
                }) {
                    let old_id = &entry.file_source.as_ref().unwrap().attachment_id;
                    entry.attachments.retain(|id| id != old_id);
                    entry.attachments.push(a.id.clone());
                    entry.file_source = Some(source);
                    entry.updated_at = now;
                } else {
                    snapshot.entries.insert(
                        0,
                        Entry {
                            id: uuid::Uuid::new_v4().to_string(),
                            kind: "resource".into(),
                            title: p.title,
                            body: String::new(),
                            status: "saved".into(),
                            project_id: None,
                            action_id: None,
                            source_id: None,
                            due: None,
                            start: None,
                            end: None,
                            all_day: false,
                            is_next: false,
                            focused: false,
                            archived: false,
                            tags: vec!["HTML".into()],
                            attachments: vec![a.id.clone()],
                            created_at: now.clone(),
                            updated_at: now,
                            file_source: Some(source),
                        },
                    );
                }
                snapshot.attachments.push(a);
            }
            self.commit(&snapshot)?;
            Ok(snapshot)
        })();
        if result.is_err() {
            for directory in written {
                let _ = fs::remove_dir_all(directory);
            }
        }
        result
    }
    pub fn openable_path(&self, a: &Attachment) -> Result<PathBuf, String> {
        let Some(entry) = &a.entry_point else {
            return Ok(self.attachment_path(a));
        };
        if Path::new(entry).components().count() != 1
            || entry == "."
            || entry == ".."
            || entry.contains(['/', '\\'])
        {
            return Err("页面入口无效".into());
        }
        let bytes = read_limited(&self.attachment_path(a))?;
        if format!("{:x}", Sha256::digest(&bytes)) != a.sha256 {
            return Err("页面附件校验失败".into());
        }
        let mut zip = ZipArchive::new(Cursor::new(bytes)).map_err(error)?;
        if zip.len() > 500 {
            return Err("页面文件数量超限".into());
        }
        let mut validated = Vec::new();
        let mut total = 0;
        for i in 0..zip.len() {
            let mut file = zip.by_index(i).map_err(error)?;
            let name = file.enclosed_name().ok_or("页面包路径无效")?;
            if file.is_dir()
                || file
                    .unix_mode()
                    .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("页面包不能包含目录或符号链接项".into());
            }
            total += file.size();
            if total > LIMIT {
                return Err("页面解压大小超限".into());
            }
            let mut content = Vec::new();
            (&mut file)
                .take(LIMIT + 1)
                .read_to_end(&mut content)
                .map_err(error)?;
            if content.len() as u64 != file.size() {
                return Err("页面文件大小不符".into());
            }
            validated.push((name, content));
        }
        // Fresh extraction avoids trusting an old browser-modifiable cache or symlinks.
        let directory = self
            .root
            .join("html-cache")
            .join(uuid::Uuid::new_v4().to_string());
        for (name, content) in validated {
            let dest = directory.join(name);
            fs::create_dir_all(dest.parent().unwrap()).map_err(error)?;
            fs::write(dest, content).map_err(error)?;
        }
        let result = directory.join(entry);
        if !result.is_file() {
            return Err("页面入口缺失".into());
        }
        Ok(result)
    }
}
