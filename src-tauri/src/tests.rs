use crate::{model::Entry, storage::Store};
use std::fs;
use tempfile::tempdir;
fn item(kind: &str, title: &str) -> Entry {
    let now = chrono::Utc::now().to_rfc3339();
    Entry {
        file_source: None,
        id: uuid::Uuid::new_v4().to_string(),
        kind: kind.into(),
        title: title.into(),
        body: String::new(),
        status: match kind {
            "inbox" => "pending",
            "project" => "active",
            "action" => "todo",
            "event" => "planned",
            _ => "saved",
        }
        .into(),
        project_id: None,
        action_id: None,
        source_id: None,
        due: None,
        start: None,
        end: None,
        all_day: false,
        is_next: kind == "action",
        focused: false,
        archived: false,
        tags: vec![],
        attachments: vec![],
        created_at: now.clone(),
        updated_at: now,
    }
}
#[test]
fn triage_is_atomic_and_rejects_duplicates() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().into()).unwrap();
    let inbox = item("inbox", "准备汇报");
    store.save(inbox.clone()).unwrap();
    let project = item("project", "完成汇报");
    let mut action = item("action", "整理数据");
    action.project_id = Some(project.id.clone());
    let result = store
        .triage(&inbox.id, vec![project.clone(), action.clone()])
        .unwrap();
    assert_eq!(result.entries.len(), 3);
    assert_eq!(
        result
            .entries
            .iter()
            .find(|e| e.id == inbox.id)
            .unwrap()
            .status,
        "processed"
    );
    assert!(store
        .triage(&inbox.id, vec![item("action", "重复")])
        .is_err());
    drop(store);
    let reopened = Store::new(dir.path().into()).unwrap();
    let s = reopened.snapshot().unwrap();
    assert_eq!(s.entries.len(), 3);
    assert_eq!(
        s.entries
            .iter()
            .find(|e| e.id == action.id)
            .unwrap()
            .project_id,
        Some(project.id)
    );
}
#[test]
fn failed_triage_keeps_original_pending() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().into()).unwrap();
    let inbox = item("inbox", "原始内容");
    store.save(inbox.clone()).unwrap();
    let mut invalid = item("action", "失败目标");
    invalid.project_id = Some(uuid::Uuid::new_v4().to_string());
    assert!(store.triage(&inbox.id, vec![invalid]).is_err());
    let s = store.snapshot().unwrap();
    assert_eq!(s.entries.len(), 1);
    assert_eq!(s.entries[0].status, "pending");
}
#[test]
fn archive_preserves_project_and_resource_links() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().into()).unwrap();
    let mut project = item("project", "项目");
    store.save(project.clone()).unwrap();
    let mut resource = item("resource", "资料");
    resource.project_id = Some(project.id.clone());
    store.save(resource).unwrap();
    project.archived = true;
    store.save(project.clone()).unwrap();
    project.archived = false;
    let s = store.save(project.clone()).unwrap();
    assert_eq!(
        s.entries
            .iter()
            .find(|e| e.kind == "resource")
            .unwrap()
            .project_id,
        Some(project.id)
    );
}
#[test]
fn backup_restores_records_and_attachments_to_a_new_workspace() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().join("one")).unwrap();
    let file = dir.path().join("笔记.txt");
    fs::write(&file, "可靠的离线资料").unwrap();
    let a = store.import_file(&file).unwrap();
    let mut r = item("resource", "本地笔记");
    r.attachments.push(a.id);
    store.save(r).unwrap();
    let backup = dir.path().join("copy.assistant-backup");
    store.backup(&backup).unwrap();
    fs::remove_file(file).unwrap();
    let mut other = Store::new(dir.path().join("two")).unwrap();
    let s = other.restore(&backup).unwrap();
    assert_eq!(s.entries.len(), 1);
    assert_eq!(s.attachments.len(), 1);
    assert_eq!(s.entries[0].attachments[0], s.attachments[0].id);
    assert_eq!(
        fs::read_to_string(other.attachment_path(&s.attachments[0])).unwrap(),
        "可靠的离线资料"
    );
    assert!(dir
        .path()
        .join("two/before-restore.assistant-backup")
        .exists());
}
#[test]
fn corrupt_backup_does_not_replace_current_data() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().join("data")).unwrap();
    store.save(item("inbox", "不能丢失")).unwrap();
    let broken = dir.path().join("broken.assistant-backup");
    fs::write(&broken, b"not a zip").unwrap();
    assert!(store.restore(&broken).is_err());
    assert_eq!(store.snapshot().unwrap().entries[0].title, "不能丢失");
}
#[test]
fn incomplete_or_reversed_events_are_rejected() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().into()).unwrap();
    let mut e = item("event", "会议");
    assert!(store.save(e.clone()).is_err());
    e.start = Some("2026-10-13T12:00:00+08:00".into());
    e.end = Some("2026-10-13T11:00:00+08:00".into());
    assert!(store.save(e.clone()).is_err());
    e.all_day = true;
    e.due = Some("2026-10-13".into());
    assert!(store.save(e).is_ok());
}

