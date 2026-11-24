'use strict';
/* FocusQuest - everything runs locally in this page. The helper (server.ps1) stores the data and relays Jira calls. */
const TOKEN = '__FQ_TOKEN__';
const SERVED = /^http/.test(location.protocol) && TOKEN.indexOf('__FQ') !== 0;
// Browser version: the page is hosted on a website instead of being served by the helper.
const WEB = !SERVED && /^http/.test(location.protocol);

/* ------------------------------------------------------------------ small helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const localDT = d => `${dstr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const clone = o => JSON.parse(JSON.stringify(o));
const PRIO = { 1: 'High', 2: 'Medium', 3: 'Low' };

function relTime(ts) {
  if (!ts) return 'never';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function fmtDate(s) { return parseD(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
function fmtWhen(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`, ds = dstr(d);
  if (ds === today()) return hm;
  if (ds === dstr(addDays(new Date(), 1))) return 'tomorrow ' + hm;
  return fmtDate(ds) + ' ' + hm;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------------ state */
function defaults() {
  return {
    v: 1, rev: 0, items: [],
    game: { xp: 0, log: [], streak: { count: 0, last: null, best: 0 }, counts: {}, days: {}, badges: {} },
    settings: {
      dailyGoal: 3, sound: true, motion: true, theme: 'auto', sort: 'prio', dayRemindTime: '09:00', refreshMin: 15,
      jql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
    },
    ticketCfg: {
      project: '', types: ['Service Request', 'Task', 'Story'], defaultType: 'Task', assignToMe: true,
      fields: [{ uid: 'f_components', label: 'Components', fieldId: 'components', kind: 'multi-name', values: [], required: true, def: [], types: [] }],
      templates: []
    }
  };
}
function merge(def, obj) {
  if (Array.isArray(def) || def === null || typeof def !== 'object') return obj === undefined || obj === null ? def : obj;
  const out = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  for (const k in def) out[k] = merge(def[k], out[k]);
  return out;
}

let S = defaults();
let meta = { jira: { baseUrl: '', hasToken: false } };
let me = null;                // Jira user (from /myself)
let loadFailed = false;
let helperDown = false;
let saveTimer = null;
const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('focusquest') : null;

