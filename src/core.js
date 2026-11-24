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
function defaultForm() {
  return {
    id: 'form_' + uid(), name: '', project: '', type: 'Task', assignToMe: true,
    fields: [{ uid: 'f_components', label: 'Components', fieldId: 'components', kind: 'multi-name', values: [], required: true, def: [] }]
  };
}
function defaults() {
  return {
    v: 2, rev: 0, items: [],
    game: { xp: 0, log: [], streak: { count: 0, last: null, best: 0 }, counts: {}, days: {}, badges: {} },
    settings: {
      sound: true, motion: true, theme: 'auto', sort: 'prio', dayRemindTime: '09:00', refreshMin: 15, updateCheck: true,
      timeAuto: true, timeAsk: true, timeAskTypes: [], timeAskSubs: true, timeJira: false,
      jql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
    },
    // forms: one per kind of ticket you create (Jira project + ticket type + its fields). Templates belong to a form.
    ticketCfg: { forms: [], defaultForm: '', templates: [] },
    // working time. open: the running period { start }. beat: last moment the page was alive while tracking.
    // spans: finished periods { id, day, s, e } in minutes of that day. ticket: running ticket timer { itemId, start }.
    // log: time booked on tickets { id, itemId, key, summary, day, min, note, at, wl }.
    time: { open: null, beat: 0, autoFor: '', spans: [], ticket: null, log: [] }
  };
}
function merge(def, obj) {
  if (Array.isArray(def) || def === null || typeof def !== 'object') return obj === undefined || obj === null ? def : obj;
  const out = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  for (const k in def) out[k] = merge(def[k], out[k]);
  return out;
}

/* Brings a data file written by an older version up to date. Runs before merge(). */
function upgrade(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const c = raw.ticketCfg;
  if (c && typeof c === 'object' && !Array.isArray(c.forms)) {
    // version 1 had one project, a list of ticket types and one field list shared by all types
    const types = (Array.isArray(c.types) && c.types.length) ? c.types : ['Task'];
    const flds = Array.isArray(c.fields) ? c.fields : [];
    const forType = t => flds.filter(f => !f.types || !f.types.length || f.types.some(x => String(x).toLowerCase() === t.toLowerCase())).map(f => { const o = clone(f); delete o.types; return o; });
    const mk = (project, type) => ({ id: 'form_' + uid(), name: '', project: project || '', type, assignToMe: c.assignToMe !== false, fields: forType(type) });
    c.forms = types.map(t => mk(c.project, t));
    const def = c.forms.find(f => f.type === c.defaultType) || c.forms[0];
    c.defaultForm = def.id;
    for (const t of (Array.isArray(c.templates) ? c.templates : [])) {
      const p = t.project || c.project || '', ty = t.type || def.type;
      let f = c.forms.find(x => x.type === ty && x.project === p);
      if (!f) { f = mk(p, ty); c.forms.push(f); }
      t.formId = f.id; delete t.project; delete t.type;
    }
    for (const k of ['project', 'types', 'defaultType', 'fields', 'assignToMe']) delete c[k];
  }
  if (raw.settings) delete raw.settings.dailyGoal;
  raw.v = 2;
  return raw;
}
/* After loading or restoring: guarantees the shape the rest of the code relies on. */
function normalize() {
  for (const it of S.items) { if (!it.steps) it.steps = []; if (!it.prio) it.prio = 2; }
  const c = S.ticketCfg;
  c.forms = c.forms.filter(f => f && typeof f === 'object');
  if (!c.forms.length) c.forms.push(defaultForm());
  for (const f of c.forms) { if (!f.id) f.id = 'form_' + uid(); if (!f.type) f.type = 'Task'; if (!Array.isArray(f.fields)) f.fields = []; f.project = f.project || ''; f.name = f.name || ''; }
  if (!c.forms.some(f => f.id === c.defaultForm)) c.defaultForm = c.forms[0].id;
  c.templates = c.templates.filter(t => c.forms.some(f => f.id === t.formId));
  // today's statistics for data written before they were counted per day
  const d = S.game.days[today()];
  if (d && !d.n) { d.n = {}; for (const e of S.game.log) if (dstr(new Date(e.t)) === today()) d.n[e.type] = (d.n[e.type] || 0) + 1; }
}
const formById = id => S.ticketCfg.forms.find(f => f.id === id);
const defForm = () => formById(S.ticketCfg.defaultForm) || S.ticketCfg.forms[0];
const formLabel = f => f.name || (f.project ? `${f.type} in ${f.project}` : f.type);

