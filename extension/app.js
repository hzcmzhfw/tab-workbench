import { BACKUP_VERSION, duplicateIds, filterTools, safeUrl } from './core.js';
import { readData, mutate } from './storage.js';
import { fetchTabs, fetchGroups, snapshots, focusTab, restoreTabs, captureCurrent } from './browser.js';

const $ = id => document.getElementById(id);
const isPopup = document.body.classList.contains('popup');
const catalog = await (await fetch('catalog.json')).json();
let data = await readData();
let view = 'tools', site = '全部', preview = false, savedFilter = '待阅读', collection = '全部收藏夹';
let tabs = [], groups = new Map(), selected = new Set(), visibleTabs = [], visibleSaved = [], closed = [];
let toastTimer, refreshTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function toast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 5000);
}
function button(text, action, className = '') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', async () => {
    if (node.disabled) return;
    node.disabled = true;
    try { await action(); } catch (error) { toast(error.message); }
    finally { node.disabled = false; }
  });
  return node;
}
function askDialog(message, initialValue = null) {
  return new Promise(resolve => {
    const dialog = element('dialog', 'ask-dialog');
    dialog.append(element('h2', '', initialValue === null ? '确认操作' : '填写信息'), element('p', '', message));
    let input;
    if (initialValue !== null) {
      input = element('input'); input.type = 'text'; input.value = initialValue;
      input.setAttribute('aria-label', message); input.maxLength = message.includes('2000') ? 2000 : 100;
      dialog.append(input);
    }
    const actions = element('div', 'dialog-actions');
    let settled = false;
    const finish = answer => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(answer); };
    const cancel = () => finish(initialValue === null ? false : null);
    const accept = () => finish(input ? input.value : true);
    actions.append(button('取消', cancel), button('确认', accept, 'primary'));
    dialog.append(actions); document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    dialog.addEventListener('close', cancel, { once: true });
    if (input) input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); accept(); } });
    dialog.showModal(); input?.focus(); input?.select();
  });
}
function askConfirm(message) { return askDialog(message); }
function askText(message, value = '') { return askDialog(message, value); }
function selector(values, current, change, label) {
  const node = element('select');
  node.setAttribute('aria-label', label);
  for (const [value, name] of values) {
    const option = element('option', '', name);
    option.value = value; option.selected = value === current; node.append(option);
  }
  node.addEventListener('change', () => Promise.resolve(change(node.value)).catch(error => toast(error.message)));
  return node;
}
function checkbox(label, checked, change) {
  const node = element('input'); node.type = 'checkbox'; node.checked = checked;
  node.setAttribute('aria-label', label);
  node.addEventListener('change', () => change(node.checked));
  return node;
}
function applyTheme() {
  const theme = data.settings_data.theme_name;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}