async function api(method, path, body) {
  const r = await fetch(path, {
    method, headers: { 'X-FQ-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* not json */ }
  if (!r.ok) throw new Error((j && j.errorMessages && j.errorMessages[0]) || `The helper answered with status ${r.status}.`);
  return j;
}

function save() {
  if (loadFailed) return;
  S.rev = (S.rev || 0) + 1;
  try { localStorage.setItem('focusquest', JSON.stringify(S)); } catch (e) { /* storage full or blocked */ }
  if (!SERVED) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
async function flush() {
  if (loadFailed || !SERVED) return;
  clearTimeout(saveTimer); saveTimer = null;
  try {
    await api('PUT', '/api/data', S);
    if (helperDown) { helperDown = false; renderRailFoot(); }
    if (bc) bc.postMessage({ rev: S.rev });
  } catch (e) {
    if (!helperDown) { helperDown = true; renderRailFoot(); toast('The FocusQuest helper is not running. Changes stay in this browser until you start it again.', { kind: 'bad', ttl: 9000 }); }
    saveTimer = setTimeout(flush, 8000);
  }
}

async function loadState() {
  let raw = null;
  if (SERVED) {
    meta = await api('GET', '/api/state');
    const r = await fetch('/api/data', { headers: { 'X-FQ-Token': TOKEN } });
    const t = await r.text();
    if (!r.ok) throw new Error('The data file could not be read.');
    raw = JSON.parse(t);            // throws on a damaged file: we then refuse to overwrite it
  } else {
    try { raw = JSON.parse(localStorage.getItem('focusquest') || 'null'); } catch (e) { raw = null; }
  }
  S = merge(defaults(), raw || {});
  for (const it of S.items) { if (!it.steps) it.steps = []; if (!it.prio) it.prio = 2; }
}

/* ------------------------------------------------------------------ dates, due, reminders */
function dueTs(it) { return it.due ? new Date(`${it.due}T${it.dueTime || '23:59'}`).getTime() : null; }
function effReminder(it) {
  if (it.remind) { const t = new Date(it.remind).getTime(); return isNaN(t) ? null : t; }
  if (it.due) return new Date(`${it.due}T${it.dueTime || S.settings.dayRemindTime || '09:00'}`).getTime();
  return null;
}
/* after the user edits dates: do not fire for a moment that is already in the past */
function touchReminder(it) { const t = effReminder(it); it.remFired = (t && t <= Date.now()) ? t : null; }

function dueInfo(it) {
  if (!it.due) return null;
  const t = today(), tm = it.dueTime ? ' ' + it.dueTime : '';
  const diff = Math.round((parseD(it.due) - parseD(t)) / 86400000);
  if (diff < 0) return { cls: 'over', text: diff === -1 ? 'Was due yesterday' : `Was due ${fmtDate(it.due)}` };
  if (diff === 0) return { cls: (it.dueTime && dueTs(it) < Date.now()) ? 'over' : 'today', text: 'Due today' + tm };
  if (diff === 1) return { cls: '', text: 'Due tomorrow' + tm };
  return { cls: '', text: 'Due ' + fmtDate(it.due) + tm };
}

function parseWhen(s) {
  s = s.toLowerCase(); const now = new Date(); let m;
  if (s === 'today' || s === 'heute') return { date: today() };
  if (['tomorrow', 'tmr', 'morgen'].includes(s)) return { date: dstr(addDays(now, 1)) };
  let i = -1;
  if ((m = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(s))) i = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1]);
  else i = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'].indexOf(s);
  if (i >= 0) { let diff = (i - now.getDay() + 7) % 7; if (diff === 0) diff = 7; return { date: dstr(addDays(now, diff)) }; }
  if ((m = /^\+(\d+)d$/.exec(s))) return { date: dstr(addDays(now, +m[1])) };
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return { date: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
  if ((m = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(s))) {
    const y = m[3] ? +m[3] : now.getFullYear(); let d = new Date(y, m[2] - 1, +m[1]);
    if (!m[3] && dstr(d) < today()) d = new Date(y + 1, m[2] - 1, +m[1]);
    return { date: dstr(d) };
  }
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s)) && +m[1] < 24 && +m[2] < 60) return { time: `${pad(m[1])}:${m[2]}` };
  return null;
}
function parseQuick(text) {
  let prio = null, due = null, time = null; const words = [];
  for (const w of text.trim().split(/\s+/)) {
    let m;
    if ((m = /^[!pP]([123])$/.exec(w))) { prio = +m[1]; continue; }
    if (w[0] === '@' && w.length > 1) {
      const r = parseWhen(w.slice(1));
      if (r) { if (r.date) due = r.date; if (r.time) time = r.time; continue; }
    }
    words.push(w);
  }
  if (time && !due) due = today();
  return { title: words.join(' '), prio, due, time };
}

/* ------------------------------------------------------------------ game */
const XP = { todoCreate: 5, step: 5, todoDone: { 1: 40, 2: 30, 3: 20 }, onTime: 10, import: 5, ticketCreate: 40, comment: 20, transition: 15, ticketClose: 120, ticketClosedElsewhere: 60, goal: 50 };
const TITLES = ['Fresh start', 'Getting going', 'List wrangler', 'Ticket tamer', 'Flow finder', 'Backlog breaker', 'Sprint ranger', 'Queue commander', 'Master closer', 'Board legend'];
const needXp = l => 50 * l * (l - 1);                 // total XP needed to reach level l
function levelOf(xp) { let l = 1; while (xp >= needXp(l + 1)) l++; return l; }
const titleOf = l => TITLES[Math.min(l, TITLES.length) - 1];
function dayRec(d = today()) { return S.game.days[d] || (S.game.days[d] = { xp: 0, done: 0 }); }
const isWeekend = d => { const w = d.getDay(); return w === 0 || w === 6; };
/* true when no workday lies strictly between the two dates */
function onlyWeekendBetween(a, b) {
  for (let d = addDays(parseD(a), 1); dstr(d) < b; d = addDays(d, 1)) if (!isWeekend(d)) return false;
  return true;
}
function streakNow() {
  const s = S.game.streak;
  if (!s.last) return 0;
  return (s.last === today() || onlyWeekendBetween(s.last, today())) ? s.count : 0;
}