let S = defaults();
let meta = { version: '', awakeSince: '', autostart: false, jira: { baseUrl: '', hasToken: false } };
let UPD = null;               // answer of the last update check (from the helper)
let me = null;                // Jira user (from /myself)
let loadFailed = false;
let helperDown = false;
let saveTimer = null;
let saveLoud = false;         // false while only the time heartbeat changed: other tabs need no reload for that
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

function save(o) {
  if (loadFailed) return;
  if (!(o && o.quiet)) saveLoud = true;
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
    if (bc && saveLoud) bc.postMessage({ rev: S.rev });
    saveLoud = false;
  } catch (e) {
    if (!helperDown) { helperDown = true; renderRailFoot(); toast('The FocusQuest helper is not running. Changes stay in this browser until you start it again.', { kind: 'bad', ttl: 9000 }); }
    saveTimer = setTimeout(flush, 8000);
  }
}

async function loadState() {
  let raw = null;
  if (SERVED) {
    meta = await api('GET', '/api/state');
    if (!meta.version) meta.version = '';
    const r = await fetch('/api/data', { headers: { 'X-FQ-Token': TOKEN } });
    const t = await r.text();
    if (!r.ok) throw new Error('The data file could not be read.');
    raw = JSON.parse(t);            // throws on a damaged file: we then refuse to overwrite it
  } else {
    try { raw = JSON.parse(localStorage.getItem('focusquest') || 'null'); } catch (e) { raw = null; }
  }
  S = merge(defaults(), upgrade(raw) || {});
  normalize();
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

/* ------------------------------------------------------------------ working time */
const GAP = 3 * 60000;        // no sign of life for this long while tracking: the page was asleep, closed or the PC was off
const hm = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const toMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim()); return m && +m[1] <= 24 && +m[2] < 60 ? Math.min(1440, +m[1] * 60 + +m[2]) : null; };
const minOfDay = d => d.getHours() * 60 + d.getMinutes();
function fmtDur(min) {
  min = Math.max(0, Math.round(min || 0));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
/* "45", "45m", "1:30", "1h 30", "1.5h", "1,5 std" -> minutes. A bare whole number means minutes. */
function parseDur(s) {
  s = String(s || '').trim().toLowerCase().replace(',', '.'); let m;
  if (!s) return null;
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return +m[1] * 60 + +m[2];
  if ((m = /^(\d+)\s*(?:h|std)[a-z]*\.?\s*(\d+)\s*(?:m[a-z]*\.?)?$/.exec(s))) return +m[1] * 60 + +m[2];
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|std)[a-z]*\.?$/.exec(s))) return Math.round(+m[1] * 60);
  if ((m = /^(\d+)\s*(?:m[a-z]*\.?)?$/.exec(s))) return +m[1];
  if ((m = /^(\d+\.\d+)$/.exec(s))) return Math.round(+m[1] * 60);
  return null;
}
/* stores a finished period in whole minutes, split at midnight */
function addSpans(startTs, endTs) {
  let a = new Date(startTs); const b = new Date(endTs);
  for (let guard = 0; guard < 60 && a < b; guard++) {
    const day = dstr(a), last = dstr(b) === day;
    const s = minOfDay(a), e = last ? minOfDay(b) : 1440;
    if (e > s) S.time.spans.push({ id: uid(), day, s, e });
    if (last) break;
    a = addDays(parseD(day), 1);
  }
}
function timeStart(at) {
  const T = S.time; if (T.open) return;
  T.open = { start: at || Date.now() }; T.beat = Date.now();
}
function timeStop(at) {
  const T = S.time; if (!T.open) return;
  const end = at || Date.now();
  if (T.ticket) ticketTimerStop(end);
  addSpans(T.open.start, end);
  T.open = null;
}
/* minutes worked on a day, the running period included */
function workedOn(day) {
  let n = 0;
  for (const p of S.time.spans) if (p.day === day) n += p.e - p.s;
  const o = S.time.open;
  if (o) {
    const d0 = parseD(day).getTime(), a = Math.max(o.start, d0), b = Math.min(Date.now(), d0 + 86400000);
    if (b > a) n += Math.floor((b - a) / 60000);
  }
  return n;
}
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));
function workedInWeek(monday) { let n = 0; for (let i = 0; i < 7; i++) n += workedOn(dstr(addDays(monday, i))); return n; }