#[test]
fn processed_inbox_remains_an_immutable_source() {
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().into()).unwrap();
    let source = item("inbox", "原始标题");
    store.save(source.clone()).unwrap();
    let s = store
        .triage(&source.id, vec![item("action", "下一步")])
        .unwrap();
    let mut changed = s
        .entries
        .iter()
        .find(|e| e.id == source.id)
        .unwrap()
        .clone();
    changed.body = "试图覆盖原文".into();
    assert!(store.save(changed).is_err());
    let mut original = store
        .snapshot()
        .unwrap()
        .entries
        .into_iter()
        .find(|e| e.id == source.id)
        .unwrap();
    original.archived = true;
    assert!(store.save(original).is_ok());
}

#[test]
fn tampered_attachment_is_rejected_before_data_replacement() {
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};
    let dir = tempdir().unwrap();
    let mut store = Store::new(dir.path().join("data")).unwrap();
    let source = dir.path().join("document.txt");
    fs::write(&source, b"good").unwrap();
    let a = store.import_file(&source).unwrap();
    store.save(item("inbox", "保留现状")).unwrap();
    let manifest = serde_json::json!({"format":"qixu-assistant","version":1,"snapshot":store.snapshot().unwrap()});
    let path = dir.path().join("tampered.assistant-backup");
    let mut zip = ZipWriter::new(fs::File::create(&path).unwrap());
    zip.start_file("manifest.json", SimpleFileOptions::default())
        .unwrap();
    zip.write_all(&serde_json::to_vec(&manifest).unwrap())
        .unwrap();
    zip.start_file(
        format!("attachments/{}", a.id),
        SimpleFileOptions::default(),
    )
    .unwrap();
    zip.write_all(b"evil").unwrap();
    zip.finish().unwrap();
    assert!(store.restore(&path).is_err());
    assert_eq!(store.snapshot().unwrap().entries[0].title, "保留现状");
    assert_eq!(fs::read(store.attachment_path(&a)).unwrap(), b"good");
}

#[test]
fn html_import_deduplicates_updates_and_preserves_user_fields() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("pages");
    fs::create_dir(&source).unwrap();
    let file = source.join("one.html");
    fs::write(&file, "<title>RAG &amp; 检索</title><p>v1</p>").unwrap();
    fs::write(source.join("copy.HTML"), fs::read(&file).unwrap()).unwrap();
    let data = dir.path().join("data");
    let mut store = Store::new(data.clone()).unwrap();
    let rows = store.scan_folder(&source).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].title, "RAG & 检索");
    let s = store.import_html(rows).unwrap();
    assert_eq!(s.entries.len(), 1);
    assert!(store
        .scan_folder(&source)
        .unwrap()
        .iter()
        .all(|c| c.status == "duplicate"));
    // Modify the actual recorded source, whichever sorted name was imported first.
    let mut e = s.entries[0].clone();
    let original = e.file_source.as_ref().unwrap().path.clone();
    e.body = "我的备注".into();
    e.title = "自定义标题".into();
    e.tags.push("研究".into());
    e.archived = true;
    let project = item("project", "研究项目");
    store.save(project.clone()).unwrap();
    e.project_id = Some(project.id.clone());
    store.save(e.clone()).unwrap();
    fs::write(original, "<title>文件标题改变</title><p>v2</p>").unwrap();
    let changed = store
        .scan_folder(&source)
        .unwrap()
        .into_iter()
        .filter(|c| c.status == "update")
        .collect();
    let s = store.import_html(changed).unwrap();
    let updated = s.entries.iter().find(|x| x.id == e.id).unwrap();
    assert_eq!(updated.body, "我的备注");
    assert_eq!(updated.title, "自定义标题");
    assert!(updated.archived);
    assert_eq!(updated.project_id, Some(project.id));
    assert!(updated.tags.contains(&"研究".to_string()));
    assert_ne!(updated.attachments, e.attachments);
    drop(store);
    let store = Store::new(data).unwrap();
    assert_eq!(store.snapshot().unwrap().entries.len(), 2);
}

