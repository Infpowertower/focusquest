// Test stand-in for server.ps1 (same routes) plus a mock Jira Data Center. Not shipped.
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.env.FQ_PORT || 8765, JPORT = +process.env.FQ_JIRA_PORT || 8799, SECRET = 'devsecret', TOKEN = 'testtoken';
const root = path.join(__dirname, '..'), dataFile = process.env.FQ_DATA || path.join(__dirname, 'data.json');
let cfg = { baseUrl: '', token: '' };
let version = '1.0.0';
let awake = new Date().toISOString(), autostart = false;   // the real helper notices PC starts and wake-ups, and owns the Startup shortcut
const RELEASE = { latest: '1.1.0', publishedAt: '2026-11-20T10:00:00Z', notes: "## What's new\n- Ticket forms for several projects\n- Statistics in the sidebar\n\n<!-- install -->\n## Install\nDownload the zip file." };
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
const send = (res, s, o, ct) => { const t = typeof o === 'string' ? o : JSON.stringify(o); res.writeHead(s, { 'Content-Type': ct || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s === 204 ? undefined : t); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  if (req.headers.host !== `localhost:${PORT}`) return send(res, 403, { errorMessages: ['Forbidden.'] });
  if (req.method === 'GET' && p === '/') return send(res, 200, fs.readFileSync(path.join(root, 'app.html'), 'utf8').split('__FQ_TOKEN__').join(SECRET), 'text/html; charset=utf-8');
  if (p === '/api/ping') return send(res, 200, { app: 'focusquest' });
  if (p === '/favicon.ico') return send(res, 204, '');
  if (req.headers['x-fq-token'] !== SECRET) return send(res, 403, { errorMessages: ['Forbidden.'] });
  if (p === '/api/state') return send(res, 200, { version, awakeSince: awake, autostart, jira: { baseUrl: cfg.baseUrl, hasToken: !!cfg.token } });
  if (p === '/api/autostart' && req.method === 'POST') { autostart = !!JSON.parse(await body(req)).enabled; return send(res, 200, { ok: true, autostart }); }
  if (p === '/api/test/awake' && req.method === 'POST') { awake = JSON.parse(await body(req)).t; return send(res, 200, { ok: true }); }   // test stand-in only: pretend the PC just started
  if (p === '/api/update/check') return send(res, 200, Object.assign({ current: version, available: version !== RELEASE.latest, ok: true, message: '', checkedAt: new Date().toISOString() }, RELEASE));
  if (p === '/api/update/apply' && req.method === 'POST') {
    if (version === RELEASE.latest) return send(res, 409, { errorMessages: ['FocusQuest is already up to date.'] });
    version = RELEASE.latest;   // the real helper replaces its files and restarts here
    return send(res, 200, { ok: true, restarting: true, version });
  }
  if (p === '/api/data' && req.method === 'GET') return send(res, 200, fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : 'null');
  if (p === '/api/data' && req.method === 'PUT') { fs.writeFileSync(dataFile, await body(req)); return send(res, 200, { ok: true }); }
  if (p === '/api/jira-config') { const o = JSON.parse(await body(req)); if (o.baseUrl != null) cfg.baseUrl = o.baseUrl; if (o.token != null) cfg.token = o.token; return send(res, 200, { ok: true }); }
  if (p.startsWith('/jira/')) {
    if (!cfg.baseUrl) return send(res, 400, { errorMessages: ['The Jira address is not set yet.'] });
    const b = await body(req);
    const r = await fetch(cfg.baseUrl + '/' + req.url.slice(6), { method: req.method, redirect: 'manual', headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: b || undefined });
    const t = await r.text();
    return send(res, r.status, t, r.headers.get('content-type') || 'application/json');
  }
  send(res, 404, { errorMessages: ['Not found.'] });
}).listen(PORT, 'localhost');

