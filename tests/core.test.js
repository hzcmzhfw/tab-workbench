import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl, toolUrl, duplicateIds, duplicateKey, filterTools, tabSnapshot, validateBackup, mergeBackup } from '../extension/core.js';
const catalog = [{ tool_id: 'https://tools.hzcmzhfw.cn/json/', tool_name: 'JSON 格式化', tool_desc: '校验与压缩', tool_keywords: 'pretty', site_name: '趁手' }];
const backup = () => ({ backup_version: 1, backup_data: { favorite_tool_ids: [catalog[0].tool_id, 'javascript:alert(1)'], session_list: [], saved_tab_list: [], settings_data: {} } });
test('精确去重保留固定标签、活动标签与不同业务参数', () => {
  const tabs = [{ id: 1, url: 'https://a.com/', pinned: false }, { id: 2, url: 'https://a.com/', active: true }, { id: 3, url: 'https://a.com/', pinned: true }, { id: 4, url: 'https://a.com/?x=1' }, { id: 5, url: 'chrome://settings' }];
  assert.deepEqual(duplicateIds(tabs), [2, 1]);
  assert.deepEqual(duplicateIds(tabs.slice(0, 2)), [1]);
});
test('多个固定副本均受到保护', () => assert.deepEqual(duplicateIds([{ id: 1, url: 'https://a.com', pinned: true }, { id: 2, url: 'https://a.com', pinned: true }]), []));
test('可选忽略追踪参数，保留业务参数和 hash', () => {
  assert.equal(duplicateKey('https://a.com/?x=1&utm_source=test#section', true), 'https://a.com/?x=1#section');
  assert.deepEqual(duplicateIds([{ id: 1, url: 'https://a.com/?x=1&utm_source=a' }, { id: 2, url: 'https://a.com/?x=1&utm_source=b' }, { id: 3, url: 'https://a.com/?x=2' }], true), [2]);
});
test('拒绝脚本网址，网站工具限制到两个 HTTPS 域名', () => {
  for (const url of ['javascript:alert(1)', 'chrome://settings', 'file:///tmp/private', 'not a url']) assert.equal(safeUrl(url), false);
  assert.equal(safeUrl('https://example.com'), true);
  for (const url of ['https://tools.hzcmzhfw.cn.evil.com/', 'http://tools.hzcmzhfw.cn/', 'https://evil.com/']) assert.equal(toolUrl(url), false);
  assert.equal(toolUrl(catalog[0].tool_id), true);
});
test('收藏与多关键词查询包含英文别名', () => {
  assert.equal(filterTools(catalog, 'json pretty', '收藏', [catalog[0].tool_id]).length, 1);
  assert.equal(filterTools(catalog, 'json missing', '全部', []).length, 0);
  assert.equal(filterTools(catalog, '', '轻办', []).length, 0);
});
test('快照保存窗口、顺序、固定状态与标签组', () => {
  const result = tabSnapshot({ url: 'https://a.com', title: 'A', index: 4, windowId: 2, groupId: 7, pinned: false }, { title: '开发', color: 'green', collapsed: true });
  assert.equal(result.window_id, 2); assert.equal(result.tab_index, 4); assert.equal(result.group_key, '2:7'); assert.equal(result.group_name, '开发'); assert.equal(result.is_group_collapsed, true);
});
test('导入校验过滤未知工具并拒绝危险页面', () => {
  assert.deepEqual(validateBackup(backup(), catalog).favorite_tool_ids, [catalog[0].tool_id]);
  const value = backup(); value.backup_data.session_list.push({ tab_list: [{ tab_url: 'javascript:alert(1)' }] });
  assert.throws(() => validateBackup(value, catalog), /不支持的网址/);
  assert.throws(() => validateBackup({ backup_version: 2 }, catalog), /v1/);
  assert.throws(() => validateBackup({ backup_version: 1, backup_data: {} }, catalog), /格式/);
});
test('合并导入保留当前设置并对收藏夹内网址去重', () => {
  const a = { favorite_tool_ids: ['a'], saved_tab_list: [{ collection_name: '工作', tab_url: 'https://a.com' }], session_list: [], settings_data: { theme_name: 'dark' } };
  const b = { favorite_tool_ids: ['a', 'b'], saved_tab_list: [{ collection_name: '工作', tab_url: 'https://a.com' }, { collection_name: '阅读', tab_url: 'https://a.com' }], session_list: [{ session_name: '新会话' }], settings_data: { theme_name: 'light' } };
  const result = mergeBackup(a, b); assert.equal(result.saved_tab_list.length, 2); assert.equal(result.settings_data.theme_name, 'dark'); assert.deepEqual(result.favorite_tool_ids, ['a', 'b']); assert.equal(result.session_list.length, 1);
});