const BADGES = [
  { id: 'first', ic: '🌱', name: 'First one down', desc: 'Complete your first to-do', test: g => (g.counts.todoDone || 0) >= 1 },
  { id: 'ten', ic: '🔟', name: 'Ten down', desc: 'Complete 10 to-dos', test: g => (g.counts.todoDone || 0) >= 10 },
  { id: 'fifty', ic: '💪', name: 'Fifty finished', desc: 'Complete 50 to-dos', test: g => (g.counts.todoDone || 0) >= 50 },
  { id: 'steps', ic: '🪜', name: 'Small steps', desc: 'Tick off 20 steps', test: g => (g.counts.step || 0) >= 20 },
  { id: 'smith', ic: '🛠️', name: 'Ticket smith', desc: 'Create your first Jira ticket', test: g => (g.counts.ticketCreate || 0) >= 1 },
  { id: 'voice', ic: '💬', name: 'Speaking up', desc: 'Write 5 ticket comments', test: g => (g.counts.comment || 0) >= 5 },
  { id: 'closer', ic: '✅', name: 'Closer', desc: 'Close your first ticket', test: g => (g.counts.ticketClose || 0) >= 1 },
  { id: 'closer10', ic: '🏅', name: 'Serial closer', desc: 'Close 10 tickets', test: g => (g.counts.ticketClose || 0) >= 10 },
  { id: 'closer50', ic: '🏆', name: 'Backlog breaker', desc: 'Close 50 tickets', test: g => (g.counts.ticketClose || 0) >= 50 },
  { id: 'hat', ic: '🎩', name: 'Hat trick', desc: 'Finish 3 things in one day', test: () => dayRec().done >= 3 },
  { id: 'goal', ic: '🎯', name: 'On target', desc: 'Reach your daily goal', test: () => !!dayRec().goalHit },
  { id: 'streak3', ic: '🔥', name: 'Warmed up', desc: '3 workdays in a row', test: g => g.streak.count >= 3 },
  { id: 'streak5', ic: '🚀', name: 'On a roll', desc: '5 workdays in a row', test: g => g.streak.count >= 5 },
  { id: 'streak10', ic: '⚡', name: 'Unstoppable', desc: '10 workdays in a row', test: g => g.streak.count >= 10 },
  { id: 'lvl5', ic: '⭐', name: 'Level 5', desc: 'Reach level 5', test: g => levelOf(g.xp) >= 5 },
  { id: 'lvl10', ic: '🌟', name: 'Level 10', desc: 'Reach level 10', test: g => levelOf(g.xp) >= 10 }
];

function award(type, base, label, o = {}) {
  let xp = base, lucky = false;
  if (o.lucky !== false && base >= 20 && Math.random() < 0.12) { xp = base * 2; lucky = true; }
  const before = levelOf(S.game.xp);
  S.game.xp += xp; dayRec().xp += xp;
  S.game.counts[type] = (S.game.counts[type] || 0) + 1;
  S.game.log.unshift({ t: Date.now(), type, xp, label });
  if (S.game.log.length > 200) S.game.log.length = 200;
  toast(`<span>+${xp} XP${lucky ? ' &nbsp;Lucky double!' : ''}</span><small>${esc(label)}</small>`, { kind: 'xp', html: true, ttl: lucky ? 4500 : 2800 });
  const after = levelOf(S.game.xp);
  if (after > before) setTimeout(() => cheer(`Level ${after}`, titleOf(after), 'You levelled up. Keep the momentum.', () => { sound('level'); confetti(140); }), 400);
  checkBadges();
  renderPlayer(true);
  return xp;
}
function takeXp(xp, type, day) {
  S.game.xp = Math.max(0, S.game.xp - xp);
  if (type && S.game.counts[type]) S.game.counts[type]--;
  const d = S.game.days[day || today()]; if (d) { d.xp = Math.max(0, d.xp - xp); }
  renderPlayer();
}
/* something got finished: daily goal + streak */
function bumpDone() {
  const t = today(), d = dayRec(t), s = S.game.streak;
  d.done++;
  if (s.last !== t) {
    s.count = (s.last && onlyWeekendBetween(s.last, t)) ? s.count + 1 : 1;
    s.last = t; s.best = Math.max(s.best || 0, s.count);
  }
  if (!d.goalHit && d.done >= S.settings.dailyGoal) {
    d.goalHit = true;
    setTimeout(() => { award('goal', XP.goal, 'Daily goal reached', { lucky: false }); save(); }, 900);
  }
  checkBadges();
  renderPlayer();
}
function checkBadges() {
  for (const b of BADGES) {
    if (S.game.badges[b.id]) continue;
    let ok = false; try { ok = b.test(S.game); } catch (e) { ok = false; }
    if (ok) {
      S.game.badges[b.id] = Date.now();
      toast(`<b>${b.ic} Badge earned: ${esc(b.name)}</b>${esc(b.desc)}`, { html: true, ttl: 6000 });
    }
  }
}

