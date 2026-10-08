// Chrome-owned fields retain their official names; our persisted fields use snake_case.
export const BACKUP_VERSION = 1;
export const DEFAULT_SETTINGS = {
  theme_name: 'system',
  tab_view: 'domain',
  is_ignore_tracking: false,
};
export const TRACKING_PARAMS = /^(utm_.+|fbclid|gclid|msclkid|mc_cid|mc_eid)$/i;
export function safeUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}
export function toolUrl(value) {
  if (!safeUrl(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && ['tools.hzcmzhfw.cn', 'qingban.hzcmzhfw.cn'].includes(url.hostname);
}
export function duplicateKey(value, ignoreTracking = false) {
  if (!safeUrl(value)) return null;
  if (!ignoreTracking) return value;
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}
export function duplicateIds(tabs, ignoreTracking = false) {
  const seen = new Set();
  const ids = [];
  const sorted = [...tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)
    || Number(!!b.active) - Number(!!a.active) || a.index - b.index);
  for (const tab of sorted) {
    const key = duplicateKey(tab.url, ignoreTracking);
    if (key === null) continue;
    if (seen.has(key) && !tab.pinned) ids.push(tab.id);
    seen.add(key);
  }
  return ids;
}
export function filterTools(tools, query = '', site = '全部', favorites = []) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tools.filter(tool => (site === '全部' || tool.site_name === site
    || (site === '收藏' && favorites.includes(tool.tool_id)))
    && terms.every(term => `${tool.tool_name} ${tool.tool_desc} ${tool.tool_keywords || ''}`.toLowerCase().includes(term)));
}
export function tabSnapshot(tab, group = null) {
  return {
    tab_url: tab.url,
    tab_title: tab.title || tab.url,
    tab_index: tab.index,
    window_id: tab.windowId,
    is_pinned: !!tab.pinned,
    group_key: group ? `${tab.windowId}:${tab.groupId}` : '',
    group_name: group?.title || '',
    group_color: group?.color || 'grey',
    is_group_collapsed: !!group?.collapsed,
  };
}
const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
function cleanText(value, max = 500) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function validateTab(tab) {
  if (!tab || !safeUrl(tab.tab_url)) throw new Error('备份中包含不支持的网址');
  return {
    tab_url: tab.tab_url,
    tab_title: cleanText(tab.tab_title),
    tab_index: Number.isInteger(tab.tab_index) && tab.tab_index >= 0 ? tab.tab_index : 0,
    window_id: Number.isInteger(tab.window_id) ? tab.window_id : 0,
    is_pinned: tab.is_pinned === true,
    group_key: cleanText(tab.group_key, 100),
    group_name: cleanText(tab.group_name, 100),
    group_color: COLORS.includes(tab.group_color) ? tab.group_color : 'grey',
    is_group_collapsed: tab.is_group_collapsed === true,
  };
}
export function validateBackup(value, catalog) {
  if (!value || value.backup_version !== BACKUP_VERSION || !value.backup_data) {
    throw new Error('请选择浏览工作台导出的 v1 JSON 备份');
  }
  const source = value.backup_data;
  const known = new Set(catalog.map(tool => tool.tool_id));
  const list = (name, limit) => {
    if (!Array.isArray(source[name]) || source[name].length > limit) throw new Error(`备份 ${name} 格式或数量异常`);
    return source[name];
  };
  const sessions = list('session_list', 500).map(session => {
    if (!session || !Array.isArray(session.tab_list) || session.tab_list.length > 2000) throw new Error('会话格式异常');
    return {
      session_id: crypto.randomUUID(),
      session_name: cleanText(session.session_name, 100) || '导入会话',
      saved_at: validDate(session.saved_at),
      tab_list: session.tab_list.map(validateTab),
    };
  });
  const saved = list('saved_tab_list', 5000).map(item => ({
    ...validateTab(item),
    saved_id: crypto.randomUUID(),
    saved_at: validDate(item.saved_at),
    collection_name: cleanText(item.collection_name, 100) || '默认收藏夹',
    note_text: cleanText(item.note_text, 2000),
    is_archived: item.is_archived === true,
  }));
  return {
    favorite_tool_ids: [...new Set(list('favorite_tool_ids', 2000).filter(id => known.has(id)))],
    session_list: sessions,
    saved_tab_list: saved,
    settings_data: {
      theme_name: ['system', 'light', 'dark'].includes(source.settings_data?.theme_name) ? source.settings_data.theme_name : 'system',
      tab_view: ['domain', 'window', 'group'].includes(source.settings_data?.tab_view) ? source.settings_data.tab_view : 'domain',
      is_ignore_tracking: source.settings_data?.is_ignore_tracking === true,
    },
  };
}
function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
}
export function mergeBackup(current, incoming) {
  const keys = new Set(current.saved_tab_list.map(item => `${item.collection_name}\n${item.tab_url}`));
  return {
    ...current,
    favorite_tool_ids: [...new Set([...current.favorite_tool_ids, ...incoming.favorite_tool_ids])],
    session_list: [...current.session_list, ...incoming.session_list],
    saved_tab_list: [...current.saved_tab_list, ...incoming.saved_tab_list.filter(item => {
      const key = `${item.collection_name}\n${item.tab_url}`;
      if (keys.has(key)) return false;
      keys.add(key); return true;
    })],
  };
}