// ---------------- mock Jira
const user = n => ({ name: n.toLowerCase().replace(' ', '.'), displayName: n });
const ME = user('Alex Brandt');
const ST = { open: { name: 'Open', statusCategory: { key: 'new' } }, prog: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, done: { name: 'Done', statusCategory: { key: 'done' } } };
let seq = 300;
const issues = {};
const mk = (key, type, summary, st, assignee, reporter, desc, comments = []) => issues[key] = { id: String(seq++), key, type, summary, st, assignee, reporter, desc, comments, parent: type === 'Sub-task' ? 'OPS-101' : null, epic: null, worklogs: [] };
mk('OPS-101', 'Story', 'Rework the onboarding checklist for new field technicians', 'prog', ME, user('Priya Nair'), 'h2. Goal\nThe current checklist is *outdated*.\n\n* Review steps with HR\n* Add laptop handover', [{ id: '1', author: user('Priya Nair'), created: '2026-11-20T09:12:00.000+0100', body: 'Can we have a draft by Friday?' }]);
mk('OPS-102', 'Change Request', 'Raise mailbox quota for the dispatch team', 'open', ME, user('Jonas Weber'), 'Dispatch keeps hitting the 2 GB limit.');
mk('OPS-103', 'Task', 'Renew the TLS certificate on the reporting server', 'open', ME, user('Priya Nair'), 'Expires on 12 December. <script>alert(1)</script>');
mk('OPS-104', 'Sub-task', 'Collect laptop handover form from HR', 'open', ME, ME, '');
mk('OPS-105', 'Service Request', 'Access to the shared drive for the new intern', 'prog', user('Jonas Weber'), user('Mara Lindqvist'), 'Needs read access from Monday.');
mk('OPS-106', 'Sub-task', 'Announce the mailbox change to the dispatch team', 'open', user('Jonas Weber'), ME, '').parent = 'OPS-102';
mk('OPS-110', 'Epic', 'Roll out the new warehouse scanners', 'prog', user('Priya Nair'), user('Priya Nair'), 'All sites by spring.');
mk('OPS-111', 'Task', 'Order 40 scanners for Leipzig', 'open', user('Jonas Weber'), user('Priya Nair'), '').epic = 'OPS-110';
mk('OPS-112', 'Story', 'Train the Leipzig night shift', 'done', user('Mara Lindqvist'), user('Priya Nair'), '').epic = 'OPS-110';
const brief = i => ({ id: i.id, key: i.key, fields: { summary: i.summary, status: ST[i.st], issuetype: { name: i.type, subtask: i.type === 'Sub-task' } } });
const render = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').split('\n').map(l => l.startsWith('h2. ') ? `<h2>${l.slice(4)}</h2>` : l.startsWith('* ') ? `<ul><li>${l.slice(2)}</li></ul>` : l ? `<p>${l.replace(/\*(.+?)\*/g, '<b>$1</b>')}</p>` : '').join('') ;
const out = (i, rendered) => {
  const o = { id: i.id, key: i.key, fields: { summary: i.summary, status: ST[i.st], issuetype: { name: i.type, subtask: i.type === 'Sub-task' }, assignee: i.assignee, reporter: i.reporter, creator: i.reporter, description: i.desc, comment: { comments: i.comments }, parent: i.parent ? brief(issues[i.parent]) : undefined, subtasks: Object.values(issues).filter(x => x.parent === i.key).map(brief) } };
  // the mock deliberately returns a script tag and an onerror image in rendered HTML to test the sanitizer
  if (rendered) o.renderedFields = { description: render(i.desc) + (i.key === 'OPS-103' ? '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script><a href="javascript:window.__xss=1">bad link</a><a href="/browse/OPS-101">OPS-101</a>' : ''), comment: { comments: i.comments.map(c => ({ ...c, body: render(c.body) })) } };
  return o;
};
const COMPONENTS = ['Billing', 'Dispatch', 'Field App', 'Identity', 'Mail', 'Network', 'Onboarding', 'Reporting', 'Warehouse', 'Web Portal', 'Workplace', 'Zebra Scanners', 'Legacy CRM', 'Telephony'];
const metaFields = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
  { fieldId: 'components', name: 'Component/s', required: true, schema: { type: 'array', items: 'component', system: 'components' }, allowedValues: COMPONENTS.map((n, i) => ({ id: String(i), name: n })) },
  { fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority', system: 'priority' }, allowedValues: ['High', 'Medium', 'Low'].map((n, i) => ({ id: String(i), name: n })) },
  { fieldId: 'customfield_10042', name: 'Site', required: false, schema: { type: 'option', custom: 'select' }, allowedValues: ['Berlin', 'Hamburg', 'Leipzig'].map((n, i) => ({ id: String(i), value: n })) },
  { fieldId: 'customfield_10100', name: 'Epic Link', required: false, schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } },
  { fieldId: 'labels', name: 'Labels', required: false, schema: { type: 'array', items: 'string', system: 'labels' } }
];
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const b = await body(req); const j = b ? JSON.parse(b) : null;
  if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(res, 401, { errorMessages: ['Unauthorized'] });
  let m;
  if (p === '/rest/api/2/myself') return send(res, 200, ME);
  if (p === '/rest/api/2/search') {
    let mm, list;
    if ((mm = /^"Epic Link" = ([A-Z]+-\d+)/.exec((j && j.jql) || ''))) list = Object.values(issues).filter(i => i.epic === mm[1]);
    else list = Object.values(issues).filter(i => i.assignee && i.assignee.name === ME.name && i.st !== 'done'); return send(res, 200, { total: list.length, issues: list.map(i => out(i)) }); }
  if ((m = /^\/rest\/api\/2\/issue\/createmeta\/(\w+)\/issuetypes$/.exec(p))) return (m[1] === 'OPS' || m[1] === 'HR') ? send(res, 200, { values: ['Service Request', 'Task', 'Story', 'Sub-task'].map((n, i) => ({ id: String(10 + i), name: n, subtask: n === 'Sub-task' })) }) : send(res, 404, { errorMessages: ['No project'] });
  if ((m = /^\/rest\/api\/2\/issue\/createmeta\/(\w+)\/issuetypes\/(\d+)$/.exec(p))) return send(res, 200, { isLast: true, values: metaFields });
  if (p === '/rest/api/2/issue' && req.method === 'POST') {
    const f = j.fields; const errors = {};
    if (f.project.key === 'OPS' && f.issuetype.name !== 'Sub-task' && (!f.components || !f.components.length)) errors.components = 'Component/s is required.';
    if (f.project.key !== 'OPS' && f.project.key !== 'HR') return send(res, 400, { errorMessages: ['project is required'], errors: {} });
    if (Object.keys(errors).length) return send(res, 400, { errorMessages: [], errors });
    const key = f.project.key + '-' + (200 + Object.keys(issues).length);
    const i = mk(key, f.issuetype.name, f.summary, 'open', f.assignee ? ME : null, ME, f.description || '');
    i.created = f; if (f.parent) i.parent = f.parent.key; if (f.customfield_10100) i.epic = f.customfield_10100;
    if (f.issuetype.name === 'Sub-task' && !f.parent) { delete issues[key]; return send(res, 400, { errorMessages: [], errors: { parent: 'Issue type is a sub-task but parent issue key or id not specified.' } }); }
    return send(res, 201, { id: i.id, key });
  }
  if ((m = /^\/rest\/api\/2\/issue\/([A-Z]+-\d+)(\/\w+)?$/.exec(p))) {
    const i = issues[m[1]]; if (!i) return send(res, 404, { errorMessages: ['Issue Does Not Exist'], errors: {} });
    if (!m[2]) return send(res, 200, out(i, true));
    if (m[2] === '/transitions' && req.method === 'GET') {
      const t = [];
      if (i.st === 'open') t.push({ id: '11', name: 'Start progress', to: ST.prog, fields: {} });
      if (i.st !== 'done') t.push({ id: '31', name: 'Done', to: ST.done, fields: { resolution: { required: true, name: 'Resolution', schema: { type: 'resolution' }, allowedValues: [{ id: '1', name: 'Done' }, { id: '2', name: "Won't Do" }] } } });
      return send(res, 200, { transitions: t });
    }
    if (m[2] === '/transitions') { if (j.transition.id === '31' && !(j.fields && j.fields.resolution)) return send(res, 400, { errorMessages: [], errors: { resolution: 'Resolution is required.' } }); i.st = j.transition.id === '31' ? 'done' : 'prog'; return send(res, 204, ''); }
    if (m[2] === '/comment') { i.comments.push({ id: String(seq++), author: ME, created: new Date().toISOString(), body: j.body }); return send(res, 201, {}); }
    if (m[2] === '/worklog' && req.method === 'POST') { const w = Object.assign({ id: String(seq++) }, j); i.worklogs.push(w); return send(res, 201, w); }
    if (m[2] === '/worklog') return send(res, 200, { worklogs: i.worklogs });
    if (m[2] === '/assignee') { i.assignee = ME; return send(res, 204, ''); }
  }
  send(res, 404, { errorMessages: ['mock: not found ' + p] });
}).listen(JPORT, 'localhost');
// lets the test simulate activity by someone else
http.createServer((req, res) => { const i = issues['OPS-102']; i.comments.push({ id: String(seq++), author: user('Jonas Weber'), created: new Date().toISOString(), body: 'Any update?' }); res.end('ok'); }).listen(JPORT + 1, 'localhost');
console.log('dev server http://localhost:' + PORT + '  mock jira http://localhost:' + JPORT);