/* ------------------------------------------------------------------ feedback: toasts, sound, confetti */
function toast(msg, o = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + (o.kind || '');
  if (o.html) el.innerHTML = msg; else el.textContent = msg;
  if (o.actions) {
    const row = document.createElement('div'); row.className = 'row';
    for (const a of o.actions) {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = a.label;
      b.onclick = () => { el.remove(); a.fn(); };
      row.appendChild(b);
    }
    el.appendChild(row);
  }
  if (o.sticky) el.dataset.sticky = '1';
  const box = $('#toasts'), passing = $$('.toast:not([data-sticky])', box);
  if (passing.length >= 4) passing[0].remove();
  box.appendChild(el);
  if (!o.sticky) setTimeout(() => el.remove(), o.ttl || 4000);
  return el;
}
const cheerQ = []; let cheering = false;
function cheer(title, sub, small, fx) { cheerQ.push({ title, sub, small, fx }); if (!cheering) nextCheer(); }
function nextCheer() {
  const c = cheerQ.shift();
  if (!c) { cheering = false; return; }
  cheering = true;
  const el = document.createElement('div'); el.className = 'cheer';
  el.innerHTML = `<div><b>${esc(c.title)}</b><span>${esc(c.sub || '')}</span>${c.small ? `<small>${esc(c.small)}</small>` : ''}</div>`;
  document.body.appendChild(el);
  if (c.fx) c.fx();
  setTimeout(() => { el.remove(); nextCheer(); }, 2600);
}

let actx = null;
function sound(kind) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const seqs = {
      done: [[660, 0], [880, .09]], add: [[520, 0]], step: [[740, 0]],
      close: [[523, 0], [659, .1], [784, .2], [1047, .32], [1319, .46]],
      level: [[392, 0], [523, .12], [659, .24], [784, .36], [1047, .5]],
      remind: [[880, 0], [880, .22]]
    };
    const t0 = actx.currentTime + 0.01;
    for (const [f, at] of seqs[kind] || seqs.done) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.28);
      o.connect(g); g.connect(actx.destination);
      o.start(t0 + at); o.stop(t0 + at + 0.3);
    }
  } catch (e) { /* no audio available */ }
}

const motionOk = () => S.settings.motion && !matchMedia('(prefers-reduced-motion: reduce)').matches;
let parts = [], rafOn = false;
function confetti(n, fromEl) {
  if (!motionOk()) return;
  const c = $('#confetti'); c.width = innerWidth; c.height = innerHeight;
  let x = innerWidth / 2, y = innerHeight * 0.35;
  if (fromEl && fromEl.getBoundingClientRect) { const r = fromEl.getBoundingClientRect(); if (r.width) { x = r.left + r.width / 2; y = r.top + r.height / 2; } }
  const cols = ['#F0B02E', '#5346D4', '#43C99B', '#F47480', '#86ACEE', '#FFFFFF'];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * (n > 60 ? 13 : 7);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, s: 4 + Math.random() * 6, c: cols[i % cols.length], r: Math.random() * 6, life: 70 + Math.random() * 50 });
  }
  if (!rafOn) { rafOn = true; requestAnimationFrame(tickConfetti); }
}
function tickConfetti() {
  const c = $('#confetti'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  parts = parts.filter(p => p.life > 0 && p.y < c.height + 20);
  for (const p of parts) {
    p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += 0.2; p.life--;
    g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.globalAlpha = Math.min(1, p.life / 25);
    g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66); g.restore();
  }
  if (parts.length) requestAnimationFrame(tickConfetti); else { rafOn = false; g.clearRect(0, 0, c.width, c.height); }
}

