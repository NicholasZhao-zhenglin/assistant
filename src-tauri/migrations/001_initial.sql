CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('inbox','project','action','event','resource')),
    project_id TEXT REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED,
    data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS entries_project ON entries(project_id);
CREATE INDEX IF NOT EXISTS entries_kind ON entries(kind);
CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
PRAGMA user_version = 1;
