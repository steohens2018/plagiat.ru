// Самотест в headless Chromium: node tools/selftest.mjs [адрес] [папка для файлов]
// Нужны Playwright (глобально) и запущенный сервер: python3 -m http.server 8770 (из папки приложения).
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const pw = createRequire(import.meta.url)(execSync('npm root -g', { encoding: 'utf8' }).trim() + '/playwright');
const URL0 = process.argv[2] || 'http://localhost:8770/', OUT = process.argv[3] || '';
const browser = await pw.chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
const net = []; page.on('request', r => { if(!r.url().startsWith(URL0) && !/^(data|blob):/.test(r.url())) net.push(r.url()); });
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if(!c) fail++; };
await page.goto(URL0, { waitUntil: 'load' });
await page.fill('#p1', 'test-pin-2026'); await page.fill('#p2', 'test-pin-2026'); await page.click('#pGo');
await page.waitForSelector('#new', { timeout: 30000 });
const r = await page.evaluate(async () => {
  const r = await runSelftest();
  const b = u8 => { let s = ''; for(let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  return { ok: r.ok, mask: r.mask, docs: r.docs, merged: b(r.merged), mfo: b(r.mfo), files: r.files.map(f => ({ name: f.fileName, data: b(f.bytes) })) };
});
console.log('\n=== Маскировка: что ушло бы наружу ===');
for(const m of r.mask){ console.log('\n# ' + m.title + '\n' + m.out); ok(!m.leaks.length, `настоящих значений проверено: ${m.checked}, утечек: ${m.leaks.length} ${m.leaks.join(', ')}`); }
console.log('\n=== Тестовый пакет: правила оформления ===');
for(const d of r.docs){ console.log('\n# ' + d.title); for(const c of d.checks) ok(c.ok, c.rule + (c.ok ? '' : ' — ' + c.note)); }
ok(net.length === 0, 'самотест не обращался к сети: ' + net.join(' '));
ok(errors.length === 0, 'ошибок на странице нет ' + errors.join(' | '));
if(OUT){
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + '/СНД — тестовый пакет.docx', Buffer.from(r.merged, 'base64'));
  fs.writeFileSync(OUT + '/Микрофинансы — тестовый пакет.docx', Buffer.from(r.mfo, 'base64'));
  for(const f of r.files) fs.writeFileSync(OUT + '/' + f.name, Buffer.from(f.data, 'base64'));
  console.log('\nФайлы сохранены в ' + OUT);
}
await browser.close();
console.log(fail ? `\nИТОГ: замечаний — ${fail}` : '\nИТОГ: всё в порядке');
process.exit(fail ? 1 : 0);
