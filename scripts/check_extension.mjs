import { readFile, readdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { toolUrl } from '../extension/core.js';
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.ok(Number(manifest.minimum_chrome_version) >= 110);
assert.equal(manifest.host_permissions, undefined);
for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons)]) await access(`extension/${file}`);
for (const file of await readdir('extension')) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', `extension/${file}`]);
  if (file.endsWith('.html')) {
    const html = await readFile(`extension/${file}`, 'utf8');
    assert.ok(!/<script\b[^>]*src=["']https?:/i.test(html), '禁止远程扩展脚本');
    assert.ok(!/\bonclick\s*=/i.test(html), '禁止内联脚本');
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (match[1].startsWith('http') || match[1].startsWith('#')) continue;
      await access(`extension/${match[1]}`);
    }
  }
}
const catalog = JSON.parse(await readFile('extension/catalog.json', 'utf8'));
assert.ok(catalog.length >= 300);
assert.equal(new Set(catalog.map(tool => tool.tool_id)).size, catalog.length);
for (const tool of catalog) { assert.equal(tool.tool_id, tool.tool_url); assert.ok(toolUrl(tool.tool_url)); assert.ok(tool.tool_name); }
console.log(`Manifest、页面引用与脚本检查通过；目录 ${catalog.length} 项`);
