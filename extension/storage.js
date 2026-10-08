import { DEFAULT_SETTINGS } from './core.js';
export const DEFAULT_DATA = {
  favorite_tool_ids: [], recent_tool_ids: [], session_list: [], saved_tab_list: [],
  settings_data: DEFAULT_SETTINGS,
};
export async function readData() {
  const data = await chrome.storage.local.get(DEFAULT_DATA);
  data.settings_data = { ...DEFAULT_SETTINGS, ...data.settings_data };
  return data;
}
export async function mutate(actionType, payload = {}) {
  const reply = await chrome.runtime.sendMessage({ action_type: actionType, action_data: payload });
  if (!reply?.is_success) throw new Error(reply?.error_text || '操作失败，请重新加载插件');
  return reply.result_data;
}
