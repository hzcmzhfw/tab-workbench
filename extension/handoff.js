import { toolUrl, safeUrl, referralUrl } from './core.js';
import { readData, mutate } from './storage.js';
const $ = id => document.getElementById(id);
const data = await readData();
if (data.settings_data.theme_name !== 'system') document.documentElement.dataset.theme = data.settings_data.theme_name;
const id = new URL(location.href).searchParams.get('id');
const key = /^[a-f0-9-]{36}$/.test(id || '') ? `handoff_${id}` : null;
const stored = key ? (await chrome.storage.session.get(key))[key] : null;
// One-time handoffs prevent stale screenshots being reused and isolate concurrent right-click actions.
if (key) await chrome.storage.session.remove(key);
let timer;
function toast(text) {
  clearTimeout(timer); $('toast').textContent = text; $('toast').classList.add('visible');
  timer = setTimeout(() => $('toast').classList.remove('visible'), 6000);
}
async function openTool() {
  const target = $('target').value;
  if (!toolUrl(target)) throw new Error('目标工具不在趁手或轻办目录');
  await mutate('tool_visit', { tool_id: target });
  await chrome.tabs.create({ url: referralUrl(target) });
}
function action(id, callback) {
  $(id).addEventListener('click', async () => {
    $(id).disabled = true;
    try { await callback(); } catch (error) { toast(error.message); }
    finally { $(id).disabled = false; }
  });
}
if (!stored || Date.now() - stored.created_at > 30 * 60 * 1000 || !toolUrl(stored.target_url)) {
  $('hint').textContent = '这份临时内容已过期或已经使用。请从网页右键或插件弹窗重新发起操作。';
} else {
  const catalog = await (await fetch('catalog.json')).json();
  const isImage = !!stored.image_data || !!stored.image_url;
  const choices = isImage
    ? catalog.filter(tool => tool.site_name === '轻办' && /图片压缩|截图标注|图片马赛克|截图美化|图片格式转换|二维码图片识别/.test(tool.tool_name))
    : catalog.filter(tool => ['https://tools.hzcmzhfw.cn/json/', 'https://tools.hzcmzhfw.cn/encode/base64/', 'https://tools.hzcmzhfw.cn/encode/url/', 'https://qingban.hzcmzhfw.cn/tools/text-clean/', 'https://qingban.hzcmzhfw.cn/tools/deduplicate/', 'https://qingban.hzcmzhfw.cn/tools/word-count/', 'https://qingban.hzcmzhfw.cn/tools/qr/'].includes(tool.tool_url));
  if (!choices.some(tool => tool.tool_url === stored.target_url)) choices.unshift({ tool_url: stored.target_url, tool_name: '已选择的工具', site_name: '网站' });
  for (const tool of choices) {
    const option = document.createElement('option'); option.value = tool.tool_url;
    option.textContent = `${tool.tool_name} · ${tool.site_name}`; option.selected = tool.tool_url === stored.target_url; $('target').append(option);
  }
  $('target').disabled = false; $('open').disabled = false;
  const text = stored.input_text || stored.image_url || '';
  if (text) {
    $('content').hidden = false; $('content').value = text; $('copy').hidden = false;
    $('heading').textContent = stored.image_url ? '继续处理网页图片' : '继续处理选中的内容';
    $('hint').textContent = stored.image_url ? '图片地址已经准备好。需要本地文件的工具，请先回到原页面保存图片，再进入轻办选择图片。' : '复制内容并打开对应工具，然后粘贴继续处理。';
    if (!stored.image_url) $('format').hidden = false;
    action('copy', async () => {
      try { await navigator.clipboard.writeText($('content').value); }
      catch { $('content').focus(); $('content').select(); throw new Error('请按 Ctrl/Cmd+C 复制选中内容，再点击“只打开工具”'); }
      toast('已复制，请在工具页面粘贴'); await openTool();
    });
    action('format', () => {
      try { $('content').value = JSON.stringify(JSON.parse($('content').value), null, 2); toast('JSON 已整理'); }
      catch { throw new Error('内容不是合法 JSON，请进入趁手 JSON 工具查看错误位置'); }
    });
    if (stored.image_url && safeUrl(stored.image_url)) {
      const link = document.createElement('a'); link.href = stored.image_url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = '打开原图片 ↗'; $('hint').append(' ', link);
    }
  }
  if (typeof stored.image_data === 'string' && stored.image_data.startsWith('data:image/png;base64,')) {
    $('heading').textContent = '截图已准备好';
    $('preview').hidden = false; $('preview').src = stored.image_data;
    $('download').hidden = false;
    $('hint').textContent = '选择下一步工具，下载截图后在轻办选择这张图片。可继续标注、打码、美化或压缩。';
    action('download', async () => {
      const link = document.createElement('a'); link.href = stored.image_data; link.download = `网页截图-${Date.now()}.png`; link.click();
      await openTool();
    });
  }
  action('open', openTool);
}
