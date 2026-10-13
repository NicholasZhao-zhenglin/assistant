import { useState, type FormEvent } from 'react';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import Modal from './Modal';
import { api, desktop } from '../lib/api';
import {
  dayKey,
  inputTime,
  kindLabels,
  makeEntry,
  validateEntry,
  type Attachment,
  type Entry,
  type Kind,
  type Snapshot,
} from '../lib/model';

export default function Editor({
  initial,
  source,
  snapshot,
  onClose,
  onSave,
  onImport,
}: {
  initial: Entry;
  source?: Entry;
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (entries: Entry[]) => Promise<void>;
  onImport: (a: Attachment) => void;
}) {
  const [entry, setEntry] = useState(initial);
  const [extra, setExtra] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [keepResource, setKeepResource] = useState(false);
  const [tagsInput, setTagsInput] = useState(initial.tags.join('，'));
  const patch = (p: Partial<Entry>) => setEntry((e) => ({ ...e, ...p }));
  async function attach() {
    setError('');
    try {
      const paths = await open({ multiple: true, directory: false });
      if (!paths) return;
      setBusy(true);
      for (const path of Array.isArray(paths) ? paths : [paths]) {
        const a = await api.importFile(path);
        onImport(a);
        setEntry((e) => ({
          ...e,
          attachments: [...e.attachments, a.id],
          title: e.title || a.name,
        }));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const clean = {
      ...entry,
      title: entry.title.trim(),
      tags: [
        ...new Set(
          tagsInput
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ],
    };
    const entries = [
      clean,
      ...extra.map((e) => ({
        ...e,
        projectId: clean.kind === 'project' ? clean.id : clean.projectId,
      })),
    ];
    if (source && clean.kind === 'project' && nextAction.trim())
      entries.push(makeEntry('action', { title: nextAction.trim(), projectId: clean.id }));
    if (source && keepResource && clean.kind !== 'resource')
      entries.push(
        makeEntry('resource', {
          title: source.title,
          body: source.body,
          attachments: source.attachments,
          projectId: clean.kind === 'project' ? clean.id : clean.projectId,
        }),
      );
    const invalid = entries.map(validateEntry).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await onSave(entries);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function changeKind(kind: Kind) {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    setEntry(
      makeEntry(kind, {
        title: entry.title,
        body: entry.body,
        attachments: entry.attachments,
        projectId: entry.projectId,
        tags: entry.tags,
        due: kind === 'event' ? dayKey() : entry.due,
        start: kind === 'event' ? start.toISOString() : null,
        end: kind === 'event' ? new Date(+start + 3600000).toISOString() : null,
      }),
    );
  }
  const projects = snapshot.entries.filter((e) => e.kind === 'project' && !e.archived);
  const actions = snapshot.entries.filter(
    (e) =>
      e.kind === 'action' && !e.archived && (!entry.projectId || e.projectId === entry.projectId),
  );
  if (initial.kind === 'inbox' && initial.status === 'processed') {
    return (
      <Modal title="原始收件" onClose={onClose}>
        <div className="settings-body source-reader">
          <h3>{initial.title}</h3>
          <p className="original-text">{initial.body || '没有补充说明'}</p>
          <small>已整理的收件保留原文。后续修改请编辑整理得到的行动、项目或资料。</small>
          <div className="attachments">
            {initial.attachments.map((id) => (
              <button
                className="attachment"
                key={id}
                onClick={() => api.openFile(id).catch((e) => setError(String(e)))}
              >
                <Paperclip size={13} />
                {snapshot.attachments.find((a) => a.id === id)?.name || '附件'}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="modal-footer">
            <span>{new Date(initial.createdAt).toLocaleString('zh-CN')}</span>
            <button className="button secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal
      title={
        source
          ? '整理这条收件'
          : `${snapshot.entries.some((e) => e.id === entry.id) ? '编辑' : '新建'}${kindLabels[entry.kind]}`
      }
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit} className="editor">
        {source && (
          <>
            <div className="source-note">
              <span>原始记录</span>
              <p>{source.title}</p>
              <small>保留原文，整理结果可在来源收件中查看。</small>
            </div>
            <div className="segmented" aria-label="整理为">
              {(['action', 'project', 'event', 'resource'] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={entry.kind === k ? 'selected' : ''}
                  onClick={() => changeKind(k)}
                >
                  {kindLabels[k]}
                </button>
              ))}
            </div>
          </>
        )}
        <label>
          标题
          <input
            autoFocus
            required
            maxLength={300}
            value={entry.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder={entry.kind === 'inbox' ? '此刻想到什么？先记下来…' : '用一句话描述这件事'}
          />
        </label>
        <label>
          {entry.kind === 'project'
            ? '期望结果 / 完成标准'
            : entry.kind === 'resource'
              ? '内容 / 链接 / 代码片段'
              : '补充说明'}
          <textarea
            rows={4}
            value={entry.body}
            onChange={(e) => patch({ body: e.target.value })}
            placeholder={
              entry.kind === 'project' ? '做到什么，才算完成？' : '写下细节、粘贴链接，或稍后再补充'
            }
          />
        </label>
        {entry.kind !== 'project' && entry.kind !== 'inbox' && (
          <label>
            关联项目
            <select
              value={entry.projectId || ''}
              onChange={(e) => patch({ projectId: e.target.value || null, actionId: null })}
            >
              <option value="">独立事项，不关联项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {entry.kind === 'resource' && (
          <label>
            关联行动
            <select
              value={entry.actionId || ''}
              onChange={(e) => patch({ actionId: e.target.value || null })}
            >
              <option value="">不关联行动</option>
              {actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {(entry.kind === 'action' || entry.kind === 'project') && (
          <div className="form-row">
            <label>
              截止日期（可选）
              <input
                type="date"
                value={entry.due || ''}
                onChange={(e) => patch({ due: e.target.value || null })}
              />
            </label>
            <label>
              状态
              <select value={entry.status} onChange={(e) => patch({ status: e.target.value })}>
                {(entry.kind === 'project'
                  ? [
                      ['active', '进行中'],
                      ['paused', '暂停'],
                      ['done', '完成'],
                    ]
                  : [
                      ['todo', '待办'],
                      ['waiting', '等待中'],
                      ['done', '完成'],
                    ]
                ).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {entry.kind === 'action' && (
          <div className="checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={entry.isNext}
                onChange={(e) => patch({ isNext: e.target.checked })}
              />{' '}
              设为下一步行动
            </label>
            <label>
              <input
                type="checkbox"
                checked={entry.focused}
                onChange={(e) => patch({ focused: e.target.checked })}
              />{' '}
              放入今日重点
            </label>
          </div>
        )}
        {entry.kind === 'event' && (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={entry.allDay}
                onChange={(e) =>
                  patch({
                    allDay: e.target.checked,
                    due: e.target.checked ? entry.due || dayKey() : entry.due,
                  })
                }
              />{' '}
              全天 / 日期承诺
            </label>
            {entry.allDay ? (
              <label>
                日期
                <input
                  required
                  type="date"
                  value={entry.due || ''}
                  onChange={(e) => patch({ due: e.target.value })}
                />
              </label>
            ) : (
              <div className="form-row">
                <label>
                  开始时间
                  <input
                    required
                    type="datetime-local"
                    value={inputTime(entry.start)}
                    onChange={(e) =>
                      patch({
                        start: e.target.value ? new Date(e.target.value).toISOString() : null,
                      })
                    }
                  />
                </label>
                <label>
                  结束时间
                  <input
                    required
                    type="datetime-local"
                    value={inputTime(entry.end)}
                    onChange={(e) =>
                      patch({ end: e.target.value ? new Date(e.target.value).toISOString() : null })
                    }
                  />
                </label>
              </div>
            )}
            <small>时间按本机时区显示：{Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
          </>
        )}
        <label>
          标签
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="例如：工作，灵感，学习"
          />
        </label>
        <div className="attachments">
          {entry.attachments.map((id) => (
            <div className="attachment" key={id}>
              <Paperclip size={14} />
              <span>{snapshot.attachments.find((a) => a.id === id)?.name || '附件'}</span>
              <button
                type="button"
                aria-label="移除附件关联"
                onClick={() => patch({ attachments: entry.attachments.filter((x) => x !== id) })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {desktop && (
            <button type="button" className="text-button" disabled={busy} onClick={attach}>
              <Paperclip size={15} />
              添加附件
            </button>
          )}
        </div>
        {source && entry.kind === 'project' && (
          <label>
            第一个下一步行动
            <input
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="例如：整理本月的数据"
            />
          </label>
        )}
        {source && entry.kind !== 'resource' && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={keepResource}
              onChange={(e) => setKeepResource(e.target.checked)}
            />{' '}
            同时把原始内容保存到资料库
          </label>
        )}
        {source && entry.kind !== 'event' && (
          <div className="additional-events">
            {extra.map((event, i) => (
              <div className="source-note" key={event.id}>
                <label>
                  附加日程标题
                  <input
                    required
                    value={event.title}
                    onChange={(e) =>
                      setExtra(extra.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                    }
                  />
                </label>
                <label>
                  日期（全天承诺）
                  <input
                    required
                    type="date"
                    value={event.due || ''}
                    onChange={(e) =>
                      setExtra(extra.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setExtra(extra.filter((x) => x.id !== event.id))}
                >
                  移除日程
                </button>
              </div>
            ))}
            {extra.length === 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setExtra([
                    makeEntry('event', { title: entry.title, allDay: true, due: dayKey() }),
                  ])
                }
              >
                <Plus size={14} /> 同时添加日期承诺
              </button>
            )}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <span>{source ? '整理后原始收件仍会保留' : '保存在你的设备上'}</span>
          <button className="button primary" disabled={busy} type="submit">
            {busy ? '正在保存…' : source ? '完成整理' : '保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
