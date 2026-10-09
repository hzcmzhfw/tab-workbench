import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkNodes, bookmarkDescendants, bookmarkDuplicates, validateBookmarkImport } from '../extension/bookmark-core.js';
const tree = [{ id: '0', title: '', children: [{ id: '1', parentId: '0', title: '书签栏', children: [
  { id: '2', parentId: '1', title: '项目', children: [{ id: '3', parentId: '2', title: '网站', url: 'https://example.com/' }] },
  { id: '4', parentId: '1', title: '副本', url: 'https://example.com/' },
  { id: '5', parentId: '1', title: '不同参数', url: 'https://example.com/?id=2' },
] }] }];
test('书签树保留 Chrome 节点与父子关系，移动排除自身及后代', () => {
  assert.equal(bookmarkNodes(tree).length, 6);
  assert.deepEqual([...bookmarkDescendants(tree[0].children[0].children[0])], ['2', '3']);
});
test('原生书签重复查询比较完整网址并包含所有副本', () => {
  assert.deepEqual([...bookmarkDuplicates(bookmarkNodes(tree))], ['3', '4']);
});
test('书签导入移除原有 ID，保留层级与内容', () => {
  const cleaned = validateBookmarkImport(tree);
  assert.equal(cleaned[0].children[0].children[0].children[0].url, 'https://example.com/');
  assert.equal(cleaned[0].id, undefined);
});
test('书签导入拒绝脚本地址、错误结构和过深目录', () => {
  assert.throws(() => validateBookmarkImport([{ title: '危险', url: 'javascript:alert(1)' }]));
  assert.throws(() => validateBookmarkImport([{ title: '无子树' }]));
  assert.throws(() => validateBookmarkImport({ title: '不是树' }));
  let node = { title: '叶子', children: [] };
  for (let i = 0; i < 34; i++) node = { title: '深目录', children: [node] };
  assert.throws(() => validateBookmarkImport([node]));
});

import { bookmarkTreeValue, appendBookmarkHistory } from '../extension/bookmark-history.js';
test('历史保留最近 20 次，顺序为最新在前', () => {
  let history = [];
  for (let i = 0; i < 25; i++) history = appendBookmarkHistory(history, { snapshot_id: String(i) });
  assert.equal(history.length, 20);
  assert.equal(history[0].snapshot_id, '24');
  assert.equal(history.at(-1).snapshot_id, '5');
});
test('快照忽略易变日期但保留顺序、ID、层级和特殊协议', () => {
  const value = bookmarkTreeValue([{ id: '1', title: '根', dateAdded: 123, children: [{ id: '2', parentId: '1', index: 0, title: '脚本书签', url: 'javascript:void(0)' }] }]);
  assert.equal(value[0].dateAdded, undefined);
  assert.equal(value[0].children[0].index, 0);
  assert.equal(value[0].children[0].url, 'javascript:void(0)');
});

test('存储返回不同的对象键顺序不会被误判为书签外部修改', () => {
  const original = [{ id: '0', title: '', children: [{ id: '1', title: '书签栏', parentId: '0', index: 0, children: [] }] }];
  const reordered = [{ children: [{ children: [], index: 0, parentId: '0', title: '书签栏', id: '1' }], title: '', id: '0' }];
  assert.equal(JSON.stringify(bookmarkTreeValue(original)), JSON.stringify(bookmarkTreeValue(reordered)));
});
