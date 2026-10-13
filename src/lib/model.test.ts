import { describe, it, expect } from 'vitest';
import {
  dayKey,
  localDate,
  makeEntry,
  missingNext,
  monthDays,
  onDay,
  searchEntries,
  validateEntry,
} from './model';

describe('日历与行动边界', () => {
  it('月视图有完整六周，从周一开始且包含闰日', () => {
    const days = monthDays(new Date(2024, 1, 12));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(1);
    expect(days.map(dayKey)).toContain('2024-02-29');
  });
  it('跨午夜日程出现在涉及的每一天，不包含恰好结束的日期', () => {
    const e = makeEntry('event', {
      start: new Date(2026, 9, 13, 23).toISOString(),
      end: new Date(2026, 9, 15, 0).toISOString(),
    });
    expect(onDay(e, '2026-10-13')).toBe(true);
    expect(onDay(e, '2026-10-14')).toBe(true);
    expect(onDay(e, '2026-10-15')).toBe(false);
  });
  it('截止日期不会把普通行动变为日程', () => {
    expect(onDay(makeEntry('action', { due: '2026-10-13' }), '2026-10-13')).toBe(false);
    expect(onDay(makeEntry('event', { allDay: true, due: '2026-10-13' }), '2026-10-13')).toBe(true);
  });
  it('本地日期转换保持日期原值', () => expect(dayKey(localDate('2026-01-01'))).toBe('2026-01-01'));
  it('已完成、等待和归档的行动不能算项目下一步', () => {
    const p = makeEntry('project');
    const a = makeEntry('action', { projectId: p.id });
    expect(missingNext(p, [a])).toBe(false);
    for (const patch of [{ status: 'done' }, { status: 'waiting' }, { archived: true }])
      expect(missingNext(p, [{ ...a, ...patch }])).toBe(true);
  });
  it('校验日程起止顺序，允许独立行动', () => {
    expect(validateEntry(makeEntry('action', { title: '打电话' }))).toBeNull();
    expect(
      validateEntry(
        makeEntry('event', {
          title: '会议',
          start: '2026-10-13T10:00:00Z',
          end: '2026-10-13T09:00:00Z',
        }),
      ),
    ).not.toBeNull();
  });
  it('搜索正文和标签，排除归档记录', () => {
    const a = makeEntry('resource', { body: 'Some Reference', tags: ['灵感'] });
    expect(searchEntries([a], 'reference')).toHaveLength(1);
    expect(searchEntries([a], '灵感')).toHaveLength(1);
    expect(searchEntries([{ ...a, archived: true }], '灵感')).toHaveLength(0);
  });
});
