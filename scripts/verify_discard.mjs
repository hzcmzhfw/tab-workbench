// Raw CDP attaches only to the extension page, leaving the discarded web tab undebugged.
// Playwright automatically attaches every web tab; Chrome crashes discarding an attached renderer on this setup.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'tab-workbench-discard-'));
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<title>休眠验收网页</title><h1>后台页面</h1>'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/discard`;
const child = spawn(process.env.BROWSER_PATH || chromium.executablePath(), ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let socket, browserLog = '';
child.stderr.on('data', bytes => { browserLog += bytes.toString(); browserLog = browserLog.slice(-2000); });
let sequence = 0; const pending = new Map();
function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 10000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).trim().split('\n'); break; } catch {}
    if (child.exitCode !== null || child.signalCode) throw new Error(browserLog);
    await delay(100);
  }
  if (!port) throw new Error(`浏览器调试端口未就绪：${browserLog}`);
  socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return; clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  let workerTarget;
  for (let i = 0; i < 50; i++) { const targets = await command('Target.getTargets'); workerTarget = targets.targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith('chrome-extension://') && target.url.endsWith('/background.js')); if (workerTarget) break; await delay(100); }
  if (!workerTarget) throw new Error('此浏览器不支持命令行加载扩展，请使用 Playwright 配套 Chromium');
  const id = workerTarget.url.split('/')[2];
  const { targetId } = await command('Target.createTarget', { url: `chrome-extension://${id}/index.html` });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  for (let i = 0; i < 50; i++) { if (await evaluate('!!document.querySelector(".row")')) break; await delay(100); }
  const tabId = await evaluate(`(async()=>{const t=await chrome.tabs.create({url:${JSON.stringify(url)},active:false});return t.id})()`);
  for (let i = 0; i < 50; i++) { if (await evaluate(`(async()=>{const t=await chrome.tabs.get(${tabId});return t.status==='complete'})()`)) break; await delay(100); }
  await evaluate('document.querySelector("[data-view=tabs]").click()');
  for (let i = 0; i < 50; i++) { if (await evaluate('!!document.querySelector(".row input[type=checkbox]")')) break; await delay(100); }
  await evaluate('document.querySelector(".row input[type=checkbox]").click();[...document.querySelectorAll("#actions button")].find(b=>b.textContent==="休眠所选").click()');
  for (let i = 0; i < 50; i++) { if (await evaluate('!!document.querySelector(".ask-dialog[open]")')) break; await delay(100); }
  await evaluate('document.querySelector(".ask-dialog .primary").click()');
  let discarded;
  for (let i = 0; i < 50; i++) {
    discarded = await evaluate(`(async()=>{const t=(await chrome.tabs.query({})).find(t=>t.url===${JSON.stringify(url)});return t?.discarded===true})()`);
    if (discarded) break; await delay(100);
  }
  assert.equal(discarded, true);
  const version = await command('Browser.getVersion');
  const report = { browser_version: version.product, is_tab_discarded: true, is_web_tab_debugged: false };
  await mkdir('output/playwright', { recursive: true }); await writeFile('output/playwright/discard-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  socket?.close();
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('浏览器已关闭')); }
  child.kill('SIGTERM'); if (child.exitCode === null && !child.signalCode) await new Promise(resolve => child.once('exit', resolve));
  await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true });
}
