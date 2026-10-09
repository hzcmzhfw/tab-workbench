import { mutate } from './storage.js';
import { readBookmarkHistory, BOOKMARK_HISTORY_LIMIT } from './bookmark-history.js';
import { safeUrl } from './core.js';
import { bookmarkNodes, bookmarkDescendants, bookmarkDuplicates, validateBookmarkImport } from './bookmark-core.js';

export function createBookmarkManager({ element, button, askText, askConfirm, toast, rerender }) {
  let tree = [], current = '0', duplicate = false, removed = null, history = [], historyMode = false;
  const byId = () => new Map(bookmarkNodes(tree).map(node => [node.id, node]));
  const $ = id => document.getElementById(id);
  async function refresh() {
    if (!chrome.bookmarks) throw new Error('请在扩展管理页重新加载插件，启用新增的书签权限');
    tree = await chrome.bookmarks.getTree(); history = await readBookmarkHistory();
    if (!byId().has(current)) current = '0';
  }
  const isEditable = node => !!node?.parentId && node.parentId !== '0' && !node.unmodifiable;
  const folders = () => bookmarkNodes(tree).filter(node => !node.url && node.id !== '0' && !node.unmodifiable);
  function path(node) {
    const names = [], map = byId();
    for (let next = node; next && next.id !== '0'; next = map.get(next.parentId)) names.unshift(next.title || '未命名文件夹');
    return names.join(' / ');
  }
  async function destination(message, excluded = new Set()) {
    const options = folders().filter(node => !excluded.has(node.id));
    if (!options.length) throw new Error('没有可用的目标文件夹');
    return new Promise(resolve => {
      const dialog = element('dialog'); dialog.append(element('h2', '', message));
      const select = element('select', 'bookmark-destination'); select.setAttribute('aria-label', '目标文件夹');
      for (const node of options) {
        const option = element('option', '', path(node)); option.value = node.id; option.selected = node.id === current; select.append(option);
      }
      dialog.append(select);
      const actions = element('div', 'dialog-actions');
      let settled = false;
      const finish = value => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); };
      actions.append(button('取消', () => finish(null)), button('确认', () => finish(select.value), 'primary'));
      dialog.append(actions); document.body.append(dialog);
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.addEventListener('close', () => finish(null)); dialog.showModal(); select.focus();
    });
  }
  async function changed(message) { await refresh(); rerender(); if (message) toast(message); }
  async function create(isFolder) {
    const parentId = await destination(isFolder ? '新建文件夹到' : '添加书签到'); if (!parentId) return;
    const title = await askText(isFolder ? '文件夹名称' : '书签名称'); if (!title?.trim()) return;
    const options = { parentId, title: title.trim() };
    if (!isFolder) {
      const url = await askText('书签网址（HTTP / HTTPS）', 'https://'); if (url === null) return;
      if (!safeUrl(url)) throw new Error('请输入有效的 HTTP / HTTPS 网址'); options.url = url;
    }
    await mutate('bookmark_create', options); current = parentId; $('search').value = ''; duplicate = false; await changed('已保存到 Chrome 书签');
  }
  async function edit(node) {
    const title = await askText(node.url ? '修改书签名称' : '修改文件夹名称', node.title); if (!title?.trim()) return;
    const update = { title: title.trim() };
    if (node.url) {
      const url = await askText('修改书签网址（HTTP / HTTPS）', node.url); if (url === null) return;
      if (!safeUrl(url)) throw new Error('请输入有效的 HTTP / HTTPS 网址'); update.url = url;
    }
    await mutate('bookmark_update', { id: node.id, ...update }); await changed('修改已同步到 Chrome');
  }
  async function remove(node) {
    const [live] = await chrome.bookmarks.get(node.id);
    if (!isEditable(live)) throw new Error('此文件夹由 Chrome 或组织管理，不能删除');
    if (!live.url && (await chrome.bookmarks.getChildren(live.id)).length) throw new Error('请先移动或删除文件夹内的内容，再删除空文件夹');
    if (!await askConfirm(`从 Chrome 书签删除“${live.title || '未命名'}”？删除后可通过本页“撤销删除”恢复最近一项。`)) return;
    await mutate('bookmark_remove', { id: live.id }); removed = live; await changed('已删除，可在本页撤销');
  }
  async function undo() {
    if (!removed) return;
    const options = { parentId: removed.parentId, title: removed.title, index: removed.index };
    if (removed.url) options.url = removed.url;
    await mutate('bookmark_create', options); removed = null; await changed('已恢复最近删除的书签或空文件夹');
  }
  function exportTree() {
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = `chrome-bookmarks-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000); toast('已导出 Chrome 书签，备份包含所有书签网址');
  }
  async function importTree(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error('书签备份不能超过 8MB');
    const nodes = validateBookmarkImport(JSON.parse(await file.text()));
    const parentId = await destination('将备份导入到'); if (!parentId) return;
    if (!await askConfirm('将备份导入到一个新文件夹？现有书签会保留，重复导入会新增副本。')) return;
    try {
      const container = await mutate('bookmark_import', { parentId, title: `书签导入 ${new Date().toLocaleDateString()}`, children: nodes });
      current = container.id; await changed('导入完成，原有书签已保留');
    } catch (error) { await changed(); throw error; }
  }

  function renderActions() {
    const actions = $('actions'); actions.hidden = false; actions.replaceChildren();
    actions.append(button(historyMode ? '返回书签' : `历史快照（${history.length}/${BOOKMARK_HISTORY_LIMIT}）`, () => { historyMode = !historyMode; rerender(); }));
    $('search').hidden = historyMode;
    if ($('heading')) $('heading').textContent = historyMode ? '历史快照' : '书签管理';
    if (historyMode) return;
    actions.append(button('添加书签', () => create(false), 'primary'), button('新建文件夹', () => create(true)), button(duplicate ? '返回文件夹' : '查找重复书签', () => { duplicate = !duplicate; rerender(); }), button('导出书签备份', async () => { await refresh(); exportTree(); }));
    const input = element('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    input.addEventListener('change', async () => { const file = input.files?.[0]; input.value = ''; try { await importTree(file); } catch (error) { toast(error.message); } });
    actions.append(button('导入书签备份', () => input.click()), input);
    if (removed) actions.append(button('撤销删除', undo));
  }
  function renderHistory() {
    $('count').textContent = `最近 ${history.length} 次操作前的完整书签状态 · 最多保留 ${BOOKMARK_HISTORY_LIMIT} 次 · 恢复前自动保存当前版本`;
    const list = element('div', 'bookmark-history-list');
    list.append(element('p', 'history-note', '插件内每次操作保存一个快照；Chrome 外部连续修改会合并记录。快照覆盖可编辑书签及目录层级，保存在此浏览器。'));
    for (const entry of history) {
      const item = element('article', 'bookmark-item');
      const info = element('div', 'info');
      info.append(element('strong', 'title', entry.action_name), element('p', '', `${new Date(entry.saved_at).toLocaleString()} · ${bookmarkNodes(entry.bookmark_tree).filter(node => node.url).length} 个书签`));
      const actions = element('div', 'row-actions');
      actions.append(button('预览', () => previewSnapshot(entry)), button('恢复此版本', async () => {
        if (!await askConfirm(`恢复到“${entry.action_name}”前的状态（${new Date(entry.saved_at).toLocaleString()}）？将替换当前可编辑书签与文件夹；当前状态会先保存为新快照，可再次恢复。Chrome 同步开启时，修改会同步到其他设备。`)) return;
        await mutate('bookmark_restore', { snapshot_id: entry.snapshot_id }); removed = null; current = '0'; await changed('已恢复书签版本，恢复前的状态已保存到历史');
      }, 'primary'));
      item.append(info, actions); list.append(item);
    }
    if (!history.length) list.append(element('p', 'empty', '还没有历史快照。添加、编辑、移动、删除或导入书签后，会在这里留下操作前的版本。'));
    $('list').append(list);
  }
  function previewSnapshot(entry) {
    const dialog = element('dialog', 'bookmark-preview');
    dialog.append(element('h2', '', '书签版本预览'), element('p', '', `${entry.action_name}前 · ${new Date(entry.saved_at).toLocaleString()}`));
    const list = element('div', 'restore-list');
    const walk = (nodes, depth = 0) => {
      for (const node of nodes) {
        const item = element('div', 'restore-item', `${node.url ? '◇' : '▱'} ${node.title || '根目录'}${node.url ? ` · ${node.url}` : ''}`);
        item.style.paddingLeft = `${Math.min(depth, 8) * 14}px`; list.append(item);
        if (node.children) walk(node.children, depth + 1);
      }
    };
    walk(entry.bookmark_tree); dialog.append(list);
    const actions = element('div', 'dialog-actions'); actions.append(button('关闭预览', () => { dialog.close(); dialog.remove(); })); dialog.append(actions);
    dialog.addEventListener('cancel', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
  }
  function render() {
    if (historyMode) return renderHistory();
    const map = byId(), nodes = [...map.values()], query = $('search').value.trim().toLowerCase();
    const duplicates = bookmarkDuplicates(nodes);
    const scoped = query || duplicate ? nodes.filter(node => node.id !== '0') : map.get(current)?.children || [];
    const matches = scoped.filter(node => (!duplicate || duplicates.has(node.id)) && `${node.title} ${node.url || ''}`.toLowerCase().includes(query));
    $('count').textContent = `${nodes.filter(node => node.url).length} 个 Chrome 书签 · ${duplicate ? '完整网址相同的重复项' : query ? '搜索所有文件夹' : path(map.get(current)) || '全部文件夹'} · 显示 ${matches.length} 项`;
    const layout = element('div', 'bookmark-layout'), sidebar = element('nav', 'bookmark-folders'); sidebar.setAttribute('aria-label', '书签文件夹');
    const go = id => { current = id; duplicate = false; $('search').value = ''; rerender(); };
    sidebar.append(button('全部文件夹', () => go('0'), current === '0' && !query && !duplicate ? 'chosen' : ''));
    for (const node of folders()) {
      const control = button(`▱ ${node.title || '未命名文件夹'}`, () => go(node.id), current === node.id && !query && !duplicate ? 'chosen' : '');
      control.title = path(node); control.style.paddingLeft = `${12 + Math.min(path(node).split(' / ').length - 1, 6) * 12}px`; sidebar.append(control);
    }
    const content = element('div', 'bookmark-content'), crumbs = element('div', 'bookmark-breadcrumb');
    crumbs.append(button('全部', () => go('0')));
    if (!query && !duplicate) {
      const chain = []; for (let node = map.get(current); node && node.id !== '0'; node = map.get(node.parentId)) chain.unshift(node);
      for (const node of chain) crumbs.append(element('span', '', '/'), button(node.title || '未命名', () => go(node.id)));
    } else crumbs.append(element('span', '', duplicate ? '/ 重复书签' : '/ 搜索结果'));
    content.append(crumbs);
    for (const node of matches) {
      const item = element('article', 'bookmark-item');
      item.append(element('span', 'bookmark-icon', node.url ? '◇' : '▱'));
      const info = element('div', 'info');
      const open = button(node.title || node.url || '未命名文件夹', async () => {
        if (!node.url) return go(node.id);
        if (!safeUrl(node.url)) throw new Error('特殊协议书签请在 Chrome 原生书签管理器中打开');
        await chrome.tabs.create({ url: node.url });
      }, 'title');
      info.append(open, element('p', '', node.url ? `${node.url}${query || duplicate ? ` · ${path(map.get(node.parentId))}` : ''}` : `${(node.children || []).length} 项内容`)); item.append(info);
      if (isEditable(node)) {
        const actions = element('div', 'row-actions');
        actions.append(button('编辑', () => edit(node)), button('移动', async () => {
          const target = await destination('移动到文件夹', bookmarkDescendants(node)); if (!target || target === node.parentId) return;
          await mutate('bookmark_move', { id: node.id, parentId: target }); await changed('已移动书签');
        }), button('删除', () => remove(node), 'danger')); item.append(actions);
      }
      content.append(item);
    }
    if (!matches.length) content.append(element('p', 'empty', duplicate ? '没有找到重复书签。' : query ? '没有匹配的书签，试试其他关键词。' : '文件夹为空，可添加书签或新建文件夹。'));
    layout.append(sidebar, content); $('list').append(layout);
  }
  return { refresh, render, renderActions };
}
