import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { homeDir, join } from '@tauri-apps/api/path';
import Modal from './Modal';
import { api } from '../lib/api';
import type { HtmlCandidate, Snapshot } from '../lib/model';

const KEY = 'qixu-html-folder';
const labels = { new: '新增', update: '有更新', duplicate: '已收录', error: '无法收录' };
export default function FolderImport({
  snapshot,
  onClose,
  onImported,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onImported: (snapshot: Snapshot, count: number) => void;
}) {
  const [directory, setDirectory] = useState(
    () =>
      localStorage.getItem(KEY) ||
      snapshot.entries.find((e) => e.fileSource)?.fileSource?.path.replace(/[/\\][^/\\]+$/, '') ||
      '',
  );
  const [rows, setRows] = useState<HtmlCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  async function scan(path: string) {
    setBusy(true);
    setError('');
    setResult('');
    setRows(null);
    setSelected(new Set());
    try {
      const items = await api.scanHtml(path);
      setRows(items);
      setDirectory(path);
      localStorage.setItem(KEY, path);
      setSelected(new Set(items.filter((e) => e.status === 'new').map((e) => e.path)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function choose() {
    setError('');
    try {
      const path = await open({
        directory: true,
        multiple: false,
        defaultPath: directory || undefined,
      });
      if (typeof path === 'string') await scan(path);
    } catch (e) {
      setError(String(e));
    }
  }
  async function generated() {
    try {
      await scan(await join(await homeDir(), '.answer-me-with-html', 'pages'));
    } catch (e) {
      setError(String(e));
    }
  }
  async function collect() {
    if (!rows) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.importHtml(rows.filter((r) => selected.has(r.path)));
      const count = updated.entries.filter(
        (e) => !snapshot.entries.some((old) => old.id === e.id && old.updatedAt === e.updatedAt),
      ).length;
      onImported(updated, count);
      setSelected(new Set());
      setResult(`已收录或更新 ${count} 份资料。同批重复内容自动合并；已归档资料保持归档。`);
      setRows(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title="从文件夹收录" onClose={() => !busy && onClose()}>
      <div className="folder-import">
        <p>
          每份 HTML
          单独建卡，自动提取标题。文件副本和普通图片、样式等配套资源一起保存，随资料库备份。
        </p>
        <div className="button-row">
          <button className="button secondary" disabled={busy} onClick={choose}>
            选择文件夹
          </button>
          <button className="button secondary" disabled={busy} onClick={generated}>
            扫描生成页面目录
          </button>
          {directory && (
            <button className="button secondary" disabled={busy} onClick={() => scan(directory)}>
              扫描新增 / 更新
            </button>
          )}
        </div>
        {directory && <code className="directory">{directory}</code>}
        <p className="muted">
          只扫描所选目录的 HTML，不遍历子目录。联网资源仍需网络；由 JavaScript
          动态加载的本地文件暂不自动收集。
        </p>
        {busy && <p role="status">正在处理，请稍候…</p>}
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        {result && <p role="status">{result}</p>}
        {rows && (
          <>
            <p>
              {rows.filter((r) => r.status === 'new').length} 份新增 ·{' '}
              {rows.filter((r) => r.status === 'update').length} 份更新 ·{' '}
              {rows.filter((r) => r.status === 'duplicate').length} 份已收录 ·{' '}
              {rows.filter((r) => r.status === 'error').length} 份无法收录
            </p>
            <p className="muted">
              默认勾选新增。有更新的文件请手动勾选；更新保留现有标题、备注、标签和关联。
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  setSelected(
                    new Set(
                      rows
                        .filter((r) => r.status === 'new' || r.status === 'update')
                        .map((r) => r.path),
                    ),
                  )
                }
              >
                全选可收录项
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(new Set())}
              >
                清空选择
              </button>
            </div>
            <div className="import-list">
              {!rows.length && <p>这个目录还没有 HTML 文件。</p>}
              {rows.map((row) => (
                <label key={row.path} className="import-row">
                  <input
                    type="checkbox"
                    checked={selected.has(row.path)}
                    disabled={busy || row.status === 'duplicate' || row.status === 'error'}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(row.path);
                        else next.delete(row.path);
                        return next;
                      })
                    }
                  />
                  <span>
                    <strong>{row.title}</strong>
                    <small>{row.path.split(/[/\\]/).pop()}</small>
                    <small>
                      {labels[row.status]} · {row.detail}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="button-row">
          <button className="button secondary" disabled={busy} onClick={onClose}>
            关闭
          </button>
          <button className="button primary" disabled={busy || !selected.size} onClick={collect}>
            收录所选 {selected.size ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