/* ------------------------------------------------------------------ Jira */
class JiraError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
const jiraReady = () => SERVED && !!meta.jira.baseUrl && meta.jira.hasToken;

async function jira(method, path, body) {
  if (!SERVED) throw new JiraError(WEB ? 'Jira is not available in the browser version.' : 'Jira needs the helper. Start FocusQuest with Start-FocusQuest.cmd.', 0);
  let r;
  try {
    r = await fetch('/jira/' + path, {
      method, headers: { 'X-FQ-Token': TOKEN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) { throw new JiraError('The FocusQuest helper is not running. Start it again with Start-FocusQuest.cmd.', 0); }
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* html or empty */ }
  if (r.ok) return j;
  let msg = '';
  if (j) msg = [...(j.errorMessages || []), ...Object.entries(j.errors || {}).map(([k, v]) => `${k}: ${v}`)].join(' ') || j.message || '';
  if (r.status === 401) msg = 'Jira did not accept the token. Check the token in Settings.';
  else if (r.status >= 300 && r.status < 400) msg = 'Jira redirected to a login page. The token is missing or not accepted.';
  else if (r.status === 403 && !msg) msg = 'Jira does not allow this action for your user.';
  else if (r.status === 404 && !msg) msg = 'Jira could not find this.';
  throw new JiraError(msg || `Jira answered with status ${r.status}.`, r.status);
}
async function ensureMe() { if (!me) me = await jira('GET', 'rest/api/2/myself'); return me; }

const ISSUE_FIELDS = 'summary,status,issuetype,assignee,reporter,creator,description,comment,parent';
const KEY_RE = /[A-Za-z][A-Za-z0-9_]+-\d+/g;

function mapIssue(j) {
  const f = j.fields || {}, rf = j.renderedFields || {};
  const rc = (rf.comment && rf.comment.comments) || [];
  const comments = ((f.comment && f.comment.comments) || []).map((c, i) => ({
    id: c.id, author: (c.author && c.author.displayName) || 'Unknown', created: c.created,
    html: (rc[i] && rc[i].body != null) ? rc[i].body : null, text: c.body || ''
  }));
  return {
    key: j.key, id: j.id, summary: f.summary || '',
    type: (f.issuetype && f.issuetype.name) || '', subtask: !!(f.issuetype && f.issuetype.subtask),
    status: (f.status && f.status.name) || '',
    statusCat: (f.status && f.status.statusCategory && f.status.statusCategory.key) || '',
    assignee: f.assignee ? f.assignee.displayName : '', assigneeName: f.assignee ? (f.assignee.name || f.assignee.key || '') : '',
    author: ((f.reporter || f.creator || {}).displayName) || '',
    descHtml: rf.description ? rf.description : null, descText: f.description || '',
    comments, parentKey: f.parent ? f.parent.key : '', fetchedAt: Date.now()
  };
}
const fetchIssue = async key => mapIssue(await jira('GET', `rest/api/2/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}&expand=renderedFields`));
const ticketByKey = key => S.items.find(i => i.kind === 'ticket' && i.jira && i.jira.key === key);
const browseUrl = key => `${meta.jira.baseUrl}/browse/${encodeURIComponent(key)}`;

/* Jira returns ready-made HTML for descriptions and comments. Only harmless tags get through. */
const OK_TAGS = new Set('P BR B STRONG I EM U S DEL INS SUB SUP UL OL LI A CODE PRE TT BLOCKQUOTE H1 H2 H3 H4 H5 H6 TABLE THEAD TBODY TR TD TH HR SPAN DIV'.split(' '));
const DROP_TAGS = new Set('SCRIPT STYLE IFRAME OBJECT EMBED LINK META FORM INPUT BUTTON TEXTAREA SELECT SVG MATH NOSCRIPT TEMPLATE HEAD TITLE'.split(' '));
function absUrl(h) {
  if (!h) return '';
  try { const u = new URL(h, (meta.jira.baseUrl || 'http://invalid.invalid') + '/'); return /^(https?:|mailto:)$/.test(u.protocol) ? u.href : ''; } catch (e) { return ''; }
}
function sanitize(html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const out = document.createElement('div');
  (function walk(src, dst) {
    for (const n of Array.from(src.childNodes)) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toUpperCase();
      if (DROP_TAGS.has(tag)) continue;
      if (tag === 'IMG') { dst.appendChild(document.createTextNode(n.getAttribute('alt') || '[image]')); continue; }
      if (!OK_TAGS.has(tag)) { walk(n, dst); continue; }
      const el = document.createElement(tag.toLowerCase());
      if (tag === 'A') { const href = absUrl(n.getAttribute('href')); if (href) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); } }
      walk(n, el); dst.appendChild(el);
    }
  })(doc.body, out);
  return out.innerHTML;
}
const textToHtml = t => esc(t).replace(/\r?\n/g, '<br>');
const richHtml = (html, text) => html != null ? sanitize(html) : textToHtml(text || '');

