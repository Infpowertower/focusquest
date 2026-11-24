// Builds the app, starts the dev server on a clean temporary data file and runs all browser tests.
// Exits non-zero if anything fails. Needs playwright to be resolvable (npm install --no-save playwright).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const node = process.execPath, here = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fq-test-'));
const env = Object.assign({}, process.env, { FQ_DATA: path.join(tmp, 'data.json') });
const run = f => spawnSync(node, [path.join(here, f), ...process.argv.slice(2)], { stdio: 'inherit', env }).status === 0;
const ping = () => new Promise(r => http.get(`http://localhost:${+env.FQ_PORT || 8765}/api/ping`, x => { x.resume(); r(x.statusCode === 200); }).on('error', () => r(false)));

(async () => {
  if (spawnSync(node, [path.join(here, 'build.js'), '--web'], { stdio: 'inherit' }).status !== 0) process.exit(1);
  if (await ping()) { console.error('Something already answers on the dev server port. Stop it first.'); process.exit(1); }
  const srv = spawn(node, [path.join(here, 'devserver.js')], { stdio: 'ignore', env });
  let ok = false;
  try {
    for (let i = 0; i < 50 && !(await ping()); i++) await new Promise(r => setTimeout(r, 100));
    ok = ['test.js', 'test2.js', 'test-web.js'].map(run).every(Boolean);
  } finally { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log(ok ? 'All browser tests passed.' : 'Some browser tests FAILED.');
  process.exit(ok ? 0 : 1);
})();
