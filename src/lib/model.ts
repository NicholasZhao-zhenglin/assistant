export type Kind = 'inbox' | 'project' | 'action' | 'event' | 'resource';
export type Page =
  'today' | 'inbox' | 'projects' | 'calendar' | 'resources' | 'review' | 'settings' | 'search';
export interface FileSource {
  path: string;
  sha256: string;
  attachmentId: string;
}
export interface HtmlCandidate {
  path: string;
  title: string;
  sha256: string;
  status: 'new' | 'update' | 'duplicate' | 'error';
  detail: string;
}
export interface Entry {
  fileSource?: FileSource | null;
  id: string;
  kind: Kind;
  title: string;
  body: string;
  status: string;
  projectId: string | null;
  actionId: string | null;
  sourceId: string | null;
  due: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  isNext: boolean;
  focused: boolean;
  archived: boolean;
  tags: string[];
  attachments: string[];
  createdAt: string;
  updatedAt: string;
}
export interface Attachment {
  entryPoint?: string | null;
  id: string;
  name: string;
  size: number;
  sha256: string;
}
export interface Snapshot {
  entries: Entry[];
  attachments: Attachment[];
}
export const empty: Snapshot = { entries: [], attachments: [] };
export const kindLabels: Record<Kind, string> = {
  inbox: '收件',
  project: '项目',
  action: '行动',
  event: '日程',
  resource: '资料',
};
export const statusLabels: Record<string, string> = {
  pending: '待整理',
  processed: '已整理',
  active: '进行中',
  paused: '已暂停',
  todo: '待办',
  waiting: '等待中',
  done: '已完成',
  planned: '已安排',
  saved: '已保存',
};
export function makeEntry(kind: Kind, patch: Partial<Entry> = {}): Entry {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    kind,
    title: '',
    body: '',
    status: {
      inbox: 'pending',
      project: 'active',
      action: 'todo',
      event: 'planned',
      resource: 'saved',
    }[kind],
    projectId: null,
    actionId: null,
    sourceId: null,
    due: null,
    start: null,
    end: null,
    allDay: false,
    isNext: kind === 'action',
    focused: false,
    archived: false,
    tags: [],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
// Calendar dates must stay local: toISOString().slice(0, 10) shifts dates near midnight.
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function inputTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function monthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from(
    { length: 42 },
    (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i),
  );
}
export function onDay(e: Entry, day: string): boolean {
  if (e.kind !== 'event') return false;
  if (e.allDay) return e.due === day;
  if (!e.start || !e.end) return false;
  const start = localDate(day);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return new Date(e.start) < end && new Date(e.end) > start;
}
export function timeLabel(e: Entry): string {
  if (e.allDay) return '全天';
  const fmt = (s: string | null) =>
    s
      ? new Date(s).toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : '';
  const cross = e.start && e.end && dayKey(new Date(e.start)) !== dayKey(new Date(e.end));
  return `${fmt(e.start)} – ${cross ? `${dayKey(new Date(e.end!))} ` : ''}${fmt(e.end)}`;
}
export function searchEntries(entries: Entry[], query: string): Entry[] {
  const q = query.trim().toLocaleLowerCase();
  return q
    ? entries.filter(
        (e) =>
          !e.archived && [e.title, e.body, ...e.tags].join(' ').toLocaleLowerCase().includes(q),
      )
    : [];
}
export function missingNext(project: Entry, entries: Entry[]): boolean {
  return (
    project.status === 'active' &&
    !project.archived &&
    !entries.some(
      (e) =>
        e.kind === 'action' &&
        e.projectId === project.id &&
        e.isNext &&
        e.status === 'todo' &&
        !e.archived,
    )
  );
}
export function validateEntry(e: Entry): string | null {
  if (!e.title.trim()) return '请填写标题';
  if ([...e.title].length > 300) return '标题不能超过 300 字';
  if (e.kind === 'event') {
    if (e.allDay && !e.due) return '请选择日期';
    if (
      !e.allDay &&
      (!e.start ||
        !e.end ||
        !Number.isFinite(Date.parse(e.start)) ||
        !Number.isFinite(Date.parse(e.end)) ||
        Date.parse(e.end) <= Date.parse(e.start))
    )
      return '请选择有效的起止时间，结束时间应晚于开始时间';
  }
  return null;
}
