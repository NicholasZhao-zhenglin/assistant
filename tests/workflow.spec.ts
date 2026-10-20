import { test, expect } from '@playwright/test';

test('收件 → 项目/行动/资料 → 完成 → 重载 → 搜索与归档恢复', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '快速记录' }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('下周项目汇报');
  await page.getByRole('textbox', { name: '补充说明' }).fill('参考材料与业务数据');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: '收件箱' }).click();
  await page.getByRole('button', { name: '整理', exact: true }).click();
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByRole('textbox', { name: '第一个下一步行动' }).fill('整理本月数据');
  await page.getByLabel('同时把原始内容保存到资料库').check();
  await page.getByRole('button', { name: '完成整理' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: '项目清单' }).click();
  await page.getByRole('button', { name: '下周项目汇报', exact: true }).click();
  await expect(page.getByRole('button', { name: '整理本月数据', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '相关资料' })).toBeVisible();
  await page.getByRole('button', { name: '完成 整理本月数据', exact: true }).click();
  await expect(page.getByText('这个项目还没有可执行的下一步。')).toBeVisible();
  await page.reload();
  await page.getByRole('textbox', { name: '搜索全部内容' }).fill('参考材料');
  await expect(page.getByRole('button', { name: '整理本月数据', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '下周项目汇报', exact: true }).first(),
  ).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '资料库' }).click();
  await page.getByRole('button', { name: '归档 下周项目汇报', exact: true }).click();
  await page.getByRole('button', { name: '已归档', exact: true }).click();
  await page.getByRole('button', { name: '恢复 下周项目汇报', exact: true }).click();
  await page.getByRole('button', { name: '全部资料', exact: true }).click();
  await expect(page.locator('.entry-title').filter({ hasText: '下周项目汇报' })).toBeVisible();
});

test('独立行动、日程与小屏幕布局', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '添加行动', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('给物业打电话');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '给物业打电话', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '日历', exact: true }).click();
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('设计评审');
  await page.getByLabel('全天 / 日期承诺').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.calendar-event').filter({ hasText: '设计评审' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: '日历.', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/calendar-mobile.png', fullPage: true });
});

test('首页截图与空状态', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '给今天，留一点从容。' })).toBeVisible();
  await expect(page.getByText('今天，想推进什么？')).toBeVisible();
  await page.screenshot({ path: 'test-results/today-desktop.png', fullPage: true });
});

test('文件夹收录预览、默认选择、更新与再次扫描（模拟桌面 IPC）', async ({ page }) => {
  await page.addInitScript(() => {
    let imported = false;
    let selectedCount = 0;
    const rows = [
      {
        path: '/fixture/new.html',
        title: '新生成的讲解',
        sha256: 'a'.repeat(64),
        status: 'new',
        detail: '1 个文件（含页面）',
      },
      {
        path: '/fixture/updated.html',
        title: '已有资料的新版本',
        sha256: 'b'.repeat(64),
        status: 'update',
        detail: '2 个文件（含页面）',
      },
      {
        path: '/fixture/saved.html',
        title: '已经收录',
        sha256: 'c'.repeat(64),
        status: 'duplicate',
        detail: '1 个文件（含页面）',
      },
      {
        path: '/fixture/broken.html',
        title: '缺失图片的页面',
        sha256: '',
        status: 'error',
        detail: '配套文件无法读取',
      },
    ];
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        invoke: async (cmd: string, args: { selected?: typeof rows }) => {
          if (cmd === 'get_snapshot') return { entries: [], attachments: [] };
          if (cmd === 'data_directory') return '/fixture/data';
          if (cmd === 'plugin:dialog|open') return '/fixture';
          if (cmd === 'scan_html_folder')
            return imported
              ? rows.map((r) =>
                  r.status === 'new' || r.status === 'update' ? { ...r, status: 'duplicate' } : r,
                )
              : rows;
          if (cmd === 'import_html_files') {
            selectedCount = args.selected?.length || 0;
            if (selectedCount !== 2) throw new Error('测试要求新增与更新均被选中');
            imported = true;
            return { entries: [], attachments: [] };
          }
          return 1;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
  });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: '资料库' }).click();
  await page.getByRole('button', { name: '从文件夹收录' }).click();
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('1 份新增 · 1 份更新 · 1 份已收录 · 1 份无法收录')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /新生成的讲解/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /已有资料的新版本/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /已经收录/ })).toBeDisabled();
  await expect(dialog.getByRole('checkbox', { name: /缺失图片/ })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /已有资料的新版本/ }).check();
  await page.screenshot({ path: 'test-results/folder-import.png', fullPage: true });
  await dialog.getByRole('button', { name: '收录所选 (2)' }).click();
  await expect(dialog.getByText(/同批重复内容自动合并/)).toBeVisible();
  await dialog.getByRole('button', { name: '扫描新增 / 更新' }).click();
  await expect(dialog.getByText('0 份新增 · 0 份更新 · 3 份已收录 · 1 份无法收录')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '收录所选', exact: true })).toBeDisabled();
});
