import { safeUrl } from './core.js';

// Chrome's BookmarkTreeNode fields retain their official API names.
export function bookmarkNodes(tree) {
  const nodes = [];
  const walk = node => { nodes.push(node); for (const child of node.children || []) walk(child); };
  for (const node of tree) walk(node);
  return nodes;
}
export function bookmarkDescendants(node) {
  return new Set(bookmarkNodes([node]).map(item => item.id));
}
export function bookmarkDuplicates(nodes) {
  const count = new Map();
  for (const node of nodes) if (node.url) count.set(node.url, (count.get(node.url) || 0) + 1);
  return new Set(nodes.filter(node => node.url && count.get(node.url) > 1).map(node => node.id));
}
export function validateBookmarkImport(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('请选择浏览工作台导出的书签 JSON');
  let count = 0;
  const clean = (node, depth = 0) => {
    if (++count > 10000 || depth > 32) throw new Error('最多导入 10000 个节点，目录深度不能超过 32 层');
    if (!node || typeof node !== 'object' || typeof node.title !== 'string' || node.title.length > 2000) throw new Error('书签名称格式不正确');
    if (node.url !== undefined) {
      if (typeof node.url !== 'string' || node.url.length > 10000 || !safeUrl(node.url)) throw new Error('导入仅支持 HTTP / HTTPS 书签，请移除脚本或特殊协议网址');
      return { title: node.title, url: node.url };
    }
    if (!Array.isArray(node.children)) throw new Error('书签文件夹格式不正确');
    return { title: node.title, children: node.children.map(child => clean(child, depth + 1)) };
  };
  return value.map(node => clean(node));
}
