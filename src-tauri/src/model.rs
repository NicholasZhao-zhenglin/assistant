use chrono::{DateTime, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    #[serde(default)]
    pub file_source: Option<FileSource>,
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub status: String,
    pub project_id: Option<String>,
    pub action_id: Option<String>,
    pub source_id: Option<String>,
    pub due: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub all_day: bool,
    pub is_next: bool,
    pub focused: bool,
    pub archived: bool,
    pub tags: Vec<String>,
    pub attachments: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSource {
    pub path: String,
    pub sha256: String,
    pub attachment_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    #[serde(default)]
    pub entry_point: Option<String>,
    pub id: String,
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub entries: Vec<Entry>,
    pub attachments: Vec<Attachment>,
}

pub fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok()
}

pub fn validate(s: &Snapshot) -> Result<(), String> {
    let mut ids = HashSet::new();
    for a in &s.attachments {
        if let Some(entry) = &a.entry_point {
            let lower = entry.to_ascii_lowercase();
            if entry.contains(['/', '\\', '\0'])
                || !(lower.ends_with(".html") || lower.ends_with(".htm"))
            {
                return Err("HTML 附件入口无效".into());
            }
        }
        if !valid_id(&a.id)
            || !ids.insert(a.id.clone())
            || a.name.is_empty()
            || a.name == "."
            || a.name == ".."
            || a.name.contains(['/', '\\', '\0'])
            || a.size > 25 * 1024 * 1024
            || a.sha256.len() != 64
        {
            return Err("附件元数据无效（每个附件最大 25 MB）".into());
        }
    }
    ids.clear();
    for e in &s.entries {
        if !valid_id(&e.id) || !ids.insert(e.id.clone()) {
            return Err("记录标识无效或重复".into());
        }
        if e.title.trim().is_empty() || e.title.chars().count() > 300 || e.body.len() > 1_000_000 {
            return Err("请填写标题（不超过 300 字），正文不能超过 1 MB".into());
        }
        let statuses: &[&str] = match e.kind.as_str() {
            "inbox" => &["pending", "processed"],
            "project" => &["active", "paused", "done"],
            "action" => &["todo", "waiting", "done"],
            "event" => &["planned", "done"],
            "resource" => &["saved"],
            _ => return Err("未知记录类型".into()),
        };
        if !statuses.contains(&e.status.as_str()) {
            return Err("记录状态无效".into());
        }
        for stamp in [&e.created_at, &e.updated_at] {
            DateTime::parse_from_rfc3339(stamp).map_err(|_| "时间戳无效")?;
        }
        if let Some(due) = &e.due {
            NaiveDate::parse_from_str(due, "%Y-%m-%d").map_err(|_| "日期格式无效")?;
        }
        if e.kind == "event" {
            if e.all_day {
                if e.due.is_none() {
                    return Err("全天日程需要选择日期".into());
                }
            } else {
                let start =
                    DateTime::parse_from_rfc3339(e.start.as_deref().ok_or("请选择开始时间")?)
                        .map_err(|_| "开始时间无效")?;
                let end = DateTime::parse_from_rfc3339(e.end.as_deref().ok_or("请选择结束时间")?)
                    .map_err(|_| "结束时间无效")?;
                if end <= start {
                    return Err("结束时间必须晚于开始时间".into());
                }
            }
        }
        for (reference, kind) in [
            (&e.project_id, "project"),
            (&e.action_id, "action"),
            (&e.source_id, "inbox"),
        ] {
            if let Some(id) = reference {
                if id == &e.id || !s.entries.iter().any(|x| &x.id == id && x.kind == kind) {
                    return Err(format!("关联的 {kind} 不存在"));
                }
            }
        }
        if let Some(source) = &e.file_source {
            if e.kind != "resource" || source.sha256.len() != 64 {
                return Err("文件来源无效".into());
            }
        }
        if e.attachments
            .iter()
            .any(|id| !s.attachments.iter().any(|a| &a.id == id))
        {
            return Err("附件不存在".into());
        }
    }
    Ok(())
}
