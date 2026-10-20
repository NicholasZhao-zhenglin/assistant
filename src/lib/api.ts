import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  empty,
  validateEntry,
  type Attachment,
  type Entry,
  type Snapshot,
  type HtmlCandidate,
} from './model';
export const desktop = isTauri();
const PREVIEW_KEY = 'qixu-preview-v1';
function preview(): Snapshot {
  const saved = localStorage.getItem(PREVIEW_KEY);
  return saved ? JSON.parse(saved) : structuredClone(empty);
}
function persist(s: Snapshot): Snapshot {
  localStorage.setItem(PREVIEW_KEY, JSON.stringify(s));
  return s;
}
function validatePreview(e: Entry, s: Snapshot) {
  const error = validateEntry(e);
  if (error) throw new Error(error);
  if (e.projectId && !s.entries.some((x) => x.id === e.projectId && x.kind === 'project'))
    throw new Error('关联项目不存在');
}
export const api = {
  async scanHtml(directory: string): Promise<HtmlCandidate[]> {
    return invoke('scan_html_folder', { directory });
  },
  async importHtml(selected: HtmlCandidate[]): Promise<Snapshot> {
    return invoke('import_html_files', { selected });
  },
  async load(): Promise<Snapshot> {
    return desktop ? invoke('get_snapshot') : preview();
  },
  async save(entry: Entry): Promise<Snapshot> {
    if (desktop) return invoke('save_entry', { entry });
    const s = preview();
    validatePreview(entry, s);
    const index = s.entries.findIndex((e) => e.id === entry.id);
    const next = { ...entry, updatedAt: new Date().toISOString() };
    if (index < 0) s.entries.unshift(next);
    else s.entries[index] = next;
    return persist(s);
  },
  async triage(sourceId: string, destinations: Entry[]): Promise<Snapshot> {
    if (desktop) return invoke('triage_item', { sourceId, destinations });
    const s = preview();
    const source = s.entries.find((e) => e.id === sourceId && e.kind === 'inbox');
    if (!source || source.status !== 'pending' || source.archived)
      throw new Error('这条收件已经处理');
    if (!destinations.length) throw new Error('请至少选择一个整理结果');
    if (destinations.some((e) => s.entries.some((x) => x.id === e.id)))
      throw new Error('整理目标已存在');
    const next = {
      ...s,
      entries: [...destinations.map((e) => ({ ...e, sourceId })), ...s.entries],
    };
    destinations.forEach((e) => validatePreview(e, next));
    source.status = 'processed';
    return persist(next);
  },
  async importFile(path: string): Promise<Attachment> {
    return invoke('import_attachment', { path });
  },
  async openFile(id: string) {
    return invoke('open_attachment', { id });
  },
  async openLink(url: string) {
    if (desktop) return invoke('open_link', { url });
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  async backup(path: string) {
    return invoke('create_backup', { path });
  },
  async restore(path: string): Promise<Snapshot> {
    return invoke('restore_backup', { path });
  },
  async directory(): Promise<string> {
    return desktop ? invoke('data_directory') : '浏览器预览数据，与桌面数据库独立';
  },
};