/* create-screen metadata: Jira 9+ first, older endpoint as fallback */
async function createMeta(project, typeName) {
  const p = encodeURIComponent(project);
  try {
    const types = await jira('GET', `rest/api/2/issue/createmeta/${p}/issuetypes?maxResults=200`);
    const list = types.values || types.issueTypes || [];
    const t = list.find(x => x.name.toLowerCase() === typeName.toLowerCase());
    if (!t) throw new JiraError(`Project ${project} has no issue type "${typeName}". Available: ${list.map(x => x.name).join(', ')}.`, 400);
    const fields = []; let start = 0;
    for (let guard = 0; guard < 20; guard++) {
      const r = await jira('GET', `rest/api/2/issue/createmeta/${p}/issuetypes/${t.id}?startAt=${start}&maxResults=200`);
      const vals = r.values || r.fields || [];
      fields.push(...vals);
      if (r.isLast !== false || !vals.length) break;
      start += vals.length;
    }
    return fields.map(f => ({ id: f.fieldId || f.key, name: f.name, required: !!f.required, schema: f.schema || {}, allowed: f.allowedValues || null }));
  } catch (e) {
    if (e.status !== 404 && e.status !== 405) throw e;
  }
  const r = await jira('GET', `rest/api/2/issue/createmeta?projectKeys=${p}&issuetypeNames=${encodeURIComponent(typeName)}&expand=projects.issuetypes.fields`);
  const it = r.projects && r.projects[0] && r.projects[0].issuetypes && r.projects[0].issuetypes[0];
  if (!it) throw new JiraError(`Jira returned no create screen for ${project} / ${typeName}. Check the project key and the issue type name.`, 404);
  return Object.entries(it.fields || {}).map(([id, f]) => ({ id, name: f.name, required: !!f.required, schema: f.schema || {}, allowed: f.allowedValues || null }));
}
function kindFromSchema(s) {
  s = s || {};
  if (s.system === 'labels' || (s.type === 'array' && s.items === 'string')) return 'labels';
  if (s.type === 'array') return s.items === 'option' ? 'multi-option' : 'multi-name';
  if (s.type === 'option') return 'single-option';
  if (['priority', 'version', 'component', 'resolution', 'securitylevel'].includes(s.type)) return 'single-name';
  if (s.type === 'number') return 'number';
  if (s.type === 'date') return 'date';
  if (s.type === 'user') return 'user';
  return 'text';
}
const KINDS = {
  'multi-name': 'Pick several, by name (components, versions)',
  'single-name': 'Pick one, by name (priority, version)',
  'multi-option': 'Pick several, custom field (checkboxes, multi-select)',
  'single-option': 'Pick one, custom field (dropdown, radio)',
  'labels': 'Labels', 'text': 'Text', 'number': 'Number', 'date': 'Date', 'user': 'User name'
};
const isMulti = k => k === 'multi-name' || k === 'multi-option' || k === 'labels';
function fieldPayload(f, v) {
  switch (f.kind) {
    case 'multi-name': return v.map(name => ({ name }));
    case 'multi-option': return v.map(value => ({ value }));
    case 'labels': return v;
    case 'single-name': return { name: v };
    case 'single-option': return { value: v };
    case 'number': return Number(v);
    case 'user': return { name: v };
    default: return v;
  }
}
const splitList = s => String(s || '').split(/[\n,]/).map(x => x.trim()).filter(Boolean);
