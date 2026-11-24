const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, s) => {
  let p = q.url.split('?')[0]; if (!p.startsWith('/focusquest/')) { s.writeHead(404); return s.end(); }
  p = p.slice('/focusquest/'.length) || 'index.html';
  const f = path.join(root, 'site', p);
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': types[path.extname(f)] }); s.end(fs.readFileSync(f));
});
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  await new Promise(r => srv.listen(8931, r));
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8931/focusquest/');
  await p.waitForSelector('#q');
  ok(await p.evaluate(() => navigator.serviceWorker.ready.then(r => !!r.active)), 'service worker active');
  ok((await p.textContent('#railfoot')).includes('Browser version'), 'footer says browser version');
  ok(!(await p.textContent('#main')).includes('You opened app.html directly'), 'no helper banner');
  await p.fill('#q', 'Write report !1'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.body.textContent.includes('Write report'));
  await p.reload(); await p.waitForSelector('#q');
  ok((await p.textContent('body')).includes('Write report'), 'to-do survives reload');
  await new Promise(r => srv.close(r)); srv.closeAllConnections && srv.closeAllConnections();
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('#q');
  ok((await p.textContent('body')).includes('Write report'), 'loads offline with server gone, data intact');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  // plain file, no web extras
  const p2 = await (await b.newContext()).newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
  await p2.goto('file://' + path.join(root, 'app.html')); await p2.waitForSelector('#q');
  ok((await p2.textContent('#main')).includes('You opened app.html directly'), 'file:// mode unchanged');
  ok(!fs.readFileSync(path.join(root, 'app.html'), 'utf8').includes('serviceWorker'), 'app.html has no service worker code');
  ok(e2.length === 0, 'no errors in file mode');
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
