import { safeUrl, tabSnapshot } from './core.js';
export async function fetchTabs() {
  return (await chrome.tabs.query({})).filter(tab => safeUrl(tab.url) && !tab.incognito);
}
export async function fetchGroups(tabs) {
  const groups = new Map();
  if (!chrome.tabGroups) return groups;
  for (const id of new Set(tabs.map(tab => tab.groupId).filter(id => id >= 0))) {
    try { groups.set(id, await chrome.tabGroups.get(id)); } catch { /* A group may close during refresh. */ }
  }
  return groups;
}
export async function snapshots(tabs) {
  const groups = await fetchGroups(tabs);
  return tabs.map(tab => tabSnapshot(tab, groups.get(tab.groupId)));
}
export async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}
export async function restoreTabs(items, newWindows = false, callback = () => {}, skipDuplicates = true) {
  const existing = new Set((await fetchTabs()).map(tab => tab.url));
  const created = [], groups = new Map(), windows = new Map(), blanks = [];
  let skipped = 0;
  const partial = async () => {
    for (const [key, group] of groups) {
      try {
        if (chrome.tabGroups && chrome.tabs.group && group.ids.length) {
          const id = await chrome.tabs.group({ tabIds: group.ids, createProperties: { windowId: group.windowId } });
          await chrome.tabGroups.update(id, { title: group.item.group_name, color: group.item.group_color, collapsed: group.item.is_group_collapsed });
        }
      } catch { callback('部分标签组未恢复，页面已打开'); }
    }
    for (const id of blanks) { try { await chrome.tabs.remove(id); } catch {} }
  };
  try {
    for (const item of items) {
      if (!safeUrl(item.tab_url) || (skipDuplicates && existing.has(item.tab_url))) { skipped++; continue; }
      const options = { url: item.tab_url, pinned: !!item.is_pinned, active: false };
      if (newWindows) {
        const key = item.window_id || 0;
        if (!windows.has(key)) {
          const win = await chrome.windows.create({ url: 'about:blank', focused: false });
          windows.set(key, win.id); blanks.push(...(win.tabs || []).map(tab => tab.id));
        }
        options.windowId = windows.get(key);
      }
      const tab = await chrome.tabs.create(options);
      existing.add(item.tab_url); created.push(tab);
      if (item.group_key && !item.is_pinned) {
        const key = `${tab.windowId}:${item.group_key}`;
        if (!groups.has(key)) groups.set(key, { item, ids: [], windowId: tab.windowId });
        groups.get(key).ids.push(tab.id);
      }
    }
  } catch (error) {
    await partial();
    throw new Error(`已打开 ${created.length} 个页面；其余恢复失败：${error.message}`);
  }
  await partial();
  return { restored_cnt: created.length, skipped_cnt: skipped };
}
export async function captureCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!safeUrl(tab?.url)) throw new Error('请在要截图的普通网页点击插件图标');
  if (tab.incognito) throw new Error('不支持保存无痕窗口截图');
  // activeTab is granted by a user gesture on the toolbar, not by opening popup.html manually.
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return { image, tab };
}
