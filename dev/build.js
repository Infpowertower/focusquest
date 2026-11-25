// Inlines CSS and JS into one self-contained app.html.
// With --web it also writes site/: the same app as an installable, offline-capable website (no helper, no Jira).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
// A release build stamps its version into the page (FQ_VERSION). Without it the placeholder stays and the
// page skips the "page and helper match" check; the test server stamps it when it serves the page.
const stamp = t => process.env.FQ_VERSION ? t.split('__FQ_VERSION__').join(process.env.FQ_VERSION) : t;
const js = stamp(src('core.js') + '\n' + src('ui.js'));
if (js.includes('</scr' + 'ipt')) throw new Error('script end tag inside JS');
const page = head => src('shell.html').replace('<!--HEAD-->', () => head).replace('/*CSS*/', () => src('app.css')).replace('/*JS*/', () => js);

const html = page('');
fs.writeFileSync(path.join(root, 'app.html'), html);
console.log('app.html', html.length, 'bytes');

if (process.argv.includes('--web')) {
  const site = path.join(root, 'site'), web = path.join(root, 'web');
  fs.mkdirSync(site, { recursive: true });
  const head = [
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icon-192.png">',
    '<meta name="theme-color" content="#171C38">',
    '<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});</scr' + 'ipt>'
  ].join('\n');
  fs.writeFileSync(path.join(site, 'index.html'), page(head));
  for (const f of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png']) fs.copyFileSync(path.join(web, f), path.join(site, f));
  console.log('site/ written');
}
