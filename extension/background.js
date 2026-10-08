import { readData } from './storage.js';
import { toolUrl, safeUrl, validateBackup, mergeBackup } from './core.js';
import { MENUS } from './menus.js';
const catalogPromise = fetch(chrome.runtime.getURL('catalog.json')).then(response => response.json());
const legacyIdsPromise = fetch(chrome.runtime.getURL('legacy-tool-ids.json')).then(response => response.json());
let mutationQueue = Promise.resolve();

async function updateData(type, payload) {
  const data = await readData();
  switch (type) {
    case 'favorite_toggle': {
      if (!toolUrl(payload.tool_id)) throw new Error('工具网址无效');
      data.favorite_tool_ids = data.favorite_tool_ids.includes(payload.tool_id)
        ? data.favorite_tool_ids.filter(id => id !== payload.tool_id) : [...data.favorite_tool_ids, payload.tool_id];
      break;
    }
    case 'tool_visit': {
      if (!toolUrl(payload.tool_id)) throw new Error('工具网址无效');
      data.recent_tool_ids = [payload.tool_id, ...data.recent_tool_ids.filter(id => id !== payload.tool_id)].slice(0, 30);
      break;
    }
    case 'session_add': {
      if (!payload.session_name?.trim() || !payload.tab_list?.length) throw new Error('请填写名称并选择网页标签');
      data.session_list.push({ session_id: crypto.randomUUID(), session_name: payload.session_name.trim().slice(0, 100), saved_at: new Date().toISOString(), tab_list: payload.tab_list });
      break;
    }
    case 'session_delete': data.session_list = data.session_list.filter(item => item.session_id !== payload.session_id); break;
    case 'saved_add': {
      if (!payload.tab_list?.length) throw new Error('请先选择页面');
      const collection = payload.collection_name?.trim().slice(0, 100) || '默认收藏夹';
      const keys = new Set(data.saved_tab_list.map(item => `${item.collection_name}\n${item.tab_url}`));
      for (const tab of payload.tab_list) {
        if (!safeUrl(tab.tab_url) || keys.has(`${collection}\n${tab.tab_url}`)) continue;
        keys.add(`${collection}\n${tab.tab_url}`);
        data.saved_tab_list.push({ ...tab, saved_id: crypto.randomUUID(), saved_at: new Date().toISOString(), collection_name: collection, note_text: '', is_archived: false });
      }
      break;
    }
    case 'saved_delete': data.saved_tab_list = data.saved_tab_list.filter(item => !payload.saved_ids.includes(item.saved_id)); break;
    case 'saved_update': {
      const item = data.saved_tab_list.find(item => item.saved_id === payload.saved_id);
      if (!item) throw new Error('页面已删除');
      if (typeof payload.note_text === 'string') item.note_text = payload.note_text.slice(0, 2000);
      if (typeof payload.collection_name === 'string') item.collection_name = payload.collection_name.trim().slice(0, 100) || '默认收藏夹';
      if (typeof payload.is_archived === 'boolean') item.is_archived = payload.is_archived;
      break;
    }
    case 'settings_update': {
      if (['system', 'light', 'dark'].includes(payload.theme_name)) data.settings_data.theme_name = payload.theme_name;
      if (['domain', 'window', 'group'].includes(payload.tab_view)) data.settings_data.tab_view = payload.tab_view;
      if (typeof payload.is_ignore_tracking === 'boolean') data.settings_data.is_ignore_tracking = payload.is_ignore_tracking;
      break;
    }
    case 'backup_import': {
      const incoming = validateBackup(payload.backup_value, await catalogPromise);
      const next = payload.is_replace ? { ...data, ...incoming, recent_tool_ids: [] } : mergeBackup(data, incoming);
      await chrome.storage.local.set(next);
      return next;
    }
    default: throw new Error('不支持的操作');
  }
  await chrome.storage.local.set(data);
  return data;
}
export async function createHandoff(payload) {
  if (!toolUrl(payload.target_url)) throw new Error('目标工具网址无效');
  const id = crypto.randomUUID(), key = `handoff_${id}`;
  const old = await chrome.storage.session.get(null);
  const expired = Object.keys(old).filter(key => key.startsWith('handoff_') && Date.now() - (old[key]?.created_at || 0) > 30 * 60 * 1000);
  if (expired.length) await chrome.storage.session.remove(expired);
  await chrome.storage.session.set({ [key]: { ...payload, created_at: Date.now() } });
  try { await chrome.tabs.create({ url: `${chrome.runtime.getURL('handoff.html')}?id=${id}` }); }
  catch (error) { await chrome.storage.session.remove(key); throw error; }
  return id;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const type = message?.action_type;
  let task;
  if (type === 'handoff_create') task = createHandoff(message.action_data);
  else {
    task = mutationQueue.catch(() => {}).then(() => updateData(type, message.action_data || {}));
    mutationQueue = task;
  }
  task.then(result => sendResponse({ is_success: true, result_data: result }))
    .catch(error => sendResponse({ is_success: false, error_text: error.message }));
  return true;
});

async function install() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'workbench', title: '使用趁手 / 轻办处理', contexts: ['selection', 'image', 'page'] });
  for (const menu of MENUS) chrome.contextMenus.create({ id: menu.menu_id, title: menu.menu_name, parentId: 'workbench', contexts: [menu.menu_context] });
  // Migrate the prototype's numeric favorites to stable URLs.
  const data = await readData(), legacyIds = await legacyIdsPromise;
  const legacy = data.favorite_tool_ids.map(id => /^\d+$/.test(id) ? legacyIds[id] : id).filter(Boolean);
  if (legacy.some((id, i) => id !== data.favorite_tool_ids[i])) await chrome.storage.local.set({ favorite_tool_ids: legacy });
}
chrome.runtime.onInstalled.addListener(() => install().catch(console.error));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.incognito) return;
  const menu = MENUS.find(menu => menu.menu_id === info.menuItemId);
  if (!menu) return;
  createHandoff({ target_url: menu.target_url, input_text: info.selectionText || (menu.menu_context === 'page' ? info.pageUrl : ''), image_url: info.srcUrl || '', image_data: '' }).catch(console.error);
});
chrome.commands.onCommand.addListener(command => {
  if (command === 'open-workbench') chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }).catch(console.error);
});