#[test]
fn html_assets_survive_source_deletion_and_backup_restore() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("pages");
    fs::create_dir_all(source.join("assets")).unwrap();
    fs::write(source.join("one.html"), "<title>图片资料</title><link rel='stylesheet' href='assets/main.css'><img src='assets/a.svg'>").unwrap();
    fs::write(
        source.join("assets/main.css"),
        "@import 'theme.css'; body{background:url(a.svg)}",
    )
    .unwrap();
    fs::write(source.join("assets/theme.css"), "p{color:red}").unwrap();
    fs::write(source.join("assets/a.svg"), "<svg/>").unwrap();
    let mut store = Store::new(dir.path().join("data")).unwrap();
    let s = store
        .import_html(store.scan_folder(&source).unwrap())
        .unwrap();
    assert_eq!(s.entries.len(), 1);
    fs::write(source.join("assets/a.svg"), "<svg>new</svg>").unwrap();
    assert_eq!(store.scan_folder(&source).unwrap()[0].status, "update");
    let backup = dir.path().join("saved.assistant-backup");
    store.backup(&backup).unwrap();
    fs::remove_dir_all(source).unwrap();
    let mut other = Store::new(dir.path().join("other")).unwrap();
    let restored = other.restore(&backup).unwrap();
    let a = &restored.attachments[0];
    assert_eq!(
        restored.entries[0]
            .file_source
            .as_ref()
            .unwrap()
            .attachment_id,
        a.id
    );
    let html = other.openable_path(a).unwrap();
    assert!(fs::read_to_string(&html).unwrap().contains("图片资料"));
    assert_eq!(
        fs::read_to_string(html.parent().unwrap().join("assets/a.svg")).unwrap(),
        "<svg/>"
    );
    assert!(html.parent().unwrap().join("assets/theme.css").exists());
}

#[test]
fn changed_preview_rolls_back_whole_html_batch() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("pages");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("a.html"), "<title>A</title>").unwrap();
    fs::write(source.join("b.html"), "<title>B</title>").unwrap();
    let mut store = Store::new(dir.path().join("data")).unwrap();
    let preview = store.scan_folder(&source).unwrap();
    fs::write(source.join("b.html"), "<title>B changed</title>").unwrap();
    assert!(store.import_html(preview).is_err());
    let s = store.snapshot().unwrap();
    assert!(s.entries.is_empty());
    assert!(s.attachments.is_empty());
    assert_eq!(
        fs::read_dir(store.root.join("attachments"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn html_scan_reports_invalid_pages_and_bounds_local_dependencies() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("pages");
    fs::create_dir(&source).unwrap();
    fs::write(dir.path().join("private.txt"), "outside").unwrap();
    fs::write(source.join("outside.html"), "<img src='../private.txt'>").unwrap();
    fs::write(source.join("missing.html"), "<img src='missing.png'>").unwrap();
    fs::write(source.join("utf8.html"), [0xff, 0xff]).unwrap();
    fs::write(source.join("valid.html"), "<title>可用</title><img src='https://example.com/a.png'><script src='//example.com/a.js'></script>").unwrap();
    fs::create_dir(source.join("sub")).unwrap();
    fs::write(source.join("sub/nested.html"), "nested").unwrap();
    let store = Store::new(dir.path().join("data")).unwrap();
    let rows = store.scan_folder(&source).unwrap();
    assert_eq!(rows.len(), 4);
    assert_eq!(rows.iter().filter(|r| r.status == "error").count(), 3);
    assert_eq!(rows.iter().filter(|r| r.status == "new").count(), 1);
}

#[test]
fn legacy_snapshot_without_import_fields_still_loads() {
    let e = item("resource", "旧资料");
    let mut value = serde_json::to_value(e).unwrap();
    value.as_object_mut().unwrap().remove("fileSource");
    assert!(serde_json::from_value::<Entry>(value)
        .unwrap()
        .file_source
        .is_none());
}