/* time booked on tickets */
const ticketLogOf = key => S.time.log.filter(e => e.key === key);
const ticketMinutes = key => ticketLogOf(key).reduce((n, e) => n + e.min, 0);
function jiraStamp(d) {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${dstr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}${pad(a % 60)}`;
}
function logTicketTime(it, min, note, toJira) {
  const e = { id: uid(), itemId: it.id, key: it.jira.key, summary: it.jira.summary, day: today(), min, note: note || '', at: Date.now(), wl: null };
  S.time.log.push(e);
  if (toJira && jiraReady()) {
    const body = { timeSpentSeconds: min * 60, started: jiraStamp(new Date(Date.now() - min * 60000)) };
    if (note) body.comment = note;
    jira('POST', `rest/api/2/issue/${encodeURIComponent(e.key)}/worklog`, body)
      .then(r => { e.wl = (r && r.id) || 'yes'; save(); })
      .catch(err => toast(`The time is kept in FocusQuest, but Jira did not take the work log for ${e.key}: ${err.message}`, { kind: 'bad', ttl: 9000 }));
  }
  return e;
}
function ticketTimerStart(it) {
  if (S.time.ticket) ticketTimerStop();
  if (!S.time.open) timeStart();
  S.time.ticket = { itemId: it.id, start: Date.now() };
}
/* ends the ticket timer and books what it measured. Returns the minutes. */
function ticketTimerStop(at, book = true) {
  const t = S.time.ticket; if (!t) return 0;
  S.time.ticket = null;
  const min = Math.round(((at || Date.now()) - t.start) / 60000), it = S.items.find(i => i.id === t.itemId);
  if (book && min >= 1 && it && it.jira) logTicketTime(it, min, '', S.settings.timeJira);
  return min;
}

/* When did this PC session begin? The helper notices restarts and sleep; without it, the browser session counts. */
let awakeCache = null, lastSync = 0;
async function awakeSince(fresh) {
  if (!SERVED) {
    let t = null; try { t = +sessionStorage.getItem('fq-t0') || null; if (!t) { t = Date.now(); sessionStorage.setItem('fq-t0', String(t)); } } catch (e) { t = null; }
    return t || (awakeCache = awakeCache || Date.now());
  }
  if (!fresh && awakeCache) return awakeCache;
  try { const st = await api('GET', '/api/state'); const t = new Date(st.awakeSince).getTime(); awakeCache = isNaN(t) ? null : t; return awakeCache; }
  catch (e) { return null; }
}
/* Runs at the start and every few seconds: keeps the running period alive, ends it after the PC was off or asleep,
   and starts a new one when a new PC session began (if that is switched on). */
async function timeSync() {
  const T = S.time, now = Date.now();
  const slept = !!lastSync && now - lastSync > GAP;         // this page was frozen or the PC slept
  const first = !lastSync;
  lastSync = now;
  let changed = false, loud = false;
  const gap = !!(T.open && T.beat && now - T.beat > GAP);
  let awake = (gap || slept || first) ? await awakeSince(true) : await awakeSince(false);
  if (awake === null) return;                               // helper not reachable: decide at the next round
  if (gap && (!SERVED || awake > T.beat)) { timeStop(T.beat); changed = loud = true; }
  if (T.open) { if (gap || now - T.beat >= 55000) { T.beat = now; changed = true; } }
  else if (S.settings.timeAuto && T.autoFor !== String(awake)) {
    T.autoFor = String(awake);
    timeStart(Math.min(now, Math.max(awake, T.beat || 0)));
    changed = loud = true;
  }
  if (changed) { save(loud ? undefined : { quiet: true }); renderClock(); }
}

/* ------------------------------------------------------------------ game */
const XP = { todoCreate: 5, step: 5, todoDone: { 1: 40, 2: 30, 3: 20 }, onTime: 10, import: 5, ticketCreate: 40, comment: 20, transition: 15, ticketClose: 120, ticketClosedElsewhere: 60 };
const TITLES = ['Fresh start', 'Getting going', 'List wrangler', 'Ticket tamer', 'Flow finder', 'Backlog breaker', 'Sprint ranger', 'Queue commander', 'Master closer', 'Board legend'];
const needXp = l => 50 * l * (l - 1);                 // total XP needed to reach level l
function levelOf(xp) { let l = 1; while (xp >= needXp(l + 1)) l++; return l; }
const titleOf = l => TITLES[Math.min(l, TITLES.length) - 1];
function dayRec(d = today()) { return S.game.days[d] || (S.game.days[d] = { xp: 0, done: 0, n: {} }); }
/* statistics from a set of counters (one day's, or all time): to-dos and tickets together */
function statsOf(n) {
  const g = k => (n && n[k]) || 0;
  return { created: g('todoCreate') + g('ticketCreate'), closed: g('todoDone') + g('ticketClose') + g('ticketClosedElsewhere'), comments: g('comment') };
}
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
  const day = dayRec();
  S.game.xp += xp; day.xp += xp;
  S.game.counts[type] = (S.game.counts[type] || 0) + 1;
  if (!day.n) day.n = {};
  day.n[type] = (day.n[type] || 0) + 1;
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
  const d = S.game.days[day || today()];
  if (d) { d.xp = Math.max(0, d.xp - xp); if (type && d.n && d.n[type]) d.n[type]--; }
  renderPlayer();
}
/* something got finished: day count + streak */
function bumpDone() {
  const t = today(), d = dayRec(t), s = S.game.streak;
  d.done++;
  if (s.last !== t) {
    s.count = (s.last && onlyWeekendBetween(s.last, t)) ? s.count + 1 : 1;
    s.last = t; s.best = Math.max(s.best || 0, s.count);
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

const ISSUE_FIELDS = 'summary,status,issuetype,assignee,reporter,creator,description,comment,parent,subtasks';
const KEY_RE = /[A-Za-z][A-Za-z0-9_]+-\d+/g;

/* a sub-ticket as the parent lists it. rel: 'sub' for a sub-task, 'epic' for a ticket inside an epic */
function mapKid(x, rel) {
  const f = x.fields || {};
  return {
    key: x.key, summary: f.summary || '', type: (f.issuetype && f.issuetype.name) || '', status: (f.status && f.status.name) || '',
    statusCat: (f.status && f.status.statusCategory && f.status.statusCategory.key) || '', rel
  };
}
const kids = j => (j && j.children) || [];
const openKids = j => kids(j).filter(k => k.statusCat !== 'done');
const isEpicType = t => /^(epic|epos)$/i.test(String(t || '').trim());
function mapIssue(j) {
  const f = j.fields || {}, rf = j.renderedFields || {};
  const pf = (f.parent && f.parent.fields) || {};
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
    comments, parentKey: f.parent ? f.parent.key : '', parentType: (pf.issuetype && pf.issuetype.name) || '', parentSummary: pf.summary || '',
    children: (f.subtasks || []).map(x => mapKid(x, 'sub')), fetchedAt: Date.now()
  };
}
/* the tickets that belong to an epic. Jira Data Center links them with the "Epic Link" field, newer versions with parent. */
async function epicChildren(key) {
  const run = jql => jira('POST', 'rest/api/2/search', { jql, fields: ['summary', 'status', 'issuetype'], maxResults: 200 });
  let r;
  try { r = await run(`"Epic Link" = ${key} ORDER BY key`); }
  catch (e) { if (e.status !== 400) throw e; r = await run(`parent = ${key} ORDER BY key`); }
  return (r.issues || []).map(x => mapKid(x, 'epic'));
}
async function fetchIssue(key) {
  const j = mapIssue(await jira('GET', `rest/api/2/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS}&expand=renderedFields`));
  if (isEpicType(j.type)) {
    try { j.children = j.children.concat(await epicChildren(j.key)); }
    catch (e) { j.kidsError = e.message; }
  }
  return j;
}
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

/* the ticket types a project offers */
async function projectTypes(project) {
  const p = encodeURIComponent(project);
  try {
    const r = await jira('GET', `rest/api/2/issue/createmeta/${p}/issuetypes?maxResults=200`);
    return (r.values || r.issueTypes || []).map(x => ({ name: x.name, subtask: !!x.subtask }));
  } catch (e) { if (e.status !== 404 && e.status !== 405) throw e; }
  const r = await jira('GET', `rest/api/2/project/${p}`);
  return (r.issueTypes || []).map(x => ({ name: x.name, subtask: !!x.subtask }));
}
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
