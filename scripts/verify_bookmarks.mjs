import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const profile = await mkdtemp(`${tmpdir()}/workbench-bookmarks-`);
let context;
const errors = [];
const passed = message => console.log(`✓ ${message}`);
async function accept(page, value) {
  const dialog = page.locator('dialog[open]'); await dialog.waitFor();
  if (value !== undefined) await dialog.locator('input').fill(value);
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
}
async function choose(page, id) {
  const dialog = page.locator('dialog[open]'); await dialog.locator('select').selectOption(id); await accept(page);
}
try {
  const options = { channel: 'chromium', headless: true, acceptDownloads: true, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1360, height: 900 }, args: ['--enable-unsafe-extension-debugging'] };
  context = await chromium.launchPersistentContext(profile, options);
  const cdp = await context.browser().newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${loaded.id}/index.html`);
  const fixture = await page.evaluate(async () => {
    const roots = await chrome.bookmarks.getTree();
    const root = roots[0].children.find(node => !node.unmodifiable);
    const folder = await chrome.bookmarks.create({ parentId: root.id, title: '测试工作区' });
    const target = await chrome.bookmarks.create({ parentId: root.id, title: '归档资料' });
    const child = await chrome.bookmarks.create({ parentId: folder.id, title: '设计参考' });
    const bookmark = await chrome.bookmarks.create({ parentId: folder.id, title: '项目文档', url: 'https://example.com/docs' });
    await chrome.bookmarks.create({ parentId: child.id, title: '文档副本', url: 'https://example.com/docs' });
    await chrome.bookmarks.create({ parentId: folder.id, title: '开发工具', url: 'https://example.com/tools' });
    return { root: root.id, folder: folder.id, target: target.id, child: child.id, bookmark: bookmark.id };
  });
  await page.getByRole('button', { name: '书签管理', exact: true }).click();
  await page.locator('.bookmark-folders').getByRole('button', { name: '▱ 测试工作区', exact: true }).click();
  await page.locator('.bookmark-item').filter({ hasText: '项目文档' }).waitFor(); assert.equal(await page.locator('.bookmark-item').count(), 3);
  await page.locator('#search').fill('文档'); assert.equal(await page.locator('.bookmark-item').count(), 2);
  await page.locator('#search').fill('');
  await page.getByRole('button', { name: '查找重复书签', exact: true }).click(); assert.equal(await page.locator('.bookmark-item').count(), 2);
  await page.getByRole('button', { name: '返回文件夹', exact: true }).click(); passed('原生书签树、文件夹导航、跨目录搜索与精确重复查询');
  let item = page.locator('.bookmark-item').filter({ hasText: '项目文档' });
  await item.getByRole('button', { name: '编辑', exact: true }).click(); await accept(page, '项目指南'); await accept(page, 'https://example.com/guide'); await page.locator('#toast').filter({ hasText: '修改已同步到 Chrome' }).waitFor();
  assert.equal((await page.evaluate(id => chrome.bookmarks.get(id), fixture.bookmark))[0].url, 'https://example.com/guide');
  item = page.locator('.bookmark-item').filter({ hasText: '项目指南' });
  await item.getByRole('button', { name: '移动', exact: true }).click(); await choose(page, fixture.target); await page.locator('#toast').filter({ hasText: '已移动书签' }).waitFor();
  assert.equal((await page.evaluate(id => chrome.bookmarks.get(id), fixture.bookmark))[0].parentId, fixture.target);
  passed('编辑名称/网址与移动同步到 Chrome 原生书签');
  await page.getByRole('button', { name: '添加书签', exact: true }).click(); await choose(page, fixture.folder); await accept(page, '新建书签'); await accept(page, 'https://example.com/new');
  item = page.locator('.bookmark-item').filter({ hasText: '新建书签' }); await item.waitFor();
  await item.getByRole('button', { name: '删除', exact: true }).click(); await page.locator('dialog[open]').getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await item.count(), 1);
  await item.getByRole('button', { name: '删除', exact: true }).click(); await accept(page); await page.locator('#toast').filter({ hasText: '已删除，可在本页撤销' }).waitFor(); assert.equal(await item.count(), 0);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click(); await page.locator('#toast').filter({ hasText: '已恢复最近删除' }).waitFor(); await item.waitFor();
  passed('新建书签、取消删除、确认删除和真实 API 撤销');
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click(); await choose(page, fixture.folder); await accept(page, '空文件夹');
  await page.locator('.bookmark-item').filter({ hasText: '空文件夹' }).waitFor();
  await page.locator('.bookmark-item').filter({ hasText: '设计参考' }).getByRole('button', { name: '删除', exact: true }).click();
  await page.locator('#toast').filter({ hasText: '请先移动或删除' }).waitFor(); assert.equal(await page.locator('dialog[open]').count(), 0);
  await page.locator('.bookmark-item').filter({ hasText: '设计参考' }).getByRole('button', { name: '移动', exact: true }).click();
  const optionIds = await page.locator('dialog[open] option').evaluateAll(options => options.map(option => option.value)); assert.ok(!optionIds.includes(fixture.child));
  await page.locator('dialog[open]').getByRole('button', { name: '取消', exact: true }).click();
  passed('文件夹新建、非空目录删除保护与自身移动排除');
  await page.evaluate(async id => chrome.bookmarks.update(id, { title: '外部更新' }), fixture.bookmark);
  await page.locator('#search').fill('外部更新'); await page.locator('.bookmark-item').filter({ hasText: '外部更新' }).waitFor(); passed('Chrome 书签事件实时同步');
  await page.locator('#search').fill('');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出书签备份', exact: true }).click();
  const download = await downloadPromise, path = await download.path();
  const exported = JSON.parse(await readFile(path, 'utf8')); assert.ok(exported[0].children.length);
  await page.locator('#actions input[type=file]').setInputFiles(path); await choose(page, fixture.target); await accept(page);
  await page.locator('#toast').filter({ hasText: '导入完成' }).waitFor({ timeout: 20000 });
  const original = await page.evaluate(id => chrome.bookmarks.get(id), fixture.folder); assert.equal(original[0].title, '测试工作区');
  assert.ok((await page.evaluate(id => chrome.bookmarks.getChildren(id), fixture.target)).some(node => node.title.startsWith('书签导入')));
  passed('JSON 导出/分层导入与保留现有书签');
  const history = await page.evaluate(async () => (await chrome.storage.local.get('bookmark_history_list')).bookmark_history_list);
  assert.ok(history.length >= 7);
  const importSnapshot = history.find(item => item.action_name === '导入书签备份'); assert.ok(importSnapshot);
  await page.getByRole('button', { name: /历史快照/ }).click();
  await page.locator('.bookmark-history-list .bookmark-item').first().getByRole('button', { name: '预览', exact: true }).click();
  await page.locator('.bookmark-preview .restore-list').waitFor();
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/bookmark-history-1.2.png' });
  await page.locator('.bookmark-history-list .bookmark-item').filter({ hasText: '导入书签备份' }).getByRole('button', { name: '恢复此版本', exact: true }).click();
  await accept(page); await page.locator('#toast').filter({ hasText: '已恢复书签版本' }).waitFor({ timeout: 20000 });
  assert.ok(!(await page.evaluate(async () => JSON.stringify(await chrome.bookmarks.getTree()))).includes('书签导入'));
  const restored = await page.evaluate(async () => (await chrome.storage.local.get('bookmark_history_list')).bookmark_history_list);
  assert.ok(restored[0].action_name.startsWith('恢复历史：'));
  assert.ok(JSON.stringify(restored[0].bookmark_tree).includes('书签导入'));
  const shape = nodes => nodes.map(node => ({ title: node.title, ...(node.url ? { url: node.url } : { children: shape(node.children || []) }) }));
  assert.deepEqual(shape(await page.evaluate(() => chrome.bookmarks.getTree())), shape(importSnapshot.bookmark_tree));
  passed('历史快照预览、恢复完整目录/顺序、自动保存恢复前的版本');
  // Restore back to the state before restoration; API IDs intentionally differ, contents do not.
  await page.evaluate(snapshot_id => chrome.runtime.sendMessage({ action_type: 'bookmark_restore', action_data: { snapshot_id } }), restored[0].snapshot_id);
  assert.deepEqual(shape(await page.evaluate(() => chrome.bookmarks.getTree())), shape(restored[0].bookmark_tree));
  passed('恢复操作本身可通过历史反向恢复');
  const latestIds = await page.evaluate(async () => {
    const trees = await chrome.bookmarks.getTree();
    const root = trees[0].children.find(node => !node.unmodifiable);
    const folder = root.children.find(node => node.title === '测试工作区');
    const item = folder.children.find(node => node.url);
    return { root: root.id, folder: folder.id, item: item.id };
  });
  for (let i = 0; i < 23; i++) {
    const reply = await page.evaluate(args => chrome.runtime.sendMessage({ action_type: 'bookmark_update', action_data: { id: args.id, title: `版本 ${args.i}` } }), { id: latestIds.item, i });
    assert.equal(reply.is_success, true, reply.error_text);
  }
  const capped = await page.evaluate(async () => (await chrome.storage.local.get('bookmark_history_list')).bookmark_history_list);
  assert.equal(capped.length, 20);
  assert.equal(capped[0].action_name, '编辑：版本 21');
  const beforeNoop = capped.map(item => item.snapshot_id);
  const failed = await page.evaluate(id => chrome.runtime.sendMessage({ action_type: 'bookmark_move', action_data: { id, parentId: id } }), latestIds.folder);
  assert.equal(failed.is_success, false);
  const afterNoop = await page.evaluate(async () => (await chrome.storage.local.get('bookmark_history_list')).bookmark_history_list.map(item => item.snapshot_id));
  assert.deepEqual(afterNoop, beforeNoop); passed('真实连续 23 次操作保留最近 20 次；失败操作不占历史名额');
  await page.waitForTimeout(650);
  assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get('bookmark_history_list')).bookmark_history_list.map(item => item.snapshot_id)), afterNoop);
  await page.reload(); await page.getByRole('button', { name: '书签管理', exact: true }).click();
  await page.getByRole('button', { name: /历史快照/ }).click();
  assert.equal(await page.locator('.bookmark-history-list .bookmark-item').count(), 20);
  await page.screenshot({ path: 'docs/screenshots/bookmark-history-1.2.png' }); passed('页面重载后历史仍持久保存，静置不会产生虚假快照');
  // Inject a staging failure in the local module only: existing native bookmarks must survive.
  const rollback = await page.evaluate(async () => {
    const { restoreBookmarkTree, bookmarkTreeValue } = await import('./bookmark-history.js');
    const before = bookmarkTreeValue(await chrome.bookmarks.getTree());
    const original = chrome.bookmarks.create; let calls = 0, error = '';
    chrome.bookmarks.create = (...args) => ++calls === 2 ? Promise.reject(new Error('staging-test-failure')) : original(...args);
    try { await restoreBookmarkTree(before); } catch (caught) { error = caught.message; } finally { chrome.bookmarks.create = original; }
    return { error, before, after: bookmarkTreeValue(await chrome.bookmarks.getTree()) };
  });
  assert.match(rollback.error, /原书签已保留/); assert.deepEqual(rollback.after, rollback.before); passed('恢复暂存阶段失败时保留原书签');
  const commitFailure = await page.evaluate(async () => {
    const { restoreBookmarkTree, bookmarkTreeValue } = await import('./bookmark-history.js');
    const before = bookmarkTreeValue(await chrome.bookmarks.getTree());
    const original = chrome.bookmarks.move; let calls = 0, error = '';
    chrome.bookmarks.move = (...args) => ++calls === 2 ? Promise.reject(new Error('commit-test-failure')) : original(...args);
    try { await restoreBookmarkTree(before); } catch (caught) { error = caught.message; } finally { chrome.bookmarks.move = original; }
    return { error, before, after: bookmarkTreeValue(await chrome.bookmarks.getTree()) };
  });
  assert.match(commitFailure.error, /原书签已保留/); assert.deepEqual(commitFailure.after, commitFailure.before); passed('恢复中途移动失败时回退原目录、内容与顺序');
  const replies = await page.evaluate(id => Promise.all(['并发 A', '并发 B'].map(title => chrome.runtime.sendMessage({ action_type: 'bookmark_update', action_data: { id, title } }))), latestIds.item);
  assert.ok(replies.every(reply => reply.is_success));
  const concurrentHistory = await page.evaluate(async () => (await chrome.storage.local.get('bookmark_history_list')).bookmark_history_list);
  assert.equal(concurrentHistory.length, 20); assert.equal(concurrentHistory[0].action_name, '编辑：并发 A'); assert.equal(concurrentHistory[1].action_name, '编辑：版本 22');
  passed('并发操作串行保存，20 份历史无覆盖');
  await page.getByRole('button', { name: '返回书签', exact: true }).click();
  await page.locator('.bookmark-folders').getByRole('button', { name: '▱ 测试工作区', exact: true }).first().click();
  await mkdir('docs/screenshots', { recursive: true }); await page.screenshot({ path: 'docs/screenshots/bookmarks-1.2.png' });
  await page.setViewportSize({ width: 640, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'docs/screenshots/bookmarks-mobile-1.2.png' }); passed('桌面与窄屏布局无水平溢出');
  assert.deepEqual(errors, []); passed('无页面脚本错误');
  await context.close(); context = await chromium.launchPersistentContext(profile, options);
  const restartCDP = await context.browser().newBrowserCDPSession();
  const restartLoaded = await restartCDP.send('Extensions.loadUnpacked', { path: resolve('extension') });
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${restartLoaded.id}/index.html`);
  await reopened.getByRole('button', { name: '书签管理', exact: true }).click();
  await reopened.getByRole('button', { name: /历史快照/ }).click();
  assert.equal(await reopened.locator('.bookmark-history-list .bookmark-item').count(), 20);
  passed('浏览器进程重启后 20 份历史仍可读取');
} finally {
  if (context) await context.close(); await rm(profile, { recursive: true, force: true });
}
