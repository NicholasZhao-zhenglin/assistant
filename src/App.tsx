import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Leaf,
  LoaderCircle,
  Paperclip,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Target,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { open, save } from '@tauri-apps/plugin-dialog';
import { api, desktop } from './lib/api';
import {
  dayKey,
  empty,
  kindLabels,
  localDate,
  makeEntry,
  missingNext,
  monthDays,
  onDay,
  searchEntries,
  statusLabels,
  timeLabel,
  type Entry,
  type Kind,
  type Page,
  type Snapshot,
} from './lib/model';
import Editor from './components/Editor';
import FolderImport from './components/FolderImport';
import Modal from './components/Modal';

const navigation: { id: Page; title: string; icon: typeof Sun }[] = [
  { id: 'today', title: '今天', icon: Sun },
  { id: 'inbox', title: '收件箱', icon: Inbox },
  { id: 'projects', title: '项目清单', icon: FolderOpen },
  { id: 'calendar', title: '日历', icon: CalendarDays },
  { id: 'resources', title: '资料库', icon: FileText },
];
const subtitles: Record<Page, string> = {
  today: '把注意力，留给真正重要的事。',
  inbox: '先把想法放下来，再给它一个去处。',
  projects: '每一个想完成的结果，都从下一步开始。',
  calendar: '为真实的承诺留出时间，也为自己留白。',
  resources: '让积累的每一份材料，都能在需要时找到。',
  review: '停下来看看，才能更从容地向前。',
  settings: '你的工作空间，由你掌握。',
  search: '从想法到成果，一处找到。',
};
function Empty({
  icon: Icon = Leaf,
  title,
  text,
  action,
}: {
  icon?: typeof Sun;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} strokeWidth={1.4} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [page, setPage] = useState<Page>('today');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [editor, setEditor] = useState<{ entry: Entry; source?: Entry } | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('focus');
  const [archiveView, setArchiveView] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(dayKey());
  const [directory, setDirectory] = useState('');
  const [folderImport, setFolderImport] = useState(false);
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const [clock, setClock] = useState(new Date());
  const searchRef = useRef<HTMLInputElement>(null);
  const today = dayKey(clock);
  const entries = snapshot.entries.filter((e) => !e.archived);
  const inbox = entries.filter((e) => e.kind === 'inbox' && e.status === 'pending');
  const projects = entries.filter((e) => e.kind === 'project');
  const actions = entries.filter((e) => e.kind === 'action');
  const events = entries.filter((e) => e.kind === 'event');
  const focused = actions.filter((e) => e.focused && e.status !== 'done');
  const incomplete = projects.filter((e) => missingNext(e, entries));
  const overdue = actions.filter((e) => e.status !== 'done' && e.due && e.due < today);
  const pendingDue = actions.filter(
    (e) =>
      e.status !== 'done' &&
      e.due &&
      e.due <= dayKey(new Date(clock.getFullYear(), clock.getMonth(), clock.getDate() + 7)),
  );
  const toast = useCallback((message: string, error = false) => {
    setNotice(message);
    setNoticeError(error);
  }, []);
  const navigate = useCallback((next: Page) => {
    setPage(next);
    setArchiveView(false);
    setSelectedProject(null);
    setFilter(next === 'today' ? 'focus' : 'pending');
  }, []);
  async function reload() {
    setLoading(true);
    setLoadError('');
    try {
      setSnapshot(await api.load());
      setDirectory(await api.directory());
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  const create = useCallback((kind: Kind, patch: Partial<Entry> = {}) => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    setEditor({
      entry: makeEntry(kind, {
        ...(kind === 'event'
          ? { due: dayKey(), start: d.toISOString(), end: new Date(+d + 3600000).toISOString() }
          : {}),
        ...patch,
      }),
    });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        create('inbox');
      }
    };
    window.addEventListener('keydown', key);
    if (!desktop) return () => window.removeEventListener('keydown', key);
    const captureListener = listen('quick-capture', () => create('inbox'));
    const dragListener = getCurrentWebviewWindow().onDragDropEvent(async (event) => {
      if (event.payload.type !== 'drop') return;
      try {
        const files = [];
        for (const path of event.payload.paths) files.push(await api.importFile(path));
        setSnapshot(await api.load());
        create('inbox', { title: files[0]?.name || '新文件', attachments: files.map((f) => f.id) });
      } catch (e) {
        toast(String(e), true);
      }
    });
    return () => {
      window.removeEventListener('keydown', key);
      void captureListener.then((f) => f());
      void dragListener.then((f) => f());
    };
  }, [create, toast]);
  async function update(entry: Entry, message?: string) {
    setBusy(true);
    try {
      setSnapshot(await api.save(entry));
      if (message) toast(message);
    } catch (e) {
      toast(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  function viewProject(id: string) {
    navigate('projects');
    setSelectedProject(id);
  }
  function projectLabel(id: string | null) {
    return snapshot.entries.find((e) => e.id === id)?.title;
  }
  function edit(entry: Entry) {
    setEditor({ entry });
  }
  const archive = (entry: Entry) =>
    update(
      { ...entry, archived: !entry.archived },
      entry.archived ? '已恢复' : '已归档，可在归档列表恢复',
    );
  const button = (title: string, kind: Kind, patch: Partial<Entry> = {}) => (
    <button className="text-button" onClick={() => create(kind, patch)}>
      <Plus size={16} />
      {title}
    </button>
  );
  function renderRow(entry: Entry, compact = false) {
    const attachments = entry.attachments
      .map((id) => snapshot.attachments.find((a) => a.id === id))
      .filter(Boolean);
    return (
      <article className={`entry-row ${entry.status === 'done' ? 'completed' : ''}`} key={entry.id}>
        {entry.kind === 'action' ? (
          <button
            disabled={busy}
            className="check-button"
            aria-label={`${entry.status === 'done' ? '重新打开' : '完成'} ${entry.title}`}
            onClick={() => update({ ...entry, status: entry.status === 'done' ? 'todo' : 'done' })}
          >
            {entry.status === 'done' ? <CheckCircle2 size={21} /> : <Circle size={21} />}
          </button>
        ) : (
          <span className={`entry-symbol ${entry.kind}`}>
            {entry.kind === 'event' ? (
              <CalendarDays size={18} />
            ) : entry.kind === 'resource' ? (
              <FileText size={18} />
            ) : entry.kind === 'project' ? (
              <Folder size={18} />
            ) : (
              <Inbox size={18} />
            )}
          </span>
        )}
        <div className="entry-content">
          <button
            className="entry-title"
            onClick={() => (entry.kind === 'project' ? viewProject(entry.id) : edit(entry))}
          >
            {entry.title}
          </button>
          <div className="entry-meta">
            {entry.projectId && (
              <button onClick={() => viewProject(entry.projectId!)}>
                <Folder size={11} />
                {projectLabel(entry.projectId)}
              </button>
            )}
            {entry.kind === 'event' && <span>{timeLabel(entry)}</span>}
            {entry.kind === 'action' && entry.isNext && entry.status === 'todo' && (
              <span className="next-label">下一步</span>
            )}
            {entry.status === 'waiting' && <span className="amber-text">等待中</span>}
            {entry.due && entry.kind !== 'event' && (
              <span className={entry.due < today && entry.status !== 'done' ? 'overdue' : ''}>
                {entry.due} 截止
              </span>
            )}
            {entry.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
          {!compact && entry.body && <p className="entry-description">{entry.body}</p>}
          {!compact && attachments.length > 0 && (
            <div className="attachments">
              {attachments.map((a) => (
                <button
                  className="attachment"
                  key={a!.id}
                  onClick={() => api.openFile(a!.id).catch((e) => toast(String(e), true))}
                >
                  <Paperclip size={12} />
                  {a!.name}
                </button>
              ))}
            </div>
          )}
          {!compact && entry.kind === 'resource' && /^https?:\/\/\S+$/.test(entry.body.trim()) && (
            <button
              className="text-button small"
              onClick={() => api.openLink(entry.body.trim()).catch((e) => toast(String(e), true))}
            >
              打开链接
              <ExternalLink size={12} />
            </button>
          )}
          {entry.kind === 'inbox' && entry.status === 'processed' && (
            <div className="entry-meta">
              已整理为：
              {entries
                .filter((e) => e.sourceId === entry.id)
                .map((e) => (
                  <button
                    key={e.id}
                    onClick={() => (e.kind === 'project' ? viewProject(e.id) : edit(e))}
                  >
                    {kindLabels[e.kind]} · {e.title}
                    <ArrowRight size={10} />
                  </button>
                ))}
            </div>
          )}
          {entry.sourceId && (
            <button
              className="source-link"
              onClick={() => {
                const s = snapshot.entries.find((e) => e.id === entry.sourceId);
                if (s) edit(s);
              }}
            >
              查看原始收件
            </button>
          )}
        </div>
        <div className="row-actions">
          {entry.kind === 'action' && !entry.archived && (
            <button
              disabled={busy}
              className={`icon-button ${entry.focused ? 'starred' : ''}`}
              aria-label={`${entry.focused ? '移出' : '加入'}今日重点 ${entry.title}`}
              onClick={() => update({ ...entry, focused: !entry.focused })}
            >
              <Star size={17} fill={entry.focused ? 'currentColor' : 'none'} />
            </button>
          )}
          {entry.kind === 'inbox' && entry.status === 'pending' && !entry.archived && (
            <button
              className="button small secondary"
              onClick={() =>
                setEditor({
                  entry: makeEntry('action', {
                    title: entry.title,
                    body: entry.body,
                    attachments: entry.attachments,
                  }),
                  source: entry,
                })
              }
            >
              整理
              <ArrowRight size={13} />
            </button>
          )}
          <button
            className="icon-button"
            disabled={busy}
            aria-label={`${entry.archived ? '恢复' : '归档'} ${entry.title}`}
            onClick={() => archive(entry)}
          >
            {entry.archived ? <Undo2 size={16} /> : <Archive size={16} />}
          </button>
        </div>
      </article>
    );
  }
  function todayView() {
    const shown = actions.filter((e) =>
      filter === 'focus'
        ? e.focused && e.status !== 'done'
        : filter === 'all'
          ? e.status !== 'done'
          : filter === 'waiting'
            ? e.status === 'waiting'
            : e.status === 'done',
    );
    const schedule = events
      .filter((e) => onDay(e, today))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    return (
      <>
        <div className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">A LITTLE CLARITY, EVERY DAY</span>
            <h2>给今天，留一点从容。</h2>
            <p>
              {focused.length
                ? `今天有 ${focused.length} 个重点行动，专注做好眼前的一步。`
                : '把脑海里的事情安放好，从一个小小的行动开始。'}
            </p>
            <button className="button primary" onClick={() => create('inbox')}>
              <Plus size={17} />
              记下一件事
            </button>
          </div>
          <div className="landscape" aria-hidden="true">
            <div className="land-sun" />
            <div className="hill far" />
            <div className="hill near" />
            <div className="land-stem" />
            <span className="land-caption">慢慢来，也在向前。</span>
          </div>
        </div>
        <div className="stats">
          <button onClick={() => navigate('inbox')}>
            <span className="stat-icon">
              <Inbox size={20} />
            </span>
            <div>
              <strong>{inbox.length.toString().padStart(2, '0')}</strong>
              <span>等待整理</span>
            </div>
            <ArrowRight size={16} />
          </button>
          <button onClick={() => navigate('projects')}>
            <span className="stat-icon tan">
              <Folder size={20} />
            </span>
            <div>
              <strong>
                {projects
                  .filter((p) => p.status === 'active')
                  .length.toString()
                  .padStart(2, '0')}
              </strong>
              <span>正在推进的项目</span>
            </div>
            <ArrowRight size={16} />
          </button>
          <button onClick={() => navigate('calendar')}>
            <span className="stat-icon lavender">
              <CalendarDays size={20} />
            </span>
            <div>
              <strong>{schedule.length.toString().padStart(2, '0')}</strong>
              <span>今天的日程</span>
            </div>
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="dashboard-columns">
          <div>
            <Section
              title="把重要的事放在前面"
              action={button('添加行动', 'action', { focused: true })}
            >
              <div className="tabs">
                {[
                  ['focus', '今日重点'],
                  ['all', '全部行动'],
                  ['waiting', '等待中'],
                  ['done', '已完成'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={filter === v ? 'active' : ''}
                    onClick={() => setFilter(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {shown.length ? (
                <div className="entry-list">{shown.map((e) => renderRow(e, true))}</div>
              ) : (
                <Empty
                  icon={Target}
                  title={filter === 'focus' ? '今天，想推进什么？' : '这里还没有行动'}
                  text={
                    filter === 'focus'
                      ? '在全部行动中点亮星标，或添加一个今日重点。'
                      : '从一个具体、可以执行的小步骤开始。'
                  }
                  action={
                    filter === 'focus' && (
                      <button className="text-button" onClick={() => setFilter('all')}>
                        浏览全部行动
                        <ArrowRight size={14} />
                      </button>
                    )
                  }
                />
              )}
            </Section>
            {pendingDue.length > 0 && (
              <Section title="临近截止" count={pendingDue.length}>
                <div className="entry-list">
                  {pendingDue
                    .sort((a, b) => (a.due || '').localeCompare(b.due || ''))
                    .map((e) => renderRow(e, true))}
                </div>
              </Section>
            )}
          </div>
          <aside>
            <Section
              title="今天的时间"
              action={
                <button
                  className="icon-button"
                  aria-label="查看日历"
                  onClick={() => navigate('calendar')}
                >
                  <ArrowRight size={17} />
                </button>
              }
            >
              {schedule.length ? (
                <div className="schedule-list">
                  {schedule.map((e) => (
                    <button key={e.id} className="schedule-item" onClick={() => edit(e)}>
                      <span className="schedule-dot" />
                      <div>
                        <small>{timeLabel(e)}</small>
                        <strong>{e.title}</strong>
                        {e.projectId && <span>{projectLabel(e.projectId)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="quiet-schedule">
                  <Sun size={27} strokeWidth={1.3} />
                  <p>今天还没有时间承诺</p>
                  <span>给专注，也给灵感留些空间。</span>
                  {button('安排一段时间', 'event')}
                </div>
              )}
            </Section>
            <div className="review-card">
              <span className="eyebrow">一点小提醒</span>
              <Leaf size={23} />
              <h3>
                {incomplete.length
                  ? `${incomplete.length} 个项目还缺少下一步`
                  : '收集之后，记得整理。'}
              </h3>
              <p>
                {incomplete.length
                  ? '给项目一个清晰的行动，让进展发生。'
                  : '每天花几分钟清空收件箱，让想法有去处，让大脑轻一点。'}
              </p>
              <button
                className="text-button"
                onClick={() => navigate(incomplete.length ? 'review' : 'inbox')}
              >
                {incomplete.length ? '查看回顾' : '去收件箱'}
                <ArrowRight size={14} />
              </button>
            </div>
          </aside>
        </div>
      </>
    );
  }
  function inboxView() {
    const shown = snapshot.entries.filter(
      (e) =>
        e.kind === 'inbox' &&
        (archiveView
          ? e.archived
          : !e.archived && e.status === (filter === 'processed' ? 'processed' : 'pending')),
    );
    return (
      <>
        <div className="capture-strip">
          <Inbox size={20} />
          <button onClick={() => create('inbox')}>有什么在你脑海里？记下来，稍后再整理。</button>
          <kbd>⌘ N</kbd>
        </div>
        <div className="view-toolbar">
          <div className="tabs">
            {[
              ['pending', '待整理'],
              ['processed', '已整理'],
            ].map(([v, l]) => (
              <button
                key={v}
                className={
                  !archiveView && (filter === v || (v === 'pending' && filter !== 'processed'))
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setArchiveView(false);
                  setFilter(v);
                }}
              >
                {l}
              </button>
            ))}
            <button className={archiveView ? 'active' : ''} onClick={() => setArchiveView(true)}>
              已归档
            </button>
          </div>
          <span className="muted">{shown.length} 条记录</span>
        </div>
        <Section
          title={
            archiveView
              ? '归档收件'
              : filter === 'processed'
                ? '已找到去处'
                : '等待一个清晰的下一步'
          }
        >
          {shown.length ? (
            <div className="entry-list">{shown.map((e) => renderRow(e))}</div>
          ) : (
            <Empty
              icon={Inbox}
              title={
                archiveView
                  ? '还没有归档收件'
                  : filter === 'processed'
                    ? '整理后的收件会留在这里'
                    : '收件箱很清爽'
              }
              text="想法、链接、文件，都可以先放在这里。"
              action={button('记录第一件事', 'inbox')}
            />
          )}
        </Section>
      </>
    );
  }
  function projectsView() {
    const project = snapshot.entries.find((e) => e.id === selectedProject);
    if (project) {
      const related = entries.filter((e) => e.projectId === project.id);
      return (
        <>
          <button className="text-button back" onClick={() => setSelectedProject(null)}>
            <ArrowLeft size={15} />
            返回项目清单
          </button>
          <div className="project-hero">
            <div>
              <span className="pill">{statusLabels[project.status]}</span>
              <h2>{project.title}</h2>
              <p>{project.body || '为这个项目写下一个清晰的完成标准。'}</p>
              {project.due && <small>截止日期：{project.due}</small>}
            </div>
            <button className="button secondary" onClick={() => edit(project)}>
              编辑项目
            </button>
          </div>
          {missingNext(project, entries) && (
            <div className="inline-notice">
              <Target size={17} />
              这个项目还没有可执行的下一步。
              {button('添加下一步', 'action', { projectId: project.id })}
            </div>
          )}
          <Section
            title="行动清单"
            action={button('添加行动', 'action', { projectId: project.id })}
          >
            {related.some((e) => e.kind === 'action') ? (
              related.filter((e) => e.kind === 'action').map((e) => renderRow(e))
            ) : (
              <Empty title="让项目向前一步" text="添加一个具体的下一步行动。" />
            )}
          </Section>
          <div className="two-columns">
            <Section
              title="相关资料"
              action={button('添加资料', 'resource', { projectId: project.id })}
            >
              {related.some((e) => e.kind === 'resource') ? (
                related.filter((e) => e.kind === 'resource').map((e) => renderRow(e))
              ) : (
                <Empty
                  icon={FileText}
                  title="资料就在项目旁边"
                  text="笔记、参考链接与成果，集中放在这里。"
                />
              )}
            </Section>
            <Section
              title="项目日程"
              action={button('添加日程', 'event', { projectId: project.id })}
            >
              {related.some((e) => e.kind === 'event') ? (
                related.filter((e) => e.kind === 'event').map((e) => renderRow(e, true))
              ) : (
                <Empty
                  icon={CalendarDays}
                  title="还没有安排时间"
                  text="需要确定时间的事，可以添加到日历。"
                />
              )}
            </Section>
          </div>
        </>
      );
    }
    const shown = snapshot.entries.filter(
      (e) => e.kind === 'project' && e.archived === archiveView,
    );
    return (
      <>
        <div className="view-toolbar">
          <div className="tabs">
            <button className={!archiveView ? 'active' : ''} onClick={() => setArchiveView(false)}>
              全部项目
            </button>
            <button className={archiveView ? 'active' : ''} onClick={() => setArchiveView(true)}>
              已归档
            </button>
          </div>
          <span className="muted">以结果为终点，以行动为起点</span>
        </div>
        {shown.length ? (
          <div className="project-grid">
            {shown.map((p) => {
              const tasks = actions.filter((e) => e.projectId === p.id);
              const done = tasks.filter((e) => e.status === 'done').length;
              const next = tasks.find((e) => e.isNext && e.status === 'todo');
              return (
                <article className="project-card" key={p.id}>
                  <div className="project-card-top">
                    <span className="folder-tile">
                      <Folder size={22} />
                    </span>
                    <span className={`pill ${p.status === 'done' ? 'green' : ''}`}>
                      {statusLabels[p.status]}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={`${p.archived ? '恢复' : '归档'} ${p.title}`}
                      onClick={() => archive(p)}
                    >
                      {p.archived ? <Undo2 size={16} /> : <Archive size={16} />}
                    </button>
                  </div>
                  <button className="project-title" onClick={() => viewProject(p.id)}>
                    {p.title}
                  </button>
                  <p>{p.body || '尚未填写完成标准'}</p>
                  <div className="project-progress">
                    <span>行动进度</span>
                    <span>
                      {done} / {tasks.length}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
                  </div>
                  <div className={`project-next ${missingNext(p, entries) ? 'needs-next' : ''}`}>
                    <ArrowRight size={14} />
                    <span>
                      {next
                        ? next.title
                        : p.status === 'done'
                          ? '项目已完成'
                          : p.status === 'paused'
                            ? '项目已暂停'
                            : '添加一个下一步行动'}
                    </span>
                  </div>
                </article>
              );
            })}
            <button className="new-project-card" onClick={() => create('project')}>
              <Plus size={26} />
              <span>开启一个新项目</span>
            </button>
          </div>
        ) : (
          <Section title="你的项目">
            <Empty
              icon={FolderOpen}
              title="把想完成的事，变成项目"
              text="它可以是一次旅行、一份作品，或一个长期想实现的目标。"
              action={button('创建第一个项目', 'project')}
            />
          </Section>
        )}
      </>
    );
  }
  function calendarView() {
    const selectedEvents = events
      .filter((e) => onDay(e, selectedDay))
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    const commitments = entries.filter(
      (e) =>
        (e.kind === 'action' || e.kind === 'project') &&
        e.due === selectedDay &&
        e.status !== 'done',
    );
    return (
      <div className="calendar-layout">
        <section className="panel calendar-panel">
          <div className="calendar-heading">
            <h2>
              {month.getFullYear()} 年 <strong>{month.getMonth() + 1}</strong> 月
            </h2>
            <div>
              <button
                className="button small secondary"
                onClick={() => {
                  setMonth(new Date());
                  setSelectedDay(today);
                }}
              >
                今天
              </button>
              <button
                className="icon-button"
                aria-label="上个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="下个月"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="weekdays">
            {'一二三四五六日'.split('').map((d) => (
              <span key={d}>周{d}</span>
            ))}
          </div>
          <div className="month-grid">
            {monthDays(month).map((d) => {
              const key = dayKey(d);
              const dayEvents = events.filter((e) => onDay(e, key));
              const due = entries.filter(
                (e) =>
                  (e.kind === 'action' || e.kind === 'project') &&
                  e.due === key &&
                  e.status !== 'done',
              );
              return (
                <button
                  key={key}
                  aria-label={`${key} 日程`}
                  className={`calendar-cell ${d.getMonth() !== month.getMonth() ? 'outside' : ''} ${key === selectedDay ? 'selected' : ''}`}
                  onClick={() => setSelectedDay(key)}
                >
                  <span className={`day-number ${key === today ? 'today' : ''}`}>
                    {d.getDate()}
                  </span>
                  {dayEvents.slice(0, 2).map((e) => (
                    <span className="calendar-event" key={e.id}>
                      {e.title}
                    </span>
                  ))}
                  {due.length > 0 && <span className="calendar-due">{due.length} 项截止</span>}
                  {dayEvents.length > 2 && <small>+{dayEvents.length - 2} 项</small>}
                </button>
              );
            })}
          </div>
        </section>
        <aside>
          <Section
            title={localDate(selectedDay).toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'short',
            })}
            action={button('', 'event', { due: selectedDay, allDay: true })}
          >
            {selectedEvents.length ? (
              selectedEvents.map((e) => renderRow(e, true))
            ) : (
              <Empty icon={Sun} title="时间还是空白的" text="只安排真实的时间承诺。" />
            )}
          </Section>
          {commitments.length > 0 && (
            <Section title="当天截止">{commitments.map((e) => renderRow(e, true))}</Section>
          )}
          <div className="calendar-tip">
            <Leaf size={17} />
            <p>截止日期只是日期标记，不会占用工作时段。专注时间由你安排。</p>
          </div>
        </aside>
      </div>
    );
  }
  function resourcesView() {
    const shown = snapshot.entries.filter(
      (e) => e.kind === 'resource' && e.archived === archiveView,
    );
    return (
      <>
        <div className="view-toolbar">
          <div className="tabs">
            <button className={!archiveView ? 'active' : ''} onClick={() => setArchiveView(false)}>
              全部资料
            </button>
            <button className={archiveView ? 'active' : ''} onClick={() => setArchiveView(true)}>
              已归档
            </button>
          </div>
          <div className="button-row">
            <span className="muted">{shown.length} 份积累</span>
            <button
              className="button secondary"
              disabled={!desktop}
              title={!desktop ? '请在桌面应用中使用' : '批量收录 HTML，并扫描新增文件'}
              onClick={() => setFolderImport(true)}
            >
              <FolderOpen size={16} /> 从文件夹收录
            </button>
          </div>
        </div>
        <Section title="值得留下的东西">
          {shown.length ? (
            <div className="entry-list">{shown.map((e) => renderRow(e))}</div>
          ) : (
            <Empty
              icon={FileText}
              title="建立自己的资料库"
              text="收藏一篇文章，记下一段思考，留下一个成果。"
              action={button('添加第一份资料', 'resource')}
            />
          )}
        </Section>
      </>
    );
  }
  function reviewView() {
    const weekAgo = new Date(+clock - 7 * 86400000);
    const done = actions.filter((e) => e.status === 'done' && new Date(e.updatedAt) >= weekAgo);
    return (
      <>
        <div className="review-intro">
          <Sparkles size={25} />
          <div>
            <h2>回顾，是为了更轻松地出发。</h2>
            <p>过去 7 天完成了 {done.length} 个行动。以下内容由本地记录汇总。</p>
          </div>
        </div>
        <div className="review-stats">
          <div>
            <strong>{inbox.length}</strong>
            <span>收件待整理</span>
          </div>
          <div>
            <strong>{incomplete.length}</strong>
            <span>项目缺少下一步</span>
          </div>
          <div>
            <strong>{overdue.length}</strong>
            <span>行动已逾期</span>
          </div>
          <div>
            <strong>{actions.filter((e) => e.status === 'waiting').length}</strong>
            <span>事项等待中</span>
          </div>
        </div>
        <Section title="需要下一步的项目">
          {incomplete.length ? (
            incomplete.map((e) => renderRow(e, true))
          ) : (
            <Empty
              icon={CheckCircle2}
              title="每个活跃项目都有方向"
              text="下一步行动清晰，就能更安心地推进。"
            />
          )}
        </Section>
        <div className="two-columns">
          <Section title="需要重新安排">
            {overdue.length ? (
              overdue.map((e) => renderRow(e, true))
            ) : (
              <p className="padded muted">目前没有逾期行动。</p>
            )}
          </Section>
          <Section title="等待跟进">
            {actions.some((e) => e.status === 'waiting') ? (
              actions.filter((e) => e.status === 'waiting').map((e) => renderRow(e, true))
            ) : (
              <p className="padded muted">目前没有等待事项。</p>
            )}
          </Section>
        </div>
        <Section
          title="行动归档"
          count={snapshot.entries.filter((e) => e.kind === 'action' && e.archived).length}
        >
          {snapshot.entries
            .filter((e) => e.kind === 'action' && e.archived)
            .map((e) => renderRow(e, true))}
        </Section>
        <Section
          title="日程归档"
          count={snapshot.entries.filter((e) => e.kind === 'event' && e.archived).length}
        >
          {snapshot.entries
            .filter((e) => e.kind === 'event' && e.archived)
            .map((e) => renderRow(e, true))}
        </Section>
      </>
    );
  }
  async function backup() {
    try {
      const path = await save({
        defaultPath: `栖序备份-${today}.assistant-backup`,
        filters: [{ name: '栖序备份', extensions: ['assistant-backup'] }],
      });
      if (path) {
        setBusy(true);
        await api.backup(path);
        toast('完整备份已导出，包含数据与附件');
      }
    } catch (e) {
      toast(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function pickRestore() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: '栖序备份', extensions: ['assistant-backup'] }],
      });
      if (typeof path === 'string') setRestorePath(path);
    } catch (e) {
      toast(String(e), true);
    }
  }
  function settingsView() {
    return (
      <div className="settings-stack">
        <Section title="本地工作空间">
          <div className="settings-body">
            <div className="setting-line">
              <span className="stat-icon">
                <ShieldCheck size={22} />
              </span>
              <div>
                <h3>{desktop ? '数据保存在这台电脑' : '浏览器预览模式'}</h3>
                <p>
                  {desktop
                    ? '核心功能离线可用，无需注册账户。'
                    : '预览使用独立的浏览器存储；正式桌面版使用 SQLite。'}
                </p>
              </div>
              <span className="pill green">{desktop ? '本地优先' : '预览'}</span>
            </div>
            <label>
              数据位置<code className="directory">{directory}</code>
            </label>
            <small>数据库与托管附件一起备份。导出的备份未加密，请保存在你信任的位置。</small>
          </div>
        </Section>
        <Section title="备份与恢复">
          <div className="settings-body">
            <p>导出一份可迁移的完整备份。恢复会替换当前记录，并在数据目录保留恢复前的安全副本。</p>
            <div className="button-row">
              <button className="button primary" disabled={!desktop || busy} onClick={backup}>
                <ArrowDownToLine size={17} />
                导出完整备份
              </button>
              <button
                className="button secondary"
                disabled={!desktop || busy}
                onClick={pickRestore}
              >
                <Upload size={17} />
                从备份恢复
              </button>
            </div>
            {!desktop && <small>备份、文件附件和全局快捷键请在桌面应用中使用。</small>}
          </div>
        </Section>
        <Section title="随手记录">
          <div className="settings-body shortcuts">
            <div>
              <span>任何应用中呼出快速记录</span>
              <kbd>⌘ ⇧ Space</kbd>
            </div>
            <div>
              <span>应用内新建收件</span>
              <kbd>⌘ N</kbd>
            </div>
            <div>
              <span>搜索全部内容</span>
              <kbd>⌘ K</kbd>
            </div>
            <small>
              Windows 使用 Ctrl 替代
              ⌘。关闭窗口后应用仍驻留菜单栏；从菜单栏选择“退出栖序”可完全退出。
            </small>
          </div>
        </Section>
        <Section title="关于栖序">
          <div className="settings-body">
            <p>栖序 0.1.0 · 把事情安放好，让行动更从容。</p>
            <p className="muted">
              当前提供离线整理与执行流程、基础回顾。AI、系统通知、外部日历同步和手机同步将在后续版本加入。
            </p>
          </div>
        </Section>
      </div>
    );
  }
  const pageTitle =
    page === 'search'
      ? '搜索'
      : page === 'review'
        ? '每周回顾'
        : page === 'settings'
          ? '设置'
          : navigation.find((n) => n.id === page)?.title;
  const newKind: Kind =
    page === 'projects'
      ? 'project'
      : page === 'calendar'
        ? 'event'
        : page === 'resources'
          ? 'resource'
          : 'inbox';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Leaf size={25} />
          </div>
          <div>
            <strong>栖序</strong>
            <span>你的个人工作空间</span>
          </div>
        </div>
        <button
          className="capture-button"
          onClick={() => create('inbox')}
          disabled={loading || !!loadError}
        >
          <Plus size={18} />
          快速记录<kbd>⌘ N</kbd>
        </button>
        <div className="nav-label">我的空间</div>
        <nav aria-label="主导航">
          {navigation.map(({ id, title, icon: Icon }) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon size={19} />
              <span>{title}</span>
              {id === 'inbox' && inbox.length > 0 && (
                <span className="nav-count">{inbox.length}</span>
              )}
              {page === id && id !== 'inbox' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <button
          className={`review-nav ${page === 'review' ? 'active' : ''}`}
          onClick={() => navigate('review')}
        >
          <Sparkles size={18} />
          每周回顾
        </button>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="note-dash" />
            <p>
              心中有方向，
              <br />
              手边有下一步。
            </p>
            <Leaf size={31} strokeWidth={1} />
          </div>
          <button
            className={page === 'settings' ? 'active' : ''}
            onClick={() => navigate('settings')}
          >
            <Settings size={18} />
            <span>设置与备份</span>
          </button>
          <div className="local-status">
            <span className={loadError ? 'error-dot' : 'status-dot'} />
            {desktop ? '本地存储 · 离线可用' : '浏览器预览 · 独立数据'}
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            我的空间
            <ChevronRight size={12} />
            <strong>{pageTitle}</strong>
          </div>
          <div className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="搜索全部内容"
              placeholder="搜索想法、项目、资料…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage('search');
              }}
              onFocus={() => {
                if (query) setPage('search');
              }}
            />
            <kbd>⌘ K</kbd>
            {query && (
              <button className="icon-button" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </div>
          <div className="avatar">我</div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'today'
                  ? clock.toLocaleDateString('zh-CN', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long',
                    })
                  : 'QIXU / PERSONAL WORKSPACE'}
              </div>
              <h1>
                {pageTitle}
                <span className="heading-dot">.</span>
              </h1>
              <p>{subtitles[page]}</p>
            </div>
            {!['review', 'settings', 'search'].includes(page) && (
              <button
                className="button secondary"
                disabled={loading || !!loadError}
                onClick={() => create(newKind)}
              >
                <Plus size={17} />
                {page === 'today' ? '新建收件' : `新建${kindLabels[newKind]}`}
              </button>
            )}
          </div>
          {!desktop && (
            <div className="preview-banner">
              <span>浏览器预览</span>这里的数据仅保存在当前浏览器，与桌面工作空间独立。
            </div>
          )}
          {loading ? (
            <Empty icon={LoaderCircle} title="正在打开你的工作空间" text="读取本地记录…" />
          ) : loadError ? (
            <div className="error-state">
              <h2>工作空间暂时无法读取</h2>
              <p>{loadError}</p>
              <button className="button secondary" onClick={reload}>
                重试
              </button>
            </div>
          ) : page === 'today' ? (
            todayView()
          ) : page === 'inbox' ? (
            inboxView()
          ) : page === 'projects' ? (
            projectsView()
          ) : page === 'calendar' ? (
            calendarView()
          ) : page === 'resources' ? (
            resourcesView()
          ) : page === 'review' ? (
            reviewView()
          ) : page === 'settings' ? (
            settingsView()
          ) : (
            <Section
              title={query.trim() ? `“${query}” 的搜索结果` : '搜索你的工作空间'}
              count={searchEntries(snapshot.entries, query).length}
            >
              {searchEntries(snapshot.entries, query).map((e) => renderRow(e))}
              {searchEntries(snapshot.entries, query).length === 0 && (
                <Empty
                  icon={Search}
                  title={query ? '还没有找到匹配内容' : '让积累触手可及'}
                  text="搜索标题、正文或标签，找到相关记录。"
                />
              )}
            </Section>
          )}
          <footer className="workspace-footer">
            <Leaf size={12} />
            一点点整理，一步步向前。<span>栖序 · PERSONAL ASSISTANT</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div
          className={`toast ${noticeError ? 'danger' : ''}`}
          role={noticeError ? 'alert' : 'status'}
        >
          {noticeError ? <X size={17} /> : <Check size={17} />}
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {folderImport && (
        <FolderImport
          snapshot={snapshot}
          onClose={() => setFolderImport(false)}
          onImported={(updated, count) => {
            setSnapshot(updated);
            toast(`已收录或更新 ${count} 份资料`);
          }}
        />
      )}
      {editor && (
        <Editor
          key={editor.entry.id}
          initial={editor.entry}
          source={editor.source}
          snapshot={snapshot}
          onClose={() => setEditor(null)}
          onImport={(a) => setSnapshot((s) => ({ ...s, attachments: [...s.attachments, a] }))}
          onSave={async (destinations) => {
            const updated = editor.source
              ? await api.triage(editor.source.id, destinations)
              : await api.save(destinations[0]);
            setSnapshot(updated);
            toast(editor.source ? '整理完成，原始记录已保留' : '已保存');
          }}
        />
      )}
      {restorePath && (
        <Modal title="恢复这份备份？" onClose={() => !busy && setRestorePath(null)}>
          <div className="settings-body">
            <p>
              备份中的内容会替换当前记录。应用会先保存当前数据的完整安全副本，再验证并恢复数据。
            </p>
            <code className="directory">{restorePath}</code>
            <p className="muted">安全副本：数据目录中的 before-restore.assistant-backup</p>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setRestorePath(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setSnapshot(await api.restore(restorePath));
                    setRestorePath(null);
                    toast('备份恢复成功');
                  } catch (e) {
                    toast(String(e), true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '正在恢复…' : '确认恢复'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
