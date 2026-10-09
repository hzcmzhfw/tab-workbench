import { bookmarkNodes } from './bookmark-core.js';

export const BOOKMARK_HISTORY_LIMIT = 20;
export function bookmarkTreeValue(tree) {
  const clean = node => {
    const value = { id: node.id, title: node.title };
    for (const key of ['url', 'parentId', 'index', 'unmodifiable', 'folderType']) if (node[key] !== undefined) value[key] = node[key];
    if (node.children) value.children = node.children.map(clean);
    return value;
  };
  return tree.map(clean);
}
export function appendBookmarkHistory(history, snapshot) {
  return [snapshot, ...history].slice(0, BOOKMARK_HISTORY_LIMIT);
}
export async function readBookmarkHistory() {
  return (await chrome.storage.local.get({ bookmark_history_list: [] })).bookmark_history_list;
}
export async function initializeBookmarkBaseline() {
  const data = await chrome.storage.local.get('bookmark_tree');
  if (!data.bookmark_tree) await chrome.storage.local.set({ bookmark_tree: bookmarkTreeValue(await chrome.bookmarks.getTree()) });
}
export async function recordExternalBookmarkChange() {
  const stored = (await chrome.storage.local.get('bookmark_tree')).bookmark_tree;
  const before = stored ? bookmarkTreeValue(stored) : null;
  const after = bookmarkTreeValue(await chrome.bookmarks.getTree());
  if (!before) { await chrome.storage.local.set({ bookmark_tree: after }); return; }
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const entry = { snapshot_id: crypto.randomUUID(), saved_at: new Date().toISOString(), action_name: 'Chrome 外部修改前', bookmark_tree: before };
  await chrome.storage.local.set({ bookmark_history_list: appendBookmarkHistory(await readBookmarkHistory(), entry), bookmark_tree: after });
}
export async function withBookmarkSnapshot(actionName, action) {
  // Flush any Chrome-side changes first, then record the state immediately before this operation.
  await recordExternalBookmarkChange();
  const before = bookmarkTreeValue(await chrome.bookmarks.getTree()), history = await readBookmarkHistory();
  const entry = { snapshot_id: crypto.randomUUID(), saved_at: new Date().toISOString(), action_name: actionName, bookmark_tree: before };
  try { await chrome.storage.local.set({ bookmark_history_list: appendBookmarkHistory(history, entry), bookmark_tree: before }); }
  catch { throw new Error('历史快照保存失败，尚未修改书签；请先导出备份并检查本机存储空间'); }
  try { return await action(); }
  finally {
    const after = bookmarkTreeValue(await chrome.bookmarks.getTree());
    // Cancelled/no-op/failed operations with no changes do not consume a history slot.
    if (JSON.stringify(before) === JSON.stringify(after)) await chrome.storage.local.set({ bookmark_history_list: history, bookmark_tree: after });
    else await chrome.storage.local.set({ bookmark_tree: after });
  }
}

// Stage the target contents before touching existing bookmarks. Chrome system and managed roots stay in place.
export async function restoreBookmarkTree(snapshot) {
  const live = await chrome.bookmarks.getTree(), roots = live[0].children || [];
  const desiredRoots = snapshot[0]?.children || [];
  const plans = [];
  for (const desired of desiredRoots) {
    if (desired.unmodifiable) continue;
    const root = roots.find(node => node.id === desired.id);
    if (!root || root.unmodifiable) throw new Error('Chrome 系统文件夹已变化，此快照不能直接恢复；请导出备份后手动导入');
    if (bookmarkNodes([root, desired]).some(node => node.unmodifiable)) throw new Error('目录中包含组织管理书签，无法替换');
    plans.push({ root, desired, stage: null, rollback: null, old: [], fresh: [] });
  }
  if (!plans.length) throw new Error('快照没有可恢复的用户书签文件夹');
  if (roots.some(root => !root.unmodifiable && !desiredRoots.some(node => node.id === root.id))) throw new Error('Chrome 系统文件夹已变化，请导出备份后手动导入');
  const populate = async (items, parentId) => {
    for (const node of items) {
      const options = { parentId, title: node.title }; if (node.url !== undefined) options.url = node.url;
      const created = await chrome.bookmarks.create(options);
      if (node.children) await populate(node.children, created.id);
    }
  };
  let committed = false;
  try {
    for (const plan of plans) {
      plan.stage = await chrome.bookmarks.create({ parentId: plan.root.id, title: '浏览工作台 · 恢复暂存' });
      await populate(plan.desired.children || [], plan.stage.id);
      plan.fresh = await chrome.bookmarks.getChildren(plan.stage.id);
    }
    // External edits during staging must not be silently overwritten.
    const now = await chrome.bookmarks.getTree(), stageIds = new Set(plans.map(plan => plan.stage.id));
    const withoutStages = tree => tree.map(node => ({ ...node, ...(node.children ? { children: withoutStages(node.children.filter(child => !stageIds.has(child.id))) } : {}) }));
    if (JSON.stringify(bookmarkTreeValue(withoutStages(now))) !== JSON.stringify(bookmarkTreeValue(live))) throw new Error('恢复期间书签发生外部修改，请重新尝试');
    for (const plan of plans) {
      plan.rollback = await chrome.bookmarks.create({ parentId: plan.root.id, title: '浏览工作台 · 恢复回退' });
      plan.old = (await chrome.bookmarks.getChildren(plan.root.id)).filter(node => node.id !== plan.stage.id && node.id !== plan.rollback.id);
      for (const node of plan.old) await chrome.bookmarks.move(node.id, { parentId: plan.rollback.id });
      for (let i = 0; i < plan.fresh.length; i++) await chrome.bookmarks.move(plan.fresh[i].id, { parentId: plan.root.id, index: i });
    }
    committed = true;
  } catch (error) {
    const failures = [];
    for (const plan of plans.reverse()) {
      try {
        if (plan.rollback) {
          for (const node of plan.fresh) { try { await chrome.bookmarks.removeTree(node.id); } catch {} }
          for (let i = 0; i < plan.old.length; i++) await chrome.bookmarks.move(plan.old[i].id, { parentId: plan.root.id, index: i });
          await chrome.bookmarks.removeTree(plan.rollback.id);
        }
        if (plan.stage) await chrome.bookmarks.removeTree(plan.stage.id);
      } catch { failures.push(plan.root.title); }
    }
    throw new Error(failures.length ? `恢复未完成，原书签保留在回退文件夹：${failures.join('、')}。${error.message}` : `恢复失败，原书签已保留：${error.message}`);
  }
  if (committed) {
    for (const plan of plans) {
      await chrome.bookmarks.removeTree(plan.stage.id);
      await chrome.bookmarks.removeTree(plan.rollback.id);
    }
  }
}
