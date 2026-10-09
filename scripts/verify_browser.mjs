// Exercises actual Chrome APIs in an isolated profile; no mocked chrome.* implementation.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
const profile = await mkdtemp(`${tmpdir()}/tab-workbench-`);
await mkdir('output/playwright', { recursive: true });
await mkdir('docs/screenshots', { recursive: true });
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<html lang="zh-CN"><title>验收项目 ${request.url}</title><body style="font-family:system-ui;padding:50px;background:#eef3e9"><h1>网页截图验收</h1><p>JSON、截图和办公任务的测试网页。</p><pre>{"name":"趁手","task":"轻办"}</pre></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context;
const catalog = JSON.parse(await readFile('extension/catalog.json', 'utf8'));
const results = [], errors = [];
async function acceptAsk(page, value = '验收工作现场') {
  const dialog = page.locator('.ask-dialog'); await dialog.waitFor();
  if (await dialog.locator('input').count()) await dialog.locator('input').fill(value);
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}
async function waitForPage(predicate) {
  for (let i = 0; i < 200; i++) { const found = context.pages().find(predicate); if (found) return found; await delay(50); }
  throw new Error('等待新页面完成导航超时');
}
function passed(name) { results.push(name); console.log(`✓ ${name}`); }
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: 'chromium' }), headless: false, ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1360, height: 900 },
    // This flag only enables the test harness to trigger toolbar actions in the isolated test browser.
    args: ['--enable-unsafe-extension-debugging'],
  });
  const browserCDP = await context.browser().newBrowserCDPSession();
  const loaded = await browserCDP.send('Extensions.loadUnpacked', { path: resolve('extension') });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
  const id = loaded.id, root = `chrome-extension://${id}/`;
  context.on('page', page => { page.on('pageerror', error => errors.push({ page_url: page.url(), error_text: error.message, error_stack: error.stack })); page.on('crash', () => console.log('PAGE CRASH', page.url())); });
  await context.route(/https:\/\/(tools|qingban)\.hzcmzhfw\.cn\//, route => route.request().resourceType() === 'document' ? route.fulfill({ contentType: 'text/html', body: '<title>工具目标页</title><h1>正确的工具网址</h1>' }) : route.continue());
  const page = await context.newPage(); page.on('dialog', dialog => dialog.accept(dialog.type() === 'prompt' ? '验收工作现场' : undefined));
  await page.goto(`${root}index.html`);
  assert.equal(await page.locator('#heading').innerText(), '标签管理');
  await page.locator('[data-view="tools"]').click();
  await page.locator('.row').first().waitFor();
  assert.equal(await page.locator('.row').count(), catalog.length);
  await page.locator('#search').fill('JSON'); assert.ok(await page.locator('.row').count() > 10);
  await page.locator('.row button').first().click();
  await page.locator('[data-site="收藏"]').click(); assert.equal(await page.locator('.row').count(), 1);
  const targetPromise = context.waitForEvent('page'); await page.locator('.row a.title').click();
  const targetPage = await targetPromise; await targetPage.waitForURL('https://tools.hzcmzhfw.cn/**'); await targetPage.waitForLoadState(); assert.ok(targetPage.url().startsWith('https://tools.hzcmzhfw.cn/')); await targetPage.close();
  await page.locator('[data-site="最近"]').click(); assert.equal(await page.locator('.row').count(), 1);
  await page.locator('[data-site="全部"]').click(); await page.locator('#search').fill('');
  await page.waitForTimeout(200); await page.screenshot({ path: 'docs/screenshots/tools.png' });
  passed('目录搜索、收藏、最近使用与网站直达');

  // Concurrent UI writes are serialized by the actual service worker.
  const before = await page.evaluate(() => chrome.storage.local.get('favorite_tool_ids'));
  await page.evaluate(async () => {
    const ids = ['https://tools.hzcmzhfw.cn/encode/base64/', 'https://tools.hzcmzhfw.cn/encode/url/'];
    await Promise.all(ids.map(tool_id => chrome.runtime.sendMessage({ action_type: 'favorite_toggle', action_data: { tool_id } })));
  });
  const after = await page.evaluate(() => chrome.storage.local.get('favorite_tool_ids'));
  assert.equal(after.favorite_tool_ids.length, before.favorite_tool_ids.length + 2);
  passed('并发收藏写入无覆盖');

  // Duplicate closing is scoped to a chosen URL, and undo really reopens the duplicate.
  const first = await context.newPage(); await first.goto(`${base}/duplicate`);
  const second = await context.newPage(); await second.goto(`${base}/duplicate`);
  await page.locator('[data-view="tabs"]').click();
  await page.getByRole('button', { name: '预览重复标签', exact: true }).click();
  assert.match(await page.locator('#count').innerText(), /1 个重复标签/);
  await page.getByRole('button', { name: '关闭预览重复项', exact: true }).click(); await acceptAsk(page);
  await page.getByRole('button', { name: /撤销关闭/ }).click();
  await page.locator('#toast').filter({ hasText: '已恢复 1 个标签' }).waitFor();
  const duplicateCount = await page.evaluate(url => chrome.tabs.query({ url }), `${base}/duplicate`);
  assert.equal(duplicateCount.length, 2);
  passed('重复清理预览、确认关闭与撤销');

  await page.getByRole('button', { name: '返回全部标签', exact: true }).click();
  const oneRow = page.locator('.row').filter({ hasText: `${base}/duplicate` }).first();
  await oneRow.getByRole('button', { name: '稍后看', exact: true }).click(); await acceptAsk(page);
  await page.locator('[data-view="saved"]').click();
  await page.locator('.row').first().waitFor(); assert.equal(await page.locator('.row').count(), 1);
  await page.locator('.row').getByRole('button', { name: '备注', exact: true }).click(); await acceptAsk(page);
  await page.locator('#search').fill('验收工作现场'); assert.equal(await page.locator('.row').count(), 1);
  await page.locator('.row').getByRole('button', { name: '归档', exact: true }).click();
  assert.equal(await page.locator('.row').count(), 0);
  await page.getByLabel('阅读状态', { exact: true }).selectOption('已归档'); assert.equal(await page.locator('.row').count(), 1);
  passed('稍后再看、备注搜索与阅读归档');

  // Clear test webpage tabs, then save a multi-window/group snapshot.
  await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    await chrome.tabs.remove(tabs.filter(tab => tab.url.startsWith('http://127.0.0.1')).map(tab => tab.id));
  });
  const layout = await page.evaluate(async base => {
    const [dashboard] = (await chrome.tabs.query({})).filter(tab => tab.url.endsWith('/index.html'));
    const a = await chrome.tabs.create({ url: `${base}/project-a`, pinned: true, windowId: dashboard.windowId, active: false });
    const b = await chrome.tabs.create({ url: `${base}/project-b`, windowId: dashboard.windowId, active: false });
    const c = await chrome.tabs.create({ url: `${base}/project-c`, windowId: dashboard.windowId, active: false });
    const groupId = await chrome.tabs.group({ tabIds: [b.id, c.id] });
    await chrome.tabGroups.update(groupId, { title: '接口排查', color: 'green', collapsed: true });
    const window = await chrome.windows.create({ url: `${base}/office`, focused: false });
    return { tab_ids: [a.id, b.id, c.id, ...window.tabs.map(tab => tab.id)] };
  }, base);
  await page.locator('[data-view="sessions"]').click();
  await page.getByRole('button', { name: '保存全部窗口会话', exact: true }).click(); await acceptAsk(page);
  await page.locator('.row').filter({ hasText: '验收工作现场' }).waitFor();
  const savedData = await page.evaluate(() => chrome.storage.local.get('session_list'));
  assert.equal(savedData.session_list[0].tab_list.length, 4);
  assert.equal(new Set(savedData.session_list[0].tab_list.map(tab => tab.window_id)).size, 2);
  await page.evaluate(ids => chrome.tabs.remove(ids), layout.tab_ids);
  await page.getByRole('button', { name: '预览与恢复', exact: true }).click();
  await page.getByRole('button', { name: '恢复所选页面', exact: true }).click();
  await page.locator('#toast').filter({ hasText: '已恢复 4 个标签' }).waitFor();
  const restored = await page.evaluate(async base => {
    const tabs = (await chrome.tabs.query({})).filter(tab => tab.url.startsWith(base));
    const group = await chrome.tabGroups.get(tabs.find(tab => tab.groupId >= 0).groupId);
    return { tab_cnt: tabs.length, window_cnt: new Set(tabs.map(tab => tab.windowId)).size, pinned_cnt: tabs.filter(tab => tab.pinned).length, group_name: group.title, group_color: group.color, is_collapsed: group.collapsed };
  }, base);
  assert.deepEqual(restored, { tab_cnt: 4, window_cnt: 2, pinned_cnt: 1, group_name: '接口排查', group_color: 'green', is_collapsed: true });
  await page.getByRole('button', { name: '预览与恢复', exact: true }).click();
  await page.getByRole('button', { name: '恢复所选页面', exact: true }).click();
  await page.locator('#toast').filter({ hasText: '已恢复 0 个标签' }).waitFor();
  await page.waitForTimeout(200); await page.screenshot({ path: 'docs/screenshots/sessions.png' });
  passed('多窗口、固定标签、标签组与折叠状态恢复，重复恢复去重');

  // Native move, mute and discard APIs are checked on real tabs via the UI.
  await page.locator('[data-view="tabs"]').click();
  await page.getByLabel('标签分组方式', { exact: true }).selectOption('window');
  const movable = page.locator('.row').filter({ hasText: `${base}/project-b` });
  await movable.getByRole('checkbox').check();
  await page.getByRole('button', { name: '静音所选', exact: true }).click();
  const nativeMuted = await page.evaluate(async url => (await chrome.tabs.query({ url }))[0].mutedInfo.muted, `${base}/project-b`); assert.equal(nativeMuted, true);
  await page.getByRole('button', { name: '取消静音', exact: true }).click();
  await page.getByLabel('移动标签到窗口', { exact: true }).selectOption('new');
  await page.locator('#toast').filter({ hasText: '标签已移动' }).waitFor();
  await page.waitForTimeout(250); await page.screenshot({ path: 'docs/screenshots/tabs.png' });
  passed('窗口视图、批量静音及跨窗口移动');

  // The native discard success path is verified separately without attaching to the web renderer.
  // This run checks that pinned tabs cannot be discarded through the UI.
  await page.locator('[data-view="tools"]').click(); await page.locator('[data-view="tabs"]').click();
  const protectedRow = page.locator('.row').filter({ hasText: `${base}/project-a` });
  await protectedRow.getByRole('checkbox').check();
  await page.getByRole('button', { name: '休眠所选', exact: true }).click();
  await page.locator('#toast').filter({ hasText: '没有可休眠页面' }).waitFor();
  const protectedTab = await page.evaluate(async url => (await chrome.tabs.query({ url }))[0], `${base}/project-a`);
  assert.equal(protectedTab.discarded, false); assert.equal(protectedTab.pinned, true);
  passed('固定标签休眠保护（成功休眠另行隔离验证）');

  await page.locator('[data-view="settings"]').click(); await page.getByLabel('主题', { exact: true }).selectOption('dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark'); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 JSON 备份', exact: true }).click();
  const download = await downloadPromise; const file = 'output/playwright/backup.json'; await download.saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8')); assert.equal(backup.backup_version, 1); assert.equal(backup.backup_data.session_list.length, 1);
  await page.locator('input[type="file"]').setInputFiles(file); await acceptAsk(page);
  await page.locator('#toast').filter({ hasText: '备份导入完成' }).waitFor();
  const imported = await page.evaluate(() => chrome.storage.local.get(['session_list', 'saved_tab_list']));
  assert.equal(imported.session_list.length, 2); assert.equal(imported.saved_tab_list.length, 1);
  await page.getByLabel('主题', { exact: true }).selectOption('light');
  passed('主题切换、实际下载与备份合并导入');

  // Use the background's real handoff code; concurrent messages get separate one-time IDs.
  const handoffs = await page.evaluate(async () => {
    const create = input_text => chrome.runtime.sendMessage({ action_type: 'handoff_create', action_data: { input_text, image_url: '', image_data: '', target_url: 'https://tools.hzcmzhfw.cn/json/' } });
    return Promise.all([create('{"name":"趁手"}'), create('{"name":"轻办"}')]);
  });
  assert.ok(handoffs.every(reply => reply.is_success)); assert.notEqual(handoffs[0].result_data, handoffs[1].result_data);
  let handoff;
  for (let i = 0; i < 100; i++) { handoff = context.pages().find(item => item.url().includes(handoffs[0].result_data)); if (handoff) break; await page.waitForTimeout(50); }
  assert.ok(handoff, '交接页必须打开');
  await handoff.getByRole('button', { name: '整理 JSON', exact: true }).click();
  assert.match(await handoff.locator('#content').inputValue(), /\n/);
  await handoff.reload(); await handoff.locator('#hint').filter({ hasText: '已过期' }).waitFor();
  passed('并发右键内容交接隔离与一次性清理');

  // Trigger an actual toolbar action through CDP to grant activeTab and capture a real webpage.
  const source = await context.newPage(); await source.goto(`${base}/capture`); await source.bringToFront();
  const { targetInfos } = await browserCDP.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  const targetInfo = targetInfos.find(target => target.type === 'tab' && target.url === source.url());
  if (!targetInfo) throw new Error('未找到真实工具栏所属的 tab target');
  await browserCDP.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
  const sourceTab = await page.evaluate(async url => (await chrome.tabs.query({ url }))[0], source.url());
  const permissionCheck = await page.evaluate(async windowId => {
    try { return (await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })).slice(0, 22); }
    catch (error) { return error.message; }
  }, sourceTab.windowId);
  assert.equal(permissionCheck, 'data:image/png;base64,');
  await page.evaluate(async args => chrome.tabs.create({ url: args.url, windowId: args.windowId, active: false }), { url: `${root}popup.html`, windowId: sourceTab.windowId });
  const popup = await waitForPage(item => item.url() === `${root}popup.html`); await popup.locator('#capture').waitFor();
  await popup.waitForTimeout(200); await popup.locator('body').screenshot({ path: 'docs/screenshots/popup.png' });
  const beforeCapture = new Set(context.pages());
  await popup.evaluate(() => document.getElementById('capture').click());
  const capture = await waitForPage(item => !beforeCapture.has(item) && item.url().startsWith(`${root}handoff.html`)); await capture.locator('#preview').waitFor();
  await capture.locator('#preview').evaluate(image => image.decode());
  assert.ok(await capture.locator('#preview').evaluate(image => image.naturalWidth > 0));
  await capture.screenshot({ path: 'docs/screenshots/capture.png' });
  const imageDownload = capture.waitForEvent('download');
  const toolPagePromise = context.waitForEvent('page'); await capture.getByRole('button', { name: '下载截图并打开工具 ↗', exact: true }).click();
  const imageFile = await imageDownload; await imageFile.saveAs('output/playwright/captured.png');
  const toolPage = await toolPagePromise; await toolPage.waitForURL('https://qingban.hzcmzhfw.cn/**'); await toolPage.waitForLoadState(); assert.equal(toolPage.url(), 'https://qingban.hzcmzhfw.cn/tools/annotate/');
  passed('真实工具栏 activeTab 授权、网页截图、图片下载和轻办标注引导');

  await page.setViewportSize({ width: 560, height: 850 }); await page.locator('[data-view="tools"]').click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const extensionErrors = errors.filter(error => error.page_url.startsWith(root));
  assert.deepEqual(extensionErrors, []);
  passed('窄屏无横向溢出、扩展页面无脚本错误');
  const report = { browser_version: context.browser().version(), extension_id: id, verified_at: new Date().toISOString(), passed_checks: results, page_errors: errors };
  await writeFile('output/playwright/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true });
}