async function update(type, payload) {
  data = await mutate(type, payload); applyTheme();
  return data;
}
async function refreshTabs() {
  tabs = await fetchTabs(); groups = await fetchGroups(tabs);
  if (view === 'tabs') selected = new Set([...selected].filter(id => tabs.some(tab => tab.id === id)));
}
function row(title, description, badge) {
  const node = element('article', 'row');
  const mark = element('span', 'badge', badge), info = element('div', 'info');
  const name = element('span', 'title', title), desc = element('p', '', description);
  info.append(name, desc); node.append(mark, info);
  return { node, info, name, actions: element('div', 'row-actions') };
}
async function visit(tool) {
  await update('tool_visit', { tool_id: tool.tool_id });
  await chrome.tabs.create({ url: tool.tool_url });
}
function renderTools() {
  let matches = filterTools(catalog, $('search').value, site === '最近' ? '全部' : site, data.favorite_tool_ids);
  if (site === '最近') matches = matches.filter(tool => data.recent_tool_ids.includes(tool.tool_id))
    .sort((a, b) => data.recent_tool_ids.indexOf(a.tool_id) - data.recent_tool_ids.indexOf(b.tool_id));
  const shown = matches.slice(0, isPopup ? 30 : matches.length);
  $('count').textContent = `${matches.length} 个工具${shown.length < matches.length ? ` · 显示前 ${shown.length} 个，请搜索缩小范围` : ''} · 点击进入网站`;
  for (const tool of shown) {
    const item = row(tool.tool_name, tool.tool_desc, tool.site_name);
    const link = element('a', 'title', tool.tool_name);
    link.href = tool.tool_url; link.target = '_blank'; link.rel = 'noreferrer';
    link.addEventListener('click', event => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey) {
        update('tool_visit', { tool_id: tool.tool_id }).catch(() => {}); return;
      }
      event.preventDefault(); visit(tool).catch(error => toast(error.message));
    });
    item.name.replaceWith(link);
    const favorite = data.favorite_tool_ids.includes(tool.tool_id);
    const star = button(favorite ? '★' : '☆', async () => {
      await update('favorite_toggle', { tool_id: tool.tool_id }); render();
    });
    star.setAttribute('aria-label', `${favorite ? '取消收藏' : '收藏'}${tool.tool_name}`);
    star.setAttribute('aria-pressed', String(favorite));
    item.actions.append(star); item.node.append(item.actions); $('list').append(item.node);
  }
}
function matchingTabs() {
  const terms = $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ids = preview ? new Set(duplicateIds(tabs, data.settings_data.is_ignore_tracking)) : null;
  return tabs.filter(tab => (!ids || ids.has(tab.id)) && terms.every(term => `${tab.title} ${tab.url}`.toLowerCase().includes(term)));
}
function tabGroup(tab) {
  if (data.settings_data.tab_view === 'window') return [`window:${tab.windowId}`, `窗口 ${tab.windowId}`];
  if (data.settings_data.tab_view === 'group') {
    const group = groups.get(tab.groupId);
    return [group ? `group:${tab.groupId}` : `window:${tab.windowId}`, group ? `${group.title || '未命名标签组'} · 窗口 ${tab.windowId}` : `未分组 · 窗口 ${tab.windowId}`];
  }
  return [new URL(tab.url).hostname, new URL(tab.url).hostname];
}
function renderTabs() {
  visibleTabs = matchingTabs();
  $('count').textContent = preview
    ? `${visibleTabs.length} 个重复标签待清理 · 固定标签全部保留 · ${data.settings_data.is_ignore_tracking ? '忽略追踪参数' : '完整网址匹配'}`
    : `${visibleTabs.length} 个网页标签 · 已选择 ${selected.size} 个`;
  const sections = new Map();
  for (const tab of visibleTabs) {
    const [key, title] = tabGroup(tab);
    if (!sections.has(key)) sections.set(key, { title, tabs: [] });
    sections.get(key).tabs.push(tab);
  }
  for (const group of sections.values()) {
    const heading = element('h2', 'group', `${group.title} · ${group.tabs.length}`);
    heading.append(button('选择本组', () => {
      const all = group.tabs.every(tab => selected.has(tab.id));
      for (const tab of group.tabs) { if (all) selected.delete(tab.id); else selected.add(tab.id); }
      render();
    }, 'group-select'));
    $('list').append(heading);
    for (const tab of group.tabs) {
      const labels = [tab.pinned ? '已固定' : '', tab.active ? '活动标签' : '', tab.discarded ? '已休眠' : '', tab.audible ? '正在播放声音' : ''].filter(Boolean);
      const item = row(tab.title || tab.url, `${tab.url} · ${labels.join(' / ') || `窗口 ${tab.windowId}`}`, '网页');
      item.node.prepend(checkbox(`选择 ${tab.title || tab.url}`, selected.has(tab.id), checked => {
        if (checked) selected.add(tab.id); else selected.delete(tab.id); render();
      }));
      const focus = button(tab.title || tab.url, () => focusTab(tab), 'title'); item.name.replaceWith(focus);
      item.actions.append(button(tab.pinned ? '取消固定' : '固定', async () => {
        await chrome.tabs.update(tab.id, { pinned: !tab.pinned }); await refreshTabs(); render();
      }));
      item.actions.append(button('稍后看', () => saveLater([tab], false)));
      item.actions.append(button('关闭', () => closeTabs([tab]), 'danger'));
      item.node.append(item.actions); $('list').append(item.node);
    }
  }
}
async function closeTabs(items) {
  if (!items.length) throw new Error('请先选择标签');
  // Re-read so a label changed to pinned after preview is never closed silently.
  const current = await fetchTabs();
  const wanted = new Set(items.map(tab => tab.id));
  const live = current.filter(tab => wanted.has(tab.id));
  if (!live.length) throw new Error('这些标签已关闭');
  const pinned = live.filter(tab => tab.pinned).length;
  if (!await askConfirm(`关闭 ${live.length} 个标签${pinned ? `（包含 ${pinned} 个固定标签）` : ''}？关闭后可撤销重开网址，未提交内容无法恢复。`)) return;
  const backup = await snapshots(live);
  // Record each successful close so partial failures are still recoverable.
  for (let i = 0; i < live.length; i++) {
    try { await chrome.tabs.remove(live[i].id); closed.push(backup[i]); }
    catch (error) { toast(`部分标签未关闭：${error.message}`); }
  }
  selected.clear(); await refreshTabs(); render();
}
async function saveLater(items, closeAfter) {
  if (!items.length) throw new Error('请先选择页面');
  const name = await askText('收藏夹名称', '默认收藏夹');
  if (name === null) return;
  const count = data.saved_tab_list.length;
  await update('saved_add', { collection_name: name, tab_list: await snapshots(items) });
  toast(`保存 ${data.saved_tab_list.length - count} 个页面，相同收藏夹内自动去重`);
  if (closeAfter) await closeTabs(items);
  else render();
}
function savedMatches() {
  const query = $('search').value.trim().toLowerCase();
  return data.saved_tab_list.filter(item => (savedFilter === '全部' || item.is_archived === (savedFilter === '已归档'))
    && (collection === '全部收藏夹' || item.collection_name === collection)
    && `${item.tab_title} ${item.tab_url} ${item.note_text} ${item.collection_name}`.toLowerCase().includes(query));
}
function renderSaved() {
  visibleSaved = savedMatches();
  $('count').textContent = `${visibleSaved.length} 个保存页面 · 已选择 ${selected.size} 个`;
  for (const saved of visibleSaved) {
    const item = row(saved.tab_title, `${saved.collection_name} · ${saved.is_archived ? '已归档' : '待阅读'} · ${saved.note_text || saved.tab_url}`, '保存');
    item.node.prepend(checkbox(`选择 ${saved.tab_title}`, selected.has(saved.saved_id), checked => {
      if (checked) selected.add(saved.saved_id); else selected.delete(saved.saved_id); render();
    }));
    item.name.replaceWith(button(saved.tab_title, () => restore(saved ? [saved] : []), 'title'));
    item.actions.append(button(saved.is_archived ? '取消归档' : '归档', async () => {
      await update('saved_update', { saved_id: saved.saved_id, is_archived: !saved.is_archived }); render();
    }));
    item.actions.append(button('备注', async () => {
      const note = await askText('页面备注（最多 2000 字）', saved.note_text);
      if (note !== null) { await update('saved_update', { saved_id: saved.saved_id, note_text: note }); render(); }
    }));
    item.actions.append(button('移动', async () => {
      const name = await askText('移动到收藏夹', saved.collection_name);
      if (name !== null) { await update('saved_update', { saved_id: saved.saved_id, collection_name: name }); render(); }
    }));
    item.actions.append(button('删除', async () => {
      if (!await askConfirm(`删除“${saved.tab_title}”？`)) return;
      await update('saved_delete', { saved_ids: [saved.saved_id] }); selected.delete(saved.saved_id); render();
    }, 'danger'));
    item.node.append(item.actions); $('list').append(item.node);
  }
}
async function saveSession(items) {
  if (!items.length) throw new Error('没有可保存的网页标签');
  const name = await askText('工作会话名称', `工作现场 ${new Date().toLocaleDateString()}`);
  if (!name?.trim()) return;
  await update('session_add', { session_name: name, tab_list: await snapshots(items) });
  toast(`已保存 ${items.length} 个标签及窗口、标签组信息`); render();
}
async function restore(items, newWindows = false, skipDuplicates = true) {
  const result = await restoreTabs(items, newWindows, toast, skipDuplicates);
  toast(`已恢复 ${result.restored_cnt} 个标签，跳过 ${result.skipped_cnt} 个已打开或重复网址`);
  await refreshTabs();
}
function restoreDialog(session) {
  const dialog = element('dialog');
  const heading = element('h2', '', `恢复：${session.session_name}`);
  const explanation = element('p', 'subtitle', '选择要恢复的页面；相同网址只打开一次。');
  const list = element('div', 'restore-list'), chosen = new Set(session.tab_list.map((_, index) => index));
  const allLabel = element('label', '', ' 全选 / 取消全选');
  const checkboxes = [];
  allLabel.prepend(checkbox('全选恢复页面', true, checked => {
    chosen.clear(); checkboxes.forEach((input, index) => { input.checked = checked; if (checked) chosen.add(index); });
  }));
  session.tab_list.forEach((tab, index) => {
    const line = element('label', 'restore-item', `${tab.tab_title}${tab.is_pinned ? ' · 固定' : ''}${tab.group_name ? ` · ${tab.group_name}` : ''}`);
    const input = checkbox(`恢复 ${tab.tab_title}`, true, checked => { if (checked) chosen.add(index); else chosen.delete(index); });
    checkboxes.push(input); line.prepend(input); list.append(line);
  });
  const windowLabel = element('label', '', ' 按原窗口分别新建窗口（恢复标签组）');
  const windows = checkbox('按原窗口恢复', true, () => {}); windowLabel.prepend(windows);
  const actions = element('div', 'dialog-actions');
  actions.append(button('取消', () => dialog.close()), button('恢复所选页面', async () => {
    if (!chosen.size) throw new Error('请至少选择一个页面');
    await restore(session.tab_list.filter((_, index) => chosen.has(index)), windows.checked);
    dialog.close();
  }, 'primary'));
  dialog.append(heading, explanation, allLabel, list, windowLabel, actions);
  document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove()); dialog.showModal();
}
function renderSessions() {
  const query = $('search').value.trim().toLowerCase();
  const matches = data.session_list.filter(session => `${session.session_name} ${session.tab_list.map(tab => tab.tab_title).join(' ')}`.toLowerCase().includes(query));
  $('count').textContent = `${matches.length} 个会话 · 可恢复窗口、标签组、顺序及固定状态`;
  for (const session of [...matches].reverse()) {
    const windowCount = new Set(session.tab_list.map(tab => tab.window_id)).size;
    const groupCount = new Set(session.tab_list.map(tab => tab.group_key).filter(Boolean)).size;
    const item = row(session.session_name, `${session.tab_list.length} 个标签 · ${windowCount} 个窗口 · ${groupCount} 个标签组 · ${new Date(session.saved_at).toLocaleString()}`, '会话');
    item.info.append(element('p', 'session-preview', session.tab_list.slice(0, 3).map(tab => tab.tab_title).join(' / ')));
    item.actions.append(button('预览与恢复', () => restoreDialog(session)));
    item.actions.append(button('删除', async () => {
      if (!await askConfirm(`删除会话“${session.session_name}”？`)) return;
      await update('session_delete', { session_id: session.session_id }); render();
    }, 'danger'));
    item.node.append(item.actions); $('list').append(item.node);
  }
}
function selectionAction(label, action, className = '') {
  return button(label, () => action(view === 'tabs' ? tabs.filter(tab => selected.has(tab.id)) : data.saved_tab_list.filter(item => selected.has(item.saved_id))), className);
}
function selectVisible() {
  const ids = view === 'tabs' ? visibleTabs.map(tab => tab.id) : visibleSaved.map(item => item.saved_id);
  const all = ids.length && ids.every(id => selected.has(id));
  for (const id of ids) { if (all) selected.delete(id); else selected.add(id); }
  render();
}
async function bulkUpdate(items, key, value) {
  if (!items.length) throw new Error('请先选择标签');
  let count = 0;
  for (const tab of items) {
    try { await chrome.tabs.update(tab.id, { [key]: value }); count++; } catch {} // Other windows can close concurrently.
  }
  await refreshTabs(); render(); toast(`已更新 ${count} 个标签`);
}
async function discardTabs(items) {
  if (!items.length) throw new Error('请先选择标签');
  if (!chrome.tabs.discard) throw new Error('此浏览器不支持标签休眠');
  const ids = new Set(items.map(tab => tab.id));
  const eligible = (await fetchTabs()).filter(tab => ids.has(tab.id) && !tab.active && !tab.pinned && !tab.audible && !tab.discarded);
  if (!eligible.length) throw new Error('没有可休眠页面；活动、固定、播放音频或已休眠标签会跳过');
  if (!await askConfirm(`休眠 ${eligible.length} 个后台标签？重新打开会重新加载，未提交内容可能丢失。`)) return;
  let count = 0;
  for (const tab of eligible) { try { await chrome.tabs.discard(tab.id); count++; } catch {} }
  await refreshTabs(); render(); toast(`已休眠 ${count} 个标签，其他标签已跳过`);
}
function renderActions() {
  if (isPopup) return;
  const actions = $('actions'); actions.replaceChildren(); actions.hidden = view === 'tools' || view === 'settings';
  if (view === 'tabs') {
    actions.append(selector([['domain', '按域名'], ['window', '按窗口'], ['group', '按标签组']], data.settings_data.tab_view, async value => {
      await update('settings_update', { tab_view: value }); render();
    }, '标签分组方式'));
    actions.append(button(preview ? '返回全部标签' : '预览重复标签', async () => { preview = !preview; selected.clear(); await refreshTabs(); render(); }));
    if (preview) {
      actions.append(button('关闭预览重复项', async () => {
        const candidateIds = new Set(duplicateIds(await fetchTabs(), data.settings_data.is_ignore_tracking));
        await closeTabs(visibleTabs.filter(tab => candidateIds.has(tab.id)));
      }, 'danger'));
    } else {
      actions.append(button('选择当前列表', selectVisible));
      actions.append(selectionAction('保存所选', items => saveLater(items, false)));
      actions.append(selectionAction('保存并关闭', items => saveLater(items, true)));
      actions.append(selectionAction('关闭所选', closeTabs, 'danger'));
      actions.append(selectionAction('休眠所选', discardTabs));
      actions.append(selectionAction('固定所选', items => bulkUpdate(items, 'pinned', true)));
      actions.append(selectionAction('静音所选', items => bulkUpdate(items, 'muted', true)));
      actions.append(selectionAction('取消静音', items => bulkUpdate(items, 'muted', false)));
      const windowIds = [...new Set(tabs.map(tab => tab.windowId))];
      actions.append(selector([['', '移动所选到窗口…'], ...windowIds.map(id => [String(id), `窗口 ${id}`]), ['new', '新建窗口']], '', async value => {
        if (!value) return;
        const items = tabs.filter(tab => selected.has(tab.id));
        if (!items.length) throw new Error('请先选择标签');
        let target = Number(value);
        if (value === 'new') {
          const win = await chrome.windows.create({ tabId: items[0].id }); target = win.id; items.shift();
        }
        for (const tab of items) await chrome.tabs.move(tab.id, { windowId: target, index: -1 });
        selected.clear(); await refreshTabs(); render(); toast('标签已移动');
      }, '移动标签到窗口'));
    }
    actions.append(button('保存当前窗口会话', async () => { const win = await chrome.windows.getCurrent(); await refreshTabs(); await saveSession(tabs.filter(tab => tab.windowId === win.id)); }));
    actions.append(button('保存全部窗口会话', async () => { await refreshTabs(); await saveSession(tabs); }));
    if (closed.length) actions.append(button(`撤销关闭（${closed.length}）`, async () => {
      await restore(closed, false, false); closed = []; render();
    }));
  } else if (view === 'saved') {
    const collections = [...new Set(data.saved_tab_list.map(item => item.collection_name))];
    if (collection !== '全部收藏夹' && !collections.includes(collection)) collection = '全部收藏夹';
    actions.append(selector(['待阅读', '已归档', '全部'].map(value => [value, value]), savedFilter, value => { savedFilter = value; selected.clear(); render(); }, '阅读状态'));
    actions.append(selector(['全部收藏夹', ...collections].map(value => [value, value]), collection, value => { collection = value; selected.clear(); render(); }, '收藏夹'));
    actions.append(button('选择当前列表', selectVisible));
    actions.append(selectionAction('打开所选', items => { if (!items.length) throw new Error('请先选择页面'); return restore(items); }));
    actions.append(selectionAction('删除所选', async items => {
      if (!items.length) throw new Error('请先选择页面');
      if (!await askConfirm(`删除所选 ${items.length} 个保存页面？`)) return;
      await update('saved_delete', { saved_ids: items.map(item => item.saved_id) }); selected.clear(); render();
    }, 'danger'));
  } else if (view === 'sessions') {
    actions.append(button('保存当前窗口会话', async () => { const win = await chrome.windows.getCurrent(); await refreshTabs(); await saveSession(tabs.filter(tab => tab.windowId === win.id)); }));
    actions.append(button('保存全部窗口会话', async () => { await refreshTabs(); await saveSession(tabs); }));
  }
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = element('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function settingsSection(title, text) {
  const section = element('section', 'settings-row');
  section.append(element('h2', '', title), element('p', '', text));
  $('list').append(section); return section;
}
function renderSettings() {
  $('count').textContent = '浏览工作台 1.0.0 · 本地数据与偏好';
  const theme = settingsSection('外观', '跟随系统，或固定使用浅色、深色主题。');
  theme.append(selector([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']], data.settings_data.theme_name, async value => {
    await update('settings_update', { theme_name: value }); render();
  }, '主题'));
  const clean = settingsSection('重复标签匹配', '默认比较完整网址。开启后只忽略 UTM、gclid、fbclid 等已知追踪参数；保留业务参数和片段。固定标签始终受保护。');
  const tracking = element('label', '', '忽略已知追踪参数');
  tracking.prepend(checkbox('忽略已知追踪参数', data.settings_data.is_ignore_tracking, async value => {
    try { await update('settings_update', { is_ignore_tracking: value }); } catch (error) { toast(error.message); }
  })); clean.append(tracking);
  const backup = settingsSection('备份与迁移', '导出收藏工具、保存页面、工作会话和设置。备份包含网址与备注，请妥善保存；不包含截图和临时选中文字。');
  const actions = element('div', 'toolbar');
  actions.append(button('导出 JSON 备份', async () => {
    const current = await readData();
    const value = { backup_version: BACKUP_VERSION, exported_at: new Date().toISOString(), backup_data: {
      favorite_tool_ids: current.favorite_tool_ids, session_list: current.session_list,
      saved_tab_list: current.saved_tab_list, settings_data: current.settings_data,
    } };
    downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), `tab-workbench-${new Date().toISOString().slice(0, 10)}.json`);
    toast('已导出备份');
  }));
  const mode = selector([['merge', '合并导入（保留现有数据）'], ['replace', '替换导入（覆盖现有数据）']], 'merge', () => {}, '导入方式');
  actions.append(mode);
  const input = element('input'); input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('备份文件不能超过 8MB');
      const value = JSON.parse(await file.text());
      if (!await askConfirm(mode.value === 'replace' ? '确认用备份替换所有收藏、会话、保存页面与设置？请先导出当前数据。' : '确认合并备份？收藏和保存页面会去重，会话会新增。')) return;
      await update('backup_import', { backup_value: value, is_replace: mode.value === 'replace' });
      selected.clear(); render(); toast('备份导入完成');
    } catch (error) { toast(`导入失败：${error.message}`); }
  });
  actions.append(button('选择备份导入', () => input.click()), input); backup.append(actions);
  settingsSection('支持的浏览器', '基于 Manifest V3 与标准 Chrome 扩展 API，目标为 Chrome / Chromium 110+ 及对应新版 Edge、Brave、Vivaldi、Opera。浏览器可能限制加载未上架扩展；标签组或休眠缺失时会保留基础功能并给出提示。');
  const privacy = settingsSection('权限与隐私', '标签、收藏和会话保存在当前浏览器。仅在点击插件图标后截图，不自动上传输入、不使用统计或广告脚本。两站页面按正常网站访问加载，遵循各自隐私说明。');
  const links = element('div', 'toolbar');
  for (const [name, url] of [['了解趁手', 'https://tools.hzcmzhfw.cn/'], ['了解轻办', 'https://qingban.hzcmzhfw.cn/'], ['源码与反馈', 'https://gitee.com/hzcmzhfw/tab-workbench']]) {
    const link = element('a', '', `${name} ↗`); link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; links.append(link);
  }
  privacy.append(links);
}
function render() {
  applyTheme(); $('list').replaceChildren();
  if (view === 'tools') renderTools();
  else if (view === 'tabs') renderTabs();
  else if (view === 'saved') renderSaved();
  else if (view === 'sessions') renderSessions();
  else renderSettings();
  renderActions();
  if (!$('list').children.length) {
    const text = view === 'saved' ? '还没有保存页面。在“正在打开”中选择标签并保存，或在网页点击插件的“保存当前页面”。'
      : view === 'sessions' ? '保存当前窗口或全部窗口，下次继续工作。'
        : site === '收藏' ? '还没有收藏工具。点击工具右侧的 ☆，常用入口就在这里。'
          : site === '最近' ? '从插件打开工具后，会在这里留下快捷入口。'
            : '没有找到内容，试试其他关键词。';
    $('list').append(element('p', 'empty', text));
  }
}
async function changeView(next) {
  view = next; selected.clear(); preview = false; $('search').value = '';
  const headings = { tools: ['TOOLS / 趁手与轻办', '工具中心'], tabs: ['TABS / 浏览器', '正在打开'], saved: ['READ LATER / 本地收藏', '稍后再看'], sessions: ['SESSIONS / 工作现场', '工作会话'], settings: ['SETTINGS / 数据管理', '设置与备份'] };
  $('eyebrow').textContent = headings[view][0]; $('heading').textContent = headings[view][1];
  $('search').placeholder = view === 'tools' ? '搜索 JSON、图片压缩、PDF 合并…' : '搜索标题、网址或备注…';
  $('search').hidden = view === 'settings'; $('filters').hidden = view !== 'tools';
  document.querySelectorAll('[data-view]').forEach(node => node.classList.toggle('chosen', node.dataset.view === view));
  if (view === 'tabs' || view === 'sessions') await refreshTabs();
  render();
}
$('search').addEventListener('input', render);
for (const node of document.querySelectorAll('[data-site]')) node.addEventListener('click', () => {
  site = node.dataset.site;
  document.querySelectorAll('[data-site]').forEach(button => button.classList.toggle('chosen', button === node)); render();
});
for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => changeView(node.dataset.view).catch(error => toast(error.message)));
if ($('dashboard')) $('dashboard').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }).catch(error => toast(error.message)));
if ($('capture')) $('capture').addEventListener('click', async () => {
  const node = $('capture'); node.disabled = true;
  try {
    const { image } = await captureCurrent();
    await mutate('handoff_create', { target_url: 'https://qingban.hzcmzhfw.cn/tools/annotate/', image_data: image, image_url: '', input_text: '' });
  } catch (error) { toast(`截图失败：${error.message}`); }
  finally { node.disabled = false; }
});
if ($('save-current')) $('save-current').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!safeUrl(tab?.url) || tab.incognito) throw new Error('请在普通网页保存当前页面');
    await saveLater([tab], false);
  } catch (error) { toast(error.message); }
});
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try { if (view === 'tabs') { await refreshTabs(); render(); } }
    catch (error) { toast(error.message); }
  }, 200);
}
chrome.tabs.onCreated.addListener(scheduleRefresh);
chrome.tabs.onRemoved.addListener(scheduleRefresh);
chrome.tabs.onMoved.addListener(scheduleRefresh);
chrome.tabs.onDetached.addListener(scheduleRefresh);
chrome.tabs.onAttached.addListener(scheduleRefresh);
chrome.tabs.onUpdated.addListener((id, change) => {
  if (change.status === 'complete' || change.url || change.pinned !== undefined || change.discarded !== undefined || change.audible !== undefined) scheduleRefresh();
});
if (chrome.tabGroups) {
  chrome.tabGroups.onUpdated.addListener(scheduleRefresh);
  chrome.tabGroups.onRemoved.addListener(scheduleRefresh);
}
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  data = await readData(); applyTheme();
  if (view !== 'settings' && !document.querySelector('dialog[open]')) render();
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]') && !$('search').hidden) {
    event.preventDefault(); $('search').focus();
  }
});
await refreshTabs(); render();
