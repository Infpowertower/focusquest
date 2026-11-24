/* ------------------------------------------------------------------ UI state */
const UI = { view: 'board', tab: 'open', sel: null, drawerFor: null, planOpen: false, skipped: new Set(), capPrio: 2, tr: {}, refreshing: false, lastRefreshAll: Date.now(), day: today() };
let TF = null;       // ticket form state
let TRX = null;      // transition dialog state

const itemTitle = it => it.kind === 'ticket' && it.jira ? (it.jira.summary || it.jira.key) : it.title;
const openItems = () => S.items.filter(i => !i.done);
const byId = id => S.items.find(i => i.id === id);
const cmpPrio = (a, b) => (a.prio - b.prio) || ((dueTs(a) || Infinity) - (dueTs(b) || Infinity)) || (a.createdAt - b.createdAt);
const cmpDue = (a, b) => ((dueTs(a) || Infinity) - (dueTs(b) || Infinity)) || (a.prio - b.prio) || (a.createdAt - b.createdAt);

function applyTheme() {
  const t = S.settings.theme;
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
}

/* ------------------------------------------------------------------ rail */
function renderPlayer(bump) {
  const g = S.game, l = levelOf(g.xp), a = needXp(l), b = needXp(l + 1), pct = Math.round((g.xp - a) / (b - a) * 100);
  const d = dayRec(), goal = Math.max(1, S.settings.dailyGoal), st = streakNow();
  const box = $('#player');
  if (!$('#p-lvl')) {
    box.innerHTML = `<div class="player">
        <div class="lvl"><b id="p-lvl"></b><span>Level</span></div>
        <div class="lvl-title" id="p-title"></div>
        <div class="xpbar" role="progressbar" aria-label="Progress to the next level" aria-valuemin="0" aria-valuemax="100" id="p-bar"><i></i></div>
        <div class="xpnum"><span id="p-xp"></span><span id="p-next"></span></div>
      </div>
      <div class="duo" style="margin-top:10px">
        <div class="stat"><b id="p-done"></b><span>done today</span><div class="goal-dots" id="p-dots"></div></div>
        <div class="stat"><b id="p-streak"></b><span>workday streak</span></div>
      </div>`;
  }
  $('#p-lvl').textContent = l;
  $('#p-title').textContent = titleOf(l);
  $('#p-bar').setAttribute('aria-valuenow', pct);
  $('#p-bar i').style.width = pct + '%';
  $('#p-xp').textContent = `${g.xp} XP`;
  $('#p-next').textContent = `${b - g.xp} to level ${l + 1}`;
  $('#p-done').textContent = `${d.done} of ${goal}`;
  $('#p-dots').innerHTML = Array.from({ length: Math.min(goal, 12) }, (_, i) => `<i class="${i < d.done ? 'on' : ''}"></i>`).join('');
  $('#p-streak').textContent = st + (st > 0 ? ' 🔥' : '');
  if (bump && motionOk()) { const x = $('#p-xp'); x.classList.remove('bump'); void x.offsetWidth; x.classList.add('bump'); }
}
function renderRailFoot() {
  let h = '';
  if (WEB) h = `<span>Browser version. Jira is off and data stays in this browser.</span>`;
  else if (!SERVED) h = `<span>Running without the helper. Jira is off and data stays in this browser.</span>`;
  else if (helperDown) h = `<button class="conn bad" data-act="view" data-view="settings"><i></i>Helper not running. Start FocusQuest again.</button>`;
  else if (jiraReady()) h = `<button class="conn ok" data-act="view" data-view="settings"><i></i>Jira connected${me ? ' as ' + esc(me.displayName || me.name) : ''}</button>`;
  else h = `<button class="conn" data-act="view" data-view="settings"><i></i>Jira not connected. Set it up</button>`;
  $('#railfoot').innerHTML = h;
}
function renderNav() { $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === UI.view)); }

/* ------------------------------------------------------------------ board */
function renderMain() {
  renderNav();
  if (UI.view === 'rewards') renderRewards();
  else if (UI.view === 'settings') renderSettings();
  else renderBoard();
}
function renderBoard() {
  $('#main').innerHTML = `
    ${!SERVED && !WEB ? `<div class="banner">You opened app.html directly. To-dos, reminders and rewards work and are kept in this browser. For Jira and for a data file on disk, start FocusQuest with Start-FocusQuest.cmd.</div>` : ''}
    <form class="capture" id="capture" autocomplete="off">
      <input type="text" id="q" placeholder="What needs doing? Type it and press Enter" aria-label="New to-do">
      <button type="button" class="pp p${UI.capPrio}" data-act="cap-prio" title="Priority for the new to-do. Click to change.">${PRIO[UI.capPrio]}</button>
      <button class="btn primary">Add</button>
    </form>
    <div class="hint" id="qhint"></div>
    <section id="now" aria-label="Next thing to do"></section>
    <div class="toolbar">
      <div class="tabs" id="tabs"></div>
      <div class="row wrap">
        <select data-ch="sort" style="width:auto" aria-label="Group the list">
          <option value="prio" ${S.settings.sort === 'prio' ? 'selected' : ''}>Group by priority</option>
          <option value="due" ${S.settings.sort === 'due' ? 'selected' : ''}>Group by due date</option>
        </select>
        <button class="btn" data-act="import">Import tickets</button>
        <button class="btn" data-act="new-ticket">New ticket</button>
        <button class="btn" data-act="refresh-all" id="refall" title="Fetch the latest state of all open tickets from Jira">Refresh tickets</button>
      </div>
    </div>
    <div id="list"></div>`;
  renderHint(); refreshBoard();
}
function renderHint() {
  const q = $('#q'), h = $('#qhint'); if (!q || !h) return;
  const v = q.value.trim();
  if (!v) { h.innerHTML = 'While typing: <b>!1 !2 !3</b> sets the priority, <b>@today @tomorrow @fri @24.12. @14:30</b> sets the due date.'; return; }
  const p = parseQuick(v), bits = [];
  bits.push(PRIO[p.prio || UI.capPrio].toLowerCase() + ' priority');
  if (p.due) bits.push(dueInfo({ due: p.due, dueTime: p.time }).text.toLowerCase());
  h.innerHTML = p.title ? `Adds <b>${esc(p.title)}</b> with ${esc(bits.join(', '))}.` : 'Add a few words for the title.';
}
function refreshBoard() {
  updateTitle();
  if (UI.view !== 'board') return;
  renderNow(); renderList();
}
function updateTitle() {
  const t = today(), n = openItems().filter(i => i.due && i.due <= t).length;
  document.title = (n ? `(${n}) ` : '') + 'FocusQuest';
}

function statusPill(j) { return `<span class="st ${j.statusCat === 'done' ? 'done' : j.statusCat === 'new' ? 'new' : ''}">${esc(j.status)}</span>`; }
function metaHtml(it) {
  const out = [];
  if (it.kind === 'ticket' && it.jira) {
    const j = it.jira;
    out.push(`<span class="key">${esc(j.key)}</span>`);
    if (j.type) out.push(`<span class="tag">${esc(j.type)}</span>`);
    out.push(statusPill(j));
    if (it.fresh) out.push(`<span class="fresh">New activity</span>`);
    if (j.error) out.push(`<span class="due over">Refresh failed</span>`);
  }
  const di = !it.done && dueInfo(it);
  if (di) out.push(`<span class="due ${di.cls}">${esc(di.text)}</span>`);
  if (!it.done && it.remind && new Date(it.remind) > new Date()) out.push(`<span>Reminder ${esc(fmtWhen(it.remind))}</span>`);
  if (it.kind === 'todo' && it.steps.length) out.push(`<span>${it.steps.filter(s => s.done).length} of ${it.steps.length} steps</span>`);
  if (it.done && it.doneAt) out.push(`<span>Finished ${esc(relTime(it.doneAt))}</span>`);
  return out.join('');
}

function nowItem() {
  const t = today(), urgent = i => (i.due && i.due <= t) ? 0 : 1;
  const c = openItems().sort((a, b) => ((b.focus ? 1 : 0) - (a.focus ? 1 : 0)) || (urgent(a) - urgent(b)) || cmpPrio(a, b));
  if (!c.length) return null;
  let pick = c.find(i => !UI.skipped.has(i.id));
  if (!pick) { UI.skipped.clear(); pick = c[0]; }
  return pick;
}
function renderNow() {
  const box = $('#now'); if (!box) return;
  const it = nowItem(), n = openItems().length;
  if (!it) {
    box.innerHTML = `<div class="now empty"><h2>All clear</h2><p class="lead">Nothing is waiting. Add a to-do above, or import your Jira tickets.</p></div>`;
    return;
  }
  const tk = it.kind === 'ticket';
  box.innerHTML = `<div class="now p${it.prio}" data-id="${it.id}">
      <div class="now-kicker">${it.focus ? 'Your focus' : 'Up next'}${n > 1 ? `, ${n - 1} more waiting` : ''}</div>
      <h2>${esc(itemTitle(it))}</h2>
      <div class="meta">${metaHtml(it)}</div>
      <div class="now-actions">
        ${tk ? `<button class="btn done big" data-act="close-ticket">Close ticket</button>` : `<button class="btn done big" data-act="toggle">Done</button>`}
        <button class="btn" data-act="open">Details</button>
        ${n > 1 ? `<button class="btn quiet" data-act="now-skip">Not now</button>` : ''}
      </div>
    </div>`;
}

function itemHtml(it) {
  const tk = it.kind === 'ticket';
  const lab = it.done ? (tk ? 'Closed' : 'Mark as not done') : (tk ? 'Close ticket' : 'Mark as done');
  return `<li class="item p${it.prio}${it.done ? ' done' : ''}${UI.sel === it.id ? ' sel' : ''}" data-id="${it.id}">
      <button class="check${tk ? ' tk' : ''}" data-act="toggle" aria-label="${lab}: ${esc(itemTitle(it))}" title="${lab}"></button>
      <button class="ibody" data-act="open"><span class="title">${esc(itemTitle(it))}</span><span class="meta">${metaHtml(it)}</span></button>
      ${it.done ? '' : `<button class="pp p${it.prio}" data-act="cycle-prio" title="Priority. Click to change.">${PRIO[it.prio]}</button>
      <button class="star${it.focus ? ' on' : ''}" data-act="focus" title="${it.focus ? 'Remove focus' : 'Make this my focus'}" aria-label="${it.focus ? 'Remove focus' : 'Make this my focus'}" aria-pressed="${!!it.focus}">★</button>`}
    </li>`;
}
function renderList() {
  const box = $('#list'); if (!box) return;
  const open = openItems(), done = S.items.filter(i => i.done);
  const counts = { open: open.length, todo: open.filter(i => i.kind === 'todo').length, ticket: open.filter(i => i.kind === 'ticket').length, done: done.length };
  const names = { open: 'Open', todo: 'To-dos', ticket: 'Tickets', done: 'Done' };
  $('#tabs').innerHTML = Object.keys(names).map(k => `<button data-act="tab" data-tab="${k}" class="${UI.tab === k ? 'on' : ''}">${names[k]}<span>${counts[k]}</span></button>`).join('');

  let html = '';
  if (UI.tab === 'done') {
    const list = done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 100);
    html = list.length ? `<ul class="items" style="margin-top:14px">${list.map(itemHtml).join('')}</ul>
      <p class="help" style="margin-top:14px"><button class="chip" data-act="clear-done">Remove finished items from the list</button> Your XP stays.</p>`
      : `<p class="empty-note">Nothing finished yet. The first one is the hardest.</p>`;
  } else {
    const items = UI.tab === 'open' ? open : open.filter(i => i.kind === UI.tab);
    if (!items.length) {
      html = `<p class="empty-note">${UI.tab === 'ticket' ? 'No tickets here yet. Use Import tickets to bring them in from Jira.' : UI.tab === 'todo' ? 'No open to-dos. Type one in the box at the top.' : 'Nothing open.'}</p>`;
    } else {
      const groups = [];
      if (S.settings.sort === 'due') {
        const t = today(), tm = dstr(addDays(new Date(), 1)), wk = dstr(addDays(new Date(), 7));
        const b = { 'Overdue': [], 'Today': [], 'Tomorrow': [], 'Next 7 days': [], 'Later': [], 'No due date': [] };
        for (const i of items) (!i.due ? b['No due date'] : i.due < t ? b['Overdue'] : i.due === t ? b['Today'] : i.due === tm ? b['Tomorrow'] : i.due <= wk ? b['Next 7 days'] : b['Later']).push(i);
        for (const k in b) if (b[k].length) groups.push([k, b[k].sort(cmpDue)]);
      } else {
        for (const p of [1, 2, 3]) { const g = items.filter(i => i.prio === p).sort(cmpPrio); if (g.length) groups.push([PRIO[p] + ' priority', g]); }
      }
      html = groups.map(([name, g]) => `<h3 class="group-h">${name}<small>${g.length}</small></h3><ul class="items">${g.map(itemHtml).join('')}</ul>`).join('');
    }
  }
  box.innerHTML = html;
}

/* ------------------------------------------------------------------ to-do actions */
function addTodo(text) {
  const p = parseQuick(text);
  if (!p.title) return false;
  const it = { id: uid(), kind: 'todo', title: p.title, notes: '', prio: p.prio || UI.capPrio, due: p.due, dueTime: p.time, remind: null, remFired: null, steps: [], done: false, doneAt: null, createdAt: Date.now(), focus: false };
  touchReminder(it);
  S.items.push(it);
  award('todoCreate', XP.todoCreate, 'Captured: ' + it.title);
  sound('add'); save();
  if (UI.tab === 'ticket' || UI.tab === 'done') UI.tab = 'open';
  refreshBoard();
  return true;
}
function completeTodo(it, el) {
  if (el && el.classList.contains('check')) el.classList.add('pop');
  const onTime = it.due && dueTs(it) >= Date.now();
  it.done = true; it.doneAt = Date.now(); it.doneDay = today(); it.focus = false;
  confetti(28, el); sound('done');
  it.awarded = award('todoDone', XP.todoDone[it.prio] + (onTime ? XP.onTime : 0), 'Done: ' + it.title);
  bumpDone(); save(); renderPlayer();
  setTimeout(() => { refreshBoard(); if (UI.sel === it.id) renderDrawer(); }, motionOk() ? 380 : 0);
}
function uncompleteTodo(it) {
  it.done = false; it.doneAt = null;
  if (it.awarded) takeXp(it.awarded, 'todoDone', it.doneDay);
  const d = S.game.days[it.doneDay]; if (d && d.done > 0) d.done--;
  it.awarded = 0; touchReminder(it);
  save(); renderPlayer(); refreshBoard(); if (UI.sel === it.id) renderDrawer();
}
function deleteItem(it) {
  const idx = S.items.indexOf(it); if (idx < 0) return;
  S.items.splice(idx, 1);
  if (UI.sel === it.id) closeDrawer();
  save(); refreshBoard();
  toast(it.kind === 'ticket' ? `${it.jira.key} removed from FocusQuest. It is unchanged in Jira.` : 'To-do deleted.', { ttl: 7000, actions: [{ label: 'Undo', fn: () => { S.items.splice(idx, 0, it); save(); refreshBoard(); } }] });
}

/* ------------------------------------------------------------------ drawer */
function openItem(id) {
  const it = byId(id); if (!it) return;
  if (UI.view !== 'board') { UI.view = 'board'; renderMain(); }
  UI.sel = id; UI.planOpen = false;
  if (it.fresh) { it.fresh = false; save(); }
  renderDrawer(); renderList();
  if (it.kind === 'ticket' && !it.done) loadTransitions(it);
}
function closeDrawer() {
  UI.sel = null; UI.drawerFor = null;
  $('#drawer').hidden = true; $('#drawer').innerHTML = '';
  $('#app').classList.remove('with-drawer');
  renderList();
}
function renderDrawer() {
  const d = $('#drawer'), it = byId(UI.sel);
  if (!it) { if (!d.hidden) closeDrawer(); return; }
  const same = UI.drawerFor === it.id, cm = $('#cmt');
  const keep = same ? { cmt: cm ? cm.value : '', focus: document.activeElement === cm, top: d.scrollTop } : null;
  d.hidden = false; $('#app').classList.add('with-drawer');
  d.innerHTML = `<div data-id="${it.id}">${it.kind === 'ticket' ? ticketDrawer(it) : todoDrawer(it)}</div>`;
  UI.drawerFor = it.id;
  if (keep) {
    const c2 = $('#cmt'); if (c2 && keep.cmt) { c2.value = keep.cmt; if (keep.focus) c2.focus(); }
    d.scrollTop = keep.top;
  } else d.scrollTop = 0;
}
function planHtml(it) {
  const note = it.remind ? '' : it.due ? `No separate reminder set: you get one on the due day at ${esc(it.dueTime || S.settings.dayRemindTime)}.` : 'Set a due date or a reminder to get a notification.';
  return `
    <label class="f">Priority</label>
    <div class="seg" role="group" aria-label="Priority">${[1, 2, 3].map(p => `<button data-act="set-prio" data-p="${p}" class="${it.prio === p ? 'on' : ''}" aria-pressed="${it.prio === p}">${PRIO[p]}</button>`).join('')}</div>
    <label class="f" for="d-due">Due</label>
    <div class="row"><input type="date" id="d-due" data-ch="due" value="${esc(it.due || '')}"><input type="time" data-ch="dueTime" value="${esc(it.dueTime || '')}" aria-label="Due time" style="max-width:130px"></div>
    <div class="chips">
      <button class="chip" data-act="due-q" data-q="0">Today</button><button class="chip" data-act="due-q" data-q="1">Tomorrow</button><button class="chip" data-act="due-q" data-q="mon">Next Monday</button>
      ${it.due ? `<button class="chip" data-act="due-q" data-q="clear">No due date</button>` : ''}
    </div>
    <label class="f" for="d-rem">Reminder</label>
    <input type="datetime-local" id="d-rem" data-ch="remind" value="${esc(it.remind || '')}">
    <div class="chips">
      <button class="chip" data-act="rem-q" data-q="30">In 30 min</button><button class="chip" data-act="rem-q" data-q="60">In 1 hour</button><button class="chip" data-act="rem-q" data-q="tom">Tomorrow 09:00</button>
      ${it.remind ? `<button class="chip" data-act="rem-q" data-q="clear">No reminder</button>` : ''}
    </div>
    <p class="help">${note}</p>`;
}
function todoDrawer(it) {
  return `
    <div class="dhead"><span class="meta">To-do${it.done ? ', finished' : ''}</span><button class="x" data-act="close-drawer" aria-label="Close details">×</button></div>
    <textarea class="dtitle" data-ch="title" rows="2" aria-label="Title">${esc(it.title)}</textarea>
    ${planHtml(it)}
    <label class="f" for="step-new">Steps <small>break it into small pieces, each one earns XP</small></label>
    <ul class="steps">${it.steps.map(s => `<li class="${s.done ? 'done' : ''}" data-step="${s.id}"><input type="checkbox" data-ch="step" ${s.done ? 'checked' : ''} aria-label="${esc(s.text)}"><span>${esc(s.text)}</span><button class="x" data-act="step-del" aria-label="Remove step" style="font-size:18px">×</button></li>`).join('')}</ul>
    <input type="text" id="step-new" placeholder="Add a step and press Enter">
    <label class="f" for="d-notes">Notes</label>
    <textarea id="d-notes" data-ch="notes" rows="5">${esc(it.notes || '')}</textarea>
    <div class="dfoot">
      ${it.done ? '' : `<button class="btn primary" data-act="to-ticket">Create Jira ticket from this</button>`}
      <button class="btn quiet danger" data-act="del">Delete</button>
    </div>`;
}
function trHtml(it) {
  const j = it.jira, tr = UI.tr[j.key];
  if (j.statusCat === 'done') return `<p class="okmsg">This ticket is closed.</p>`;
  if (!jiraReady()) return `<p class="help">Connect Jira in Settings to comment on or close this ticket.</p>`;
  if (!tr) return `<p class="help"><span class="spin"></span>Loading the available actions</p>`;
  if (tr.error) return `<p class="err">${esc(tr.error)}</p>`;
  const btns = tr.list.map(t => `<button class="btn ${t.done ? 'done' : ''}" data-act="transition" data-tr="${esc(t.id)}">${esc(t.name)}</button>`);
  if (me && j.assigneeName !== me.name) btns.push(`<button class="btn" data-act="assign-me">Assign to me</button>`);
  return `<div class="row wrap">${btns.join('') || '<span class="help">No actions available for you in this status.</span>'}</div>`;
}
function ticketDrawer(it) {
  const j = it.jira;
  const desc = richHtml(j.descHtml, j.descText);
  return `
    <div class="dhead"><span class="meta"><a class="key" href="${esc(browseUrl(j.key))}" target="_blank" rel="noopener noreferrer" title="Open in Jira">${esc(j.key)}</a>${j.type ? `<span class="tag">${esc(j.type)}</span>` : ''}${statusPill(j)}</span><button class="x" data-act="close-drawer" aria-label="Close details">×</button></div>
    <h2>${esc(j.summary)}</h2>
    ${j.parentKey ? `<p class="help">Part of ${esc(j.parentKey)}</p>` : ''}
    <dl class="facts"><dt>Assignee</dt><dd>${esc(j.assignee || 'Unassigned')}</dd><dt>Author</dt><dd>${esc(j.author || 'Unknown')}</dd></dl>
    <div id="tr-area">${trHtml(it)}</div>
    <p class="help">${j.error ? `<span class="due over">The last refresh failed: ${esc(j.error)}</span> ` : ''}Refreshed ${esc(relTime(j.fetchedAt))}. <button class="chip" data-act="refresh-one">Refresh now</button></p>
    <details class="plan" ${UI.planOpen ? 'open' : ''}><summary>My priority, due date and reminder</summary>${planHtml(it)}</details>
    <div class="sect"><h3>Description</h3><div class="rich">${desc || '<span class="help">No description.</span>'}</div></div>
    <div class="sect"><h3>Comments (${j.comments.length})</h3>
      ${j.comments.map(c => `<div class="cmt"><div class="cmt-h"><b>${esc(c.author)}</b>, ${esc(fmtDateTime(c.created))}</div><div class="rich">${richHtml(c.html, c.text)}</div></div>`).join('')}
      <textarea id="cmt" placeholder="Write a comment" aria-label="New comment"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-act="add-comment">Add comment</button><span class="help" style="margin:0">Earns ${XP.comment} XP. Ctrl+Enter sends.</span></div>
    </div>
    <div class="dfoot"><button class="btn quiet danger" data-act="del">Remove from FocusQuest</button></div>`;
}

/* ------------------------------------------------------------------ modals */
function modal(html, cls) {
  const w = document.createElement('div'); w.className = 'overlay';
  w.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  w.addEventListener('mousedown', e => { if (e.target === w) closeModal(w); });
  $('#modals').appendChild(w);
  const f = w.querySelector('[autofocus]') || w.querySelector('input,textarea,select'); if (f) f.focus();
  return w;
}
function closeModal(w) { w = w || $('#modals').lastElementChild; if (w) w.remove(); }
function confirmBox(title, text, okLabel, fn) {
  const w = modal(`<h2>${esc(title)}</h2><p class="lead">${esc(text)}</p><div class="mfoot"><button class="btn" data-act="modal-close">Cancel</button><button class="btn primary" id="cf-ok">${esc(okLabel)}</button></div>`);
  $('#cf-ok', w).onclick = () => { closeModal(w); fn(); };
}
function showErr(sel, msg, root) { const el = $(sel, root || document); if (el) el.innerHTML = msg ? `<div class="err">${esc(msg)}</div>` : ''; }
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(label || 'Working')}`; }
  else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
}
function requireJira() {
  if (!SERVED) { toast(WEB ? 'Jira is not available in the browser version.' : 'Jira needs the helper. Start FocusQuest with Start-FocusQuest.cmd.', { kind: 'bad' }); return false; }
  if (!jiraReady()) { toast('Jira is not connected yet.', { actions: [{ label: 'Open settings', fn: () => { UI.view = 'settings'; renderMain(); } }], ttl: 8000 }); return false; }
  return true;
}

/* ------------------------------------------------------------------ Jira: import and refresh */
function newTicketItem(j) {
  return { id: uid(), kind: 'ticket', title: j.summary, notes: '', prio: 2, due: null, dueTime: null, remind: null, remFired: null, steps: [], done: j.statusCat === 'done', doneAt: j.statusCat === 'done' ? Date.now() : null, createdAt: Date.now(), focus: false, jira: j };
}
async function importKeys(keys) {
  const ok = [], failed = [], had = [];
  for (const key of keys) {
    if (ticketByKey(key)) { had.push(key); continue; }
    try { const j = await fetchIssue(key); if (ticketByKey(j.key)) { had.push(j.key); continue; } S.items.push(newTicketItem(j)); ok.push(j.key); }
    catch (e) { failed.push({ key, msg: e.message }); }
  }
  if (ok.length) { award('import', XP.import * ok.length, ok.length === 1 ? `Imported ${ok[0]}` : `Imported ${ok.length} tickets`, { lucky: false }); save(); refreshBoard(); }
  return { ok, failed, had };
}
function openImport() {
  if (!requireJira()) return;
  modal(`<h2>Import tickets</h2>
    <label class="f" for="imp-keys">By key</label>
    <div class="row"><input type="text" id="imp-keys" placeholder="PROJ-123, PROJ-456 or a pasted Jira link" autofocus><button class="btn primary" data-act="imp-keys">Import</button></div>
    <div id="imp-err"></div>
    <div class="sect"><div class="row" style="justify-content:space-between"><h3>Assigned to me</h3><button class="chip" data-act="imp-reload">Reload</button></div>
      <div id="imp-mine"></div></div>
    <div class="mfoot"><button class="btn" data-act="modal-close">Close</button><button class="btn primary" data-act="imp-selected" id="imp-sel-btn" disabled>Import selected</button></div>`, 'wide');
  loadMine();
}
async function loadMine() {
  const box = $('#imp-mine'); if (!box) return;
  box.innerHTML = `<p class="help"><span class="spin"></span>Loading your tickets</p>`;
  try {
    const r = await jira('POST', 'rest/api/2/search', { jql: S.settings.jql, fields: ['summary', 'status', 'issuetype'], maxResults: 100 });
    const issues = r.issues || [];
    if (!$('#imp-mine')) return;
    if (!issues.length) { box.innerHTML = `<p class="help">Jira found no tickets for this search. You can change the search in Settings.</p>`; return; }
    box.innerHTML = `<label class="pick" style="border:0;padding-left:12px"><input type="checkbox" id="imp-all"><span class="grow"><b>Select all that are not imported yet</b></span></label>
      <div class="picklist">${issues.map(i => {
        const had = !!ticketByKey(i.key), f = i.fields || {};
        return `<label class="pick${had ? ' off' : ''}"><input type="checkbox" class="imp-c" value="${esc(i.key)}" ${had ? 'disabled' : ''}>
          <span class="grow"><span class="title">${esc(f.summary || '')}</span><span class="meta"><span class="key">${esc(i.key)}</span><span class="tag">${esc((f.issuetype || {}).name || '')}</span><span class="st">${esc((f.status || {}).name || '')}</span>${had ? '<span>Already imported</span>' : ''}</span></span></label>`;
      }).join('')}</div>
      ${r.total > issues.length ? `<p class="help">Showing the first ${issues.length} of ${r.total}.</p>` : ''}`;
  } catch (e) { if ($('#imp-mine')) box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}
function impSelCount() { const n = $$('.imp-c:checked').length, b = $('#imp-sel-btn'); if (b) { b.disabled = !n; b.textContent = n ? `Import ${n} selected` : 'Import selected'; } }
function importReport(r) {
  const bits = [];
  if (r.ok.length) bits.push(`Imported ${r.ok.join(', ')}.`);
  if (r.had.length) bits.push(`${r.had.join(', ')} already imported.`);
  for (const f of r.failed) bits.push(`${f.key}: ${f.msg}`);
  return bits.join(' ');
}

async function refreshTicket(it, o = {}) {
  const old = it.jira;
  try {
    const j = await fetchIssue(old.key);
    if (!o.own && UI.sel !== it.id && (j.comments.length > old.comments.length || j.status !== old.status || j.assignee !== old.assignee)) it.fresh = true;
    it.jira = j; it.title = j.summary;
    if (j.statusCat === 'done' && !it.done) {
      it.done = true; it.doneAt = Date.now(); it.doneDay = today(); it.focus = false;
      if (!o.own) { it.awarded = award('ticketClosedElsewhere', XP.ticketClosedElsewhere, `${j.key} was closed in Jira`); bumpDone(); }
    } else if (j.statusCat !== 'done' && it.done) {
      it.done = false; it.doneAt = null;
      toast(`${j.key} was reopened in Jira.`);
    }
    return true;
  } catch (e) {
    it.jira = Object.assign({}, old, { error: e.message });
    return false;
  }
}
async function refreshAll(auto) {
  if (UI.refreshing || !jiraReady()) return;
  const list = S.items.filter(i => i.kind === 'ticket' && !i.done);
  UI.lastRefreshAll = Date.now();
  if (!list.length) { if (!auto) toast('No open tickets to refresh.'); return; }
  UI.refreshing = true;
  const b = $('#refall'); if (b) busy(b, true, 'Refreshing');
  let bad = 0;
  for (const it of list) { if (!(await refreshTicket(it))) bad++; }
  UI.refreshing = false;
  save(); refreshBoard();
  if (UI.sel && byId(UI.sel) && byId(UI.sel).kind === 'ticket') renderDrawer();
  const b2 = $('#refall'); if (b2) busy(b2, false);
  if (!auto) toast(bad ? `${list.length - bad} tickets refreshed, ${bad} failed. Open a ticket to see why.` : `${list.length} ${list.length === 1 ? 'ticket' : 'tickets'} refreshed.`, bad ? { kind: 'bad' } : {});
}

/* ------------------------------------------------------------------ Jira: comment, transitions, assign */
async function loadTransitions(it) {
  const key = it.jira.key;
  if (!jiraReady()) return null;
  try {
    ensureMe().then(() => { renderRailFoot(); }).catch(() => { });
    const r = await jira('GET', `rest/api/2/issue/${encodeURIComponent(key)}/transitions?expand=transitions.fields`);
    try { await ensureMe(); } catch (e) { /* assign button just stays hidden */ }
    UI.tr[key] = {
      list: (r.transitions || []).map(t => ({
        id: t.id, name: t.name, to: (t.to && t.to.name) || t.name,
        done: !!(t.to && t.to.statusCategory && t.to.statusCategory.key === 'done'), fields: t.fields || {}
      }))
    };
  } catch (e) { UI.tr[key] = { error: e.message, list: [] }; }
  const area = $('#tr-area');
  if (area && UI.sel === it.id) area.innerHTML = trHtml(it);
  return UI.tr[key];
}
async function addComment(it, btn) {
  const ta = $('#cmt'), text = ta ? ta.value.trim() : '';
  if (!text) { if (ta) ta.focus(); return; }
  if (!requireJira()) return;
  busy(btn, true, 'Sending');
  try {
    await jira('POST', `rest/api/2/issue/${encodeURIComponent(it.jira.key)}/comment`, { body: text });
    ta.value = '';
    award('comment', XP.comment, `Commented on ${it.jira.key}`); sound('done'); confetti(18, btn);
    await refreshTicket(it, { own: true });
    save(); renderDrawer(); refreshBoard();
  } catch (e) { busy(btn, false); toast(e.message, { kind: 'bad', ttl: 8000 }); }
}
async function assignMe(it, btn) {
  busy(btn, true, 'Assigning');
  try {
    const u = await ensureMe();
    await jira('PUT', `rest/api/2/issue/${encodeURIComponent(it.jira.key)}/assignee`, { name: u.name });
    await refreshTicket(it, { own: true });
    save(); renderDrawer(); refreshBoard(); loadTransitions(it);
    toast(`${it.jira.key} is now assigned to you.`);
  } catch (e) { busy(btn, false); toast(e.message, { kind: 'bad', ttl: 8000 }); }
}
async function closeTicketFlow(it) {
  if (!requireJira()) return;
  if (it.done) { openItem(it.id); return; }
  const tr = UI.tr[it.jira.key] && !UI.tr[it.jira.key].error ? UI.tr[it.jira.key] : await loadTransitions(it);
  if (!tr || tr.error) { toast((tr && tr.error) || 'Jira could not be reached.', { kind: 'bad' }); return; }
  const list = tr.list.filter(t => t.done);
  if (!list.length) {
    toast(`${it.jira.key} cannot be closed from "${it.jira.status}". Open it to see the steps Jira allows.`, { ttl: 7000, actions: [{ label: 'Open ticket', fn: () => openItem(it.id) }] });
    return;
  }
  openTransition(it, list);
}
function trFieldHtml(id, f) {
  const lab = `<label class="f">${esc(f.name || id)}${f.required ? '' : ' <small>optional</small>'}</label>`;
  const av = f.allowedValues;
  if (av && av.length) {
    if (f.schema && f.schema.type === 'array') return lab + `<div class="chips" data-trf="${esc(id)}" data-mode="multi">${av.map(v => `<label class="chip"><input type="checkbox" value="${esc(v.id)}"> ${esc(v.name || v.value)}</label>`).join('')}</div>`;
    return lab + `<select data-trf="${esc(id)}" data-mode="one">${f.required ? '' : '<option value="">None</option>'}${av.map(v => `<option value="${esc(v.id)}">${esc(v.name || v.value)}</option>`).join('')}</select>`;
  }
  return lab + `<input type="text" data-trf="${esc(id)}" data-mode="${f.schema && f.schema.type === 'user' ? 'user' : 'text'}">`;
}
function openTransition(it, list) {
  TRX = { id: it.id, list, sel: list[0].id };
  const w = modal('');
  TRX.w = w; trxRender();
}
function trxRender() {
  const it = byId(TRX.id), t = TRX.list.find(x => x.id === TRX.sel), j = it.jira;
  const keepC = $('#tr-cmt', TRX.w) ? $('#tr-cmt', TRX.w).value : '';
  const fields = Object.entries(t.fields).filter(([id, f]) => (f.required || id === 'resolution') && id !== 'comment');
  $('.modal', TRX.w).innerHTML = `
    <h2>${t.done ? 'Close' : 'Move'} ${esc(j.key)}</h2>
    <p class="lead">${esc(j.summary)}</p>
    ${TRX.list.length > 1 ? `<label class="f" for="tr-sel">How do you want to close it?</label><select id="tr-sel" data-ch="tr-sel">${TRX.list.map(x => `<option value="${esc(x.id)}" ${x.id === t.id ? 'selected' : ''}>${esc(x.name)} (status becomes ${esc(x.to)})</option>`).join('')}</select>`
      : `<p>The status changes from <b>${esc(j.status)}</b> to <b>${esc(t.to)}</b>.</p>`}
    ${fields.map(([id, f]) => trFieldHtml(id, f)).join('')}
    <label class="f" for="tr-cmt">Comment <small>optional, is added to the ticket first</small></label>
    <textarea id="tr-cmt"></textarea>
    <div id="tr-err"></div>
    <div class="mfoot"><button class="btn" data-act="modal-close">Cancel</button><button class="btn ${t.done ? 'done' : 'primary'}" data-act="do-transition">${t.done ? 'Close ticket' : esc(t.name)}</button></div>`;
  $('#tr-cmt', TRX.w).value = keepC;
}
async function doTransition(btn) {
  const it = byId(TRX.id), t = TRX.list.find(x => x.id === TRX.sel), w = TRX.w, key = it.jira.key;
  const fields = {};
  for (const el of $$('[data-trf]', w)) {
    const id = el.dataset.trf, f = t.fields[id] || {}, mode = el.dataset.mode;
    let v = null;
    if (mode === 'multi') { const ids = $$('input:checked', el).map(x => ({ id: x.value })); if (ids.length) v = ids; }
    else if (mode === 'one') { if (el.value) v = { id: el.value }; }
    else if (el.value.trim()) v = mode === 'user' ? { name: el.value.trim() } : el.value.trim();
    if (v === null && f.required) { showErr('#tr-err', `Fill in ${f.name || id}.`, w); return; }
    if (v !== null) fields[id] = v;
  }
  const cmt = $('#tr-cmt', w).value.trim();
  busy(btn, true, 'Working');
  try {
    if (cmt) {
      await jira('POST', `rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body: cmt });
      $('#tr-cmt', w).value = '';
      award('comment', XP.comment, `Commented on ${key}`, { lucky: false });
    }
    const body = { transition: { id: t.id } };
    if (Object.keys(fields).length) body.fields = fields;
    await jira('POST', `rest/api/2/issue/${encodeURIComponent(key)}/transitions`, body);
  } catch (e) { busy(btn, false); showErr('#tr-err', e.message, w); save(); return; }
  closeModal(w); TRX = null;
  delete UI.tr[key];
  const wasDone = it.done;
  let j = null; try { j = await fetchIssue(key); } catch (e) { /* keep old data, refresh later */ }
  if (j) { it.jira = j; it.title = j.summary; }
  const closed = j ? j.statusCat === 'done' : t.done;
  if (closed && !wasDone) celebrateClose(it);
  else { award('transition', XP.transition, `${key} moved to ${j ? j.status : t.to}`); sound('done'); }
  save(); refreshBoard(); if (UI.sel === it.id) { renderDrawer(); if (!it.done) loadTransitions(it); }
}
function celebrateClose(it) {
  it.done = true; it.doneAt = Date.now(); it.doneDay = today(); it.focus = false;
  if (it.jira && it.jira.statusCat !== 'done') it.jira.statusCat = 'done';
  const xp = award('ticketClose', XP.ticketClose, `Closed ${it.jira.key}`);
  it.awarded = xp;
  cheer('Ticket closed', `+${xp} XP`, `${it.jira.key} ${it.jira.summary}`, () => { confetti(240); sound('close'); });
  bumpDone();
}

/* ------------------------------------------------------------------ Jira: create ticket (with defaults, templates, own fields) */
const fieldsFor = type => S.ticketCfg.fields.filter(f => !f.types || !f.types.length || f.types.some(t => t.toLowerCase() === String(type).toLowerCase()));
const tplById = id => S.ticketCfg.templates.find(t => t.id === id);
const normVal = (f, v) => isMulti(f.kind) ? (Array.isArray(v) ? v.slice() : splitList(v)) : (Array.isArray(v) ? (v[0] || '') : String(v == null ? '' : v));
const isSub = type => /sub/i.test(type || '');
function todoDescription(todo) {
  const parts = [];
  if (todo.notes && todo.notes.trim()) parts.push(todo.notes.trim());
  if (todo.steps && todo.steps.length) parts.push(todo.steps.map(s => `* ${s.text}`).join('\n'));
  return parts.join('\n\n');
}
function openTicketForm(o = {}) {
  const c = S.ticketCfg, isT = o.mode === 'template';
  if (!isT && !requireJira()) return;
  TF = { mode: isT ? 'template' : 'create', todoId: o.todoId || null, tplId: o.tplId || '', name: '', project: c.project, type: c.types.includes(c.defaultType) ? c.defaultType : (c.types[0] || 'Task'), parent: '', summary: '', description: '', fields: {}, assignToMe: !!c.assignToMe, keep: true, fromCreate: false };
  for (const f of c.fields) TF.fields[f.uid] = normVal(f, f.def);
  const todo = TF.todoId ? byId(TF.todoId) : null;
  if (isT && o.tplId) {
    const t = tplById(o.tplId);
    Object.assign(TF, { name: t.name, project: t.project, type: t.type, summary: t.summary, description: t.description, assignToMe: !!t.assignToMe });
    for (const f of c.fields) if (t.fields && t.fields[f.uid] !== undefined) TF.fields[f.uid] = normVal(f, t.fields[f.uid]);
  } else if (todo) { TF.summary = todo.title; TF.description = todoDescription(todo); }
  TF.w = modal('', 'wide');
  tfRender();
}
function tfField(f) {
  const v = TF.fields[f.uid] === undefined ? normVal(f, f.def) : TF.fields[f.uid];
  const lab = `<label class="f">${esc(f.label || f.fieldId)}${f.required ? '' : ' <small>optional</small>'}</label>`;
  const has = f.values && f.values.length;
  if (isMulti(f.kind)) {
    if (has) return lab + `<div class="chips" data-f="${f.uid}">${f.values.map(x => `<label class="chip"><input type="checkbox" value="${esc(x)}" ${v.includes(x) ? 'checked' : ''}> ${esc(x)}</label>`).join('')}</div>`;
    return lab + `<input type="text" data-f="${f.uid}" value="${esc(v.join(', '))}" placeholder="Separate several with commas">`;
  }
  if ((f.kind === 'single-name' || f.kind === 'single-option') && has) {
    return lab + `<select data-f="${f.uid}"><option value="">Choose</option>${f.values.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  }
  return lab + `<input type="${f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}" data-f="${f.uid}" value="${esc(v)}">`;
}
function tfRender() {
  const c = S.ticketCfg, isT = TF.mode === 'template', todo = TF.todoId ? byId(TF.todoId) : null;
  const types = c.types.includes(TF.type) ? c.types : [TF.type, ...c.types];
  $('.modal', TF.w).innerHTML = `
    <h2>${isT ? (TF.tplId && !TF.fromCreate ? 'Edit template' : 'New template') : 'Create Jira ticket'}</h2>
    ${isT ? `<p class="lead">A template pre-fills the ticket form. Write {title} or {notes} where the title and notes of the to-do should go.</p>
        <label class="f" for="tf-name">Template name</label><input type="text" id="tf-name" value="${esc(TF.name)}" placeholder="For example: Access request" autofocus>`
      : c.templates.length ? `<label class="f" for="tf-tpl">Template</label><select id="tf-tpl" data-ch="tf-tpl"><option value="">No template, use my defaults</option>${c.templates.map(t => `<option value="${t.id}" ${t.id === TF.tplId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
    <div class="grid2">
      <div><label class="f" for="tf-project">Project key</label><input type="text" id="tf-project" value="${esc(TF.project)}" placeholder="For example: OPS"></div>
      <div><label class="f" for="tf-type">Ticket type</label><select id="tf-type" data-ch="tf-type">${types.map(t => `<option ${t === TF.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    </div>
    ${isSub(TF.type) ? `<label class="f" for="tf-parent">Parent ticket key</label><input type="text" id="tf-parent" value="${esc(TF.parent)}" placeholder="For example: OPS-123">` : ''}
    <label class="f" for="tf-summary">Summary</label><input type="text" id="tf-summary" value="${esc(TF.summary)}">
    <label class="f" for="tf-desc">Description</label><textarea id="tf-desc" rows="6">${esc(TF.description)}</textarea>
    ${fieldsFor(TF.type).map(tfField).join('')}
    <div class="chips" style="margin-top:16px">
      <label class="chip"><input type="checkbox" id="tf-assign" ${TF.assignToMe ? 'checked' : ''}> Assign to me</label>
      ${todo && !isT ? `<label class="chip"><input type="checkbox" id="tf-keep" ${TF.keep ? 'checked' : ''}> Turn the to-do into this ticket</label>` : ''}
    </div>
    <div id="tf-err"></div>
    <div class="mfoot">
      ${isT ? '' : `<button class="btn left" data-act="tf-as-tpl">Save as template</button>`}
      <button class="btn" data-act="${isT && TF.fromCreate ? 'tf-back' : 'modal-close'}">${isT && TF.fromCreate ? 'Back' : 'Cancel'}</button>
      <button class="btn primary" data-act="${isT ? 'tf-save' : 'tf-create'}">${isT ? 'Save template' : 'Create ticket'}</button>
    </div>`;
}
function tfCollect() {
  const w = TF.w, g = id => $('#' + id, w);
  for (const f of fieldsFor(TF.type)) {
    const el = $(`[data-f="${f.uid}"]`, w); if (!el) continue;
    TF.fields[f.uid] = isMulti(f.kind) ? (el.tagName === 'DIV' ? $$('input:checked', el).map(x => x.value) : splitList(el.value)) : el.value.trim();
  }
  if (g('tf-name')) TF.name = g('tf-name').value.trim();
  TF.project = g('tf-project').value.trim().toUpperCase();
  TF.type = g('tf-type').value;
  if (g('tf-parent')) TF.parent = g('tf-parent').value.trim().toUpperCase();
  TF.summary = g('tf-summary').value.trim();
  TF.description = g('tf-desc').value;
  TF.assignToMe = g('tf-assign').checked;
  if (g('tf-keep')) TF.keep = g('tf-keep').checked;
}
function tfApplyTemplate(id) {
  const c = S.ticketCfg, t = tplById(id), todo = TF.todoId ? byId(TF.todoId) : null;
  TF.tplId = id;
  const title = todo ? todo.title : '', notes = todo ? todoDescription(todo) : '';
  if (!t) {
    TF.project = c.project; TF.type = c.defaultType; TF.assignToMe = !!c.assignToMe;
    TF.summary = title; TF.description = notes;
    for (const f of c.fields) TF.fields[f.uid] = normVal(f, f.def);
  } else {
    TF.project = t.project || c.project; TF.type = t.type || TF.type; TF.assignToMe = !!t.assignToMe;
    const fill = s => String(s || '').split('{title}').join(title).split('{notes}').join(notes);
    TF.summary = t.summary ? fill(t.summary).trim() : title;
    TF.description = t.description ? fill(t.description) : notes;
    for (const f of c.fields) TF.fields[f.uid] = normVal(f, t.fields && t.fields[f.uid] !== undefined ? t.fields[f.uid] : f.def);
  }
  tfRender();
}
function tfSaveTemplate() {
  tfCollect();
  if (!TF.name) { showErr('#tf-err', 'Give the template a name.', TF.w); return; }
  const c = S.ticketCfg, editing = TF.tplId && !TF.fromCreate ? tplById(TF.tplId) : null;
  const t = editing || { id: 't_' + uid() };
  Object.assign(t, { name: TF.name, project: TF.project, type: TF.type, summary: TF.summary, description: TF.description, assignToMe: TF.assignToMe, fields: clone(TF.fields) });
  if (!editing) c.templates.push(t);
  save();
  toast(`Template "${t.name}" saved.`);
  if (TF.fromCreate) { TF.mode = 'create'; TF.fromCreate = false; TF.tplId = t.id; tfRender(); }
  else { closeModal(TF.w); TF = null; if (UI.view === 'settings') renderSettings(); }
}
async function tfCreate(btn) {
  tfCollect();
  const errs = [], sub = isSub(TF.type);
  if (!TF.project) errs.push('Enter the project key.');
  if (!TF.summary) errs.push('Enter a summary.');
  if (sub && !TF.parent) errs.push('A sub-task needs the key of its parent ticket.');
  const fields = { project: { key: TF.project }, issuetype: { name: TF.type }, summary: TF.summary };
  if (TF.description.trim()) fields.description = TF.description;
  if (sub && TF.parent) fields.parent = { key: TF.parent };
  for (const f of fieldsFor(TF.type)) {
    const v = TF.fields[f.uid], empty = isMulti(f.kind) ? !v.length : !v;
    if (empty) { if (f.required) errs.push(`${f.label || f.fieldId} is required.`); continue; }
    if (f.fieldId) fields[f.fieldId] = fieldPayload(f, v);
  }
  if (errs.length) { showErr('#tf-err', errs.join(' '), TF.w); return; }
  showErr('#tf-err', '', TF.w); busy(btn, true, 'Creating');
  let r;
  try {
    if (TF.assignToMe) { const u = await ensureMe(); fields.assignee = { name: u.name }; }
    r = await jira('POST', 'rest/api/2/issue', { fields });
  } catch (e) { busy(btn, false); showErr('#tf-err', e.message, TF.w); return; }
  if (!S.ticketCfg.project) S.ticketCfg.project = TF.project;
  let j;
  try { j = await fetchIssue(r.key); }
  catch (e) { j = { key: r.key, id: r.id, summary: TF.summary, type: TF.type, subtask: sub, status: 'Created', statusCat: 'new', assignee: '', assigneeName: '', author: '', descHtml: null, descText: TF.description, comments: [], parentKey: TF.parent, fetchedAt: Date.now(), error: e.message }; }
  const todo = TF.todoId ? byId(TF.todoId) : null;
  let it;
  if (todo && TF.keep) { it = todo; it.kind = 'ticket'; it.jira = j; it.title = j.summary; }
  else { it = newTicketItem(j); S.items.push(it); }
  closeModal(TF.w); TF = null;
  award('ticketCreate', XP.ticketCreate, `Created ${j.key}`);
  confetti(90); sound('level');
  save(); refreshBoard(); openItem(it.id);
  toast(`${j.key} created in Jira.`, { ttl: 6000 });
}

/* ------------------------------------------------------------------ rewards view */
function renderRewards() {
  const g = S.game, l = levelOf(g.xp), d = dayRec();
  const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 13));
  const max = Math.max(1, ...days.map(x => (g.days[dstr(x)] || {}).done || 0));
  $('#main').innerHTML = `
    <h1 class="view-h">Rewards</h1>
    <p class="lead">Level ${l}, ${esc(titleOf(l))}. ${needXp(l + 1) - g.xp} XP to level ${l + 1}.</p>
    <div class="tiles">
      <div class="tile"><b>${d.done}</b><span>finished today</span></div>
      <div class="tile"><b>${d.xp}</b><span>XP today</span></div>
      <div class="tile"><b>${g.counts.ticketClose || 0}</b><span>tickets closed</span></div>
      <div class="tile"><b>${g.streak.best || 0}</b><span>best workday streak</span></div>
    </div>
    <div class="card"><h2>Finished per day, last two weeks</h2>
      <div class="bars">${days.map(x => { const n = (g.days[dstr(x)] || {}).done || 0; return `<div class="${isWeekend(x) ? 'we' : ''}"><b>${n || ''}</b><i style="height:${Math.round(n / max * 100)}%"></i>${x.toLocaleDateString('en-GB', { weekday: 'narrow' })}</div>`; }).join('')}</div>
    </div>
    <div class="card"><h2>Badges</h2>
      <div class="badges">${BADGES.map(b => `<div class="badge${g.badges[b.id] ? '' : ' locked'}"><div class="ic">${b.ic}</div><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`).join('')}</div>
    </div>
    <div class="card"><h2>What earns XP</h2>
      <ul class="log">
        <li><span>Close a ticket</span><span class="xp">${XP.ticketClose} XP</span></li>
        <li><span>Create a ticket</span><span class="xp">${XP.ticketCreate} XP</span></li>
        <li><span>Finish a to-do (high, medium, low priority)</span><span class="xp">${XP.todoDone[1]}, ${XP.todoDone[2]}, ${XP.todoDone[3]} XP</span></li>
        <li><span>Comment on a ticket</span><span class="xp">${XP.comment} XP</span></li>
        <li><span>Move a ticket to another status</span><span class="xp">${XP.transition} XP</span></li>
        <li><span>Finish before the due date</span><span class="xp">+${XP.onTime} XP</span></li>
        <li><span>Reach the daily goal</span><span class="xp">+${XP.goal} XP</span></li>
        <li><span>Capture a to-do, tick a step, import a ticket</span><span class="xp">${XP.todoCreate} XP</span></li>
      </ul>
      <p class="help">Now and then a reward is doubled by luck.</p>
    </div>
    <div class="card"><h2>Recent wins</h2>
      ${g.log.length ? `<ul class="log">${g.log.slice(0, 20).map(e => `<li><span>${esc(e.label)} <span class="help">${esc(relTime(e.t))}</span></span><span class="xp">+${e.xp} XP</span></li>`).join('')}</ul>` : `<p class="help">Your wins show up here.</p>`}
    </div>`;
}

/* ------------------------------------------------------------------ settings view */
function notifState() { return ('Notification' in window) ? Notification.permission : 'unsupported'; }
function renderSettings() {
  const s = S.settings, c = S.ticketCfg, ns = notifState();
  $('#main').innerHTML = `
    <h1 class="view-h">Settings</h1>
    <div class="card"><h2>Jira connection</h2>
      ${SERVED ? `<p class="lead">Your token stays on this PC. The helper stores it encrypted for your Windows user and never hands it to the browser.</p>
      <label class="f" for="j-url">Jira address</label><input type="url" id="j-url" value="${esc(meta.jira.baseUrl)}" placeholder="https://jira.your-company.com">
      <label class="f" for="j-tok">Personal access token <small>in Jira: profile picture, Profile, Personal Access Tokens</small></label>
      <input type="password" id="j-tok" autocomplete="off" placeholder="${meta.jira.hasToken ? 'A token is saved. Leave empty to keep it.' : 'Paste the token'}">
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="jira-save">Save and test</button>${meta.jira.hasToken ? `<button class="btn quiet danger" data-act="jira-forget">Forget token</button>` : ''}</div>
      <div id="j-msg"></div>` : `<p class="lead">Jira is only available when FocusQuest is started with Start-FocusQuest.cmd.</p>`}
      <div class="grid2">
        <div><label class="f" for="s-ref">Refresh tickets every <small>minutes, 0 turns it off</small></label><input type="number" id="s-ref" min="0" max="720" data-ch="set" data-path="settings.refreshMin" value="${s.refreshMin}"></div>
        <div></div>
      </div>
      <label class="f" for="s-jql">Search used for "Assigned to me" <small>JQL</small></label><input type="text" id="s-jql" data-ch="set" data-path="settings.jql" value="${esc(s.jql)}">
    </div>

    <div class="card"><h2>New tickets</h2>
      <p class="lead">These defaults pre-fill the form when you create a ticket.</p>
      <div class="grid2">
        <div><label class="f" for="c-proj">Project key</label><input type="text" id="c-proj" data-ch="set" data-path="ticketCfg.project" data-upper="1" value="${esc(c.project)}" placeholder="For example: OPS"></div>
        <div><label class="f" for="c-def">Default ticket type</label><select id="c-def" data-ch="set" data-path="ticketCfg.defaultType">${c.types.map(t => `<option ${t === c.defaultType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      </div>
      <label class="f" for="c-types">Ticket types you can choose <small>separated by commas, spelled as in Jira</small></label>
      <input type="text" id="c-types" data-ch="set" data-path="ticketCfg.types" data-list="1" value="${esc(c.types.join(', '))}">
      <div class="chips" style="margin-top:14px"><label class="chip"><input type="checkbox" data-ch="set" data-path="ticketCfg.assignToMe" ${c.assignToMe ? 'checked' : ''}> Assign new tickets to me</label></div>
    </div>

    <div class="card"><h2>Fields in the ticket form</h2>
      <p class="lead">Add the fields your project asks for, and list only the choices your team uses. They appear as a pick list when you create a ticket.</p>
      ${c.fields.map((f, i) => `
      <div class="fieldcard" data-i="${i}">
        <div class="grid2">
          <div><label class="f">Name in the form</label><input type="text" data-ch="fld" data-k="label" value="${esc(f.label)}"></div>
          <div><label class="f">Jira field ID <small>components, customfield_10042</small></label><input type="text" data-ch="fld" data-k="fieldId" value="${esc(f.fieldId)}"></div>
        </div>
        <label class="f">Kind of field</label>
        <select data-ch="fld" data-k="kind">${Object.keys(KINDS).map(k => `<option value="${k}" ${k === f.kind ? 'selected' : ''}>${KINDS[k]}</option>`).join('')}</select>
        <label class="f">Choices your team uses <small>one per line, spelled as in Jira. Empty means free text.</small></label>
        <textarea data-ch="fld" data-k="values" rows="3">${esc((f.values || []).join('\n'))}</textarea>
        <div class="chips"><button class="chip" data-act="fld-pick">Pick the choices from Jira</button></div>
        <div class="grid2">
          <div><label class="f">Preselected <small>optional</small></label><input type="text" data-ch="fld" data-k="def" value="${esc(isMulti(f.kind) ? (f.def || []).join(', ') : (f.def || ''))}"></div>
          <div><label class="f">Only for these ticket types <small>empty means all</small></label><input type="text" data-ch="fld" data-k="types" value="${esc((f.types || []).join(', '))}"></div>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:14px">
          <label class="chip"><input type="checkbox" data-ch="fld" data-k="required" ${f.required ? 'checked' : ''}> Required</label>
          <button class="btn small quiet danger" data-act="fld-del">Remove field</button>
        </div>
      </div>`).join('')}
      <div class="row wrap" style="margin-top:14px"><button class="btn" data-act="fld-add">Add a field</button><button class="btn" data-act="fld-browse">Find fields in Jira</button></div>
    </div>

    <div class="card"><h2>Ticket templates</h2>
      <p class="lead">A template fills project, type, text and fields in one go. You can also save one from the ticket form.</p>
      ${c.templates.map(t => `<div class="tpl" data-tpl="${t.id}"><span><b>${esc(t.name)}</b> <span class="help">${esc(t.type)}${t.project ? ' in ' + esc(t.project) : ''}</span></span><span class="row"><button class="btn small" data-act="tpl-edit">Edit</button><button class="btn small quiet danger" data-act="tpl-del">Delete</button></span></div>`).join('') || '<p class="help">No templates yet.</p>'}
      <div class="row" style="margin-top:14px"><button class="btn" data-act="tpl-new">New template</button></div>
    </div>

    <div class="card"><h2>Day to day</h2>
      <div class="grid2">
        <div><label class="f" for="s-goal">Daily goal <small>things finished per day</small></label><input type="number" id="s-goal" min="1" max="20" data-ch="set" data-path="settings.dailyGoal" value="${s.dailyGoal}"></div>
        <div><label class="f" for="s-rt">Reminder time for due dates without a time</label><input type="time" id="s-rt" data-ch="set" data-path="settings.dayRemindTime" value="${esc(s.dayRemindTime)}"></div>
        <div><label class="f" for="s-theme">Appearance</label><select id="s-theme" data-ch="set" data-path="settings.theme"><option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Same as Windows</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
      </div>
      <div class="chips" style="margin-top:16px">
        <label class="chip"><input type="checkbox" data-ch="set" data-path="settings.sound" ${s.sound ? 'checked' : ''}> Sounds</label>
        <label class="chip"><input type="checkbox" data-ch="set" data-path="settings.motion" ${s.motion ? 'checked' : ''}> Confetti and animations</label>
      </div>
      <label class="f">Desktop notifications for reminders</label>
      <p class="help" style="margin-top:0">${ns === 'granted' ? 'On. Reminders appear as Windows notifications while this tab is open.' : ns === 'denied' ? 'Blocked in the browser. Allow notifications for this page in the site settings (lock icon in the address bar).' : ns === 'unsupported' ? 'This browser has no notifications. Reminders still show inside FocusQuest.' : 'Off. Reminders only show inside FocusQuest until you turn this on.'}</p>
      ${ns === 'default' ? `<button class="btn" data-act="notif-on" style="margin-top:8px">Turn on notifications</button>` : ns === 'granted' ? `<button class="btn" data-act="notif-test" style="margin-top:8px">Send a test reminder</button>` : ''}
    </div>

    <div class="card"><h2>Your data</h2>
      <p class="lead">${SERVED ? 'Everything is saved in the data folder next to Start-FocusQuest.cmd. A dated copy is kept for the last 14 days.' : 'Everything is saved in this browser. Clearing the browsing data of this browser deletes it, so save a backup file now and then.'}</p>
      <div class="row wrap"><button class="btn" data-act="export">Save a backup file</button><button class="btn" data-act="import-file">Restore from a backup file</button>${SERVED ? `<button class="btn quiet" data-act="quit">Stop the helper</button>` : ''}</div>
      <input type="file" id="imp-file" accept="application/json,.json" hidden>
    </div>`;
}

/* field tools in settings */
async function fldPick(i, btn) {
  const c = S.ticketCfg, f = c.fields[i];
  if (!requireJira()) return;
  if (!c.project) { toast('Enter the project key under "New tickets" first.', { kind: 'bad' }); return; }
  if (!f.fieldId) { toast('Enter the Jira field ID first.', { kind: 'bad' }); return; }
  const type = (f.types && f.types[0]) || c.defaultType;
  busy(btn, true, 'Loading');
  let names = [];
  try {
    const metaF = (await createMeta(c.project, type)).find(x => x.id === f.fieldId);
    if (metaF && metaF.allowed) names = metaF.allowed.map(v => v.name || v.value).filter(Boolean);
    if (!names.length && f.fieldId === 'components') names = (await jira('GET', `rest/api/2/project/${encodeURIComponent(c.project)}/components`)).map(v => v.name);
    if (!names.length) throw new Error(metaF ? `Jira offers no fixed choices for ${metaF.name}.` : `The create screen for ${type} in ${c.project} has no field "${f.fieldId}".`);
  } catch (e) { busy(btn, false); toast(e.message, { kind: 'bad', ttl: 8000 }); return; }
  busy(btn, false);
  const cur = new Set(f.values || []);
  const w = modal(`<h2>Choices for ${esc(f.label || f.fieldId)}</h2><p class="lead">Tick the ones your team uses. ${names.length} are available in ${esc(c.project)}.</p>
    <input type="text" id="pk-filter" placeholder="Filter" autofocus>
    <div class="picklist">${names.map(n => `<label class="pick"><input type="checkbox" value="${esc(n)}" ${cur.has(n) ? 'checked' : ''}><span class="grow">${esc(n)}</span></label>`).join('')}</div>
    <div class="mfoot"><button class="btn" data-act="modal-close">Cancel</button><button class="btn primary" id="pk-ok">Use these</button></div>`);
  $('#pk-filter', w).addEventListener('input', e => { const q = e.target.value.toLowerCase(); $$('.pick', w).forEach(p => { p.hidden = !!q && !p.textContent.toLowerCase().includes(q); }); });
  $('#pk-ok', w).onclick = () => { f.values = $$('.picklist input:checked', w).map(x => x.value); save(); closeModal(w); renderSettings(); };
}
function fldBrowse() {
  const c = S.ticketCfg;
  if (!requireJira()) return;
  if (!c.project) { toast('Enter the project key under "New tickets" first.', { kind: 'bad' }); return; }
  modal(`<h2>Fields in ${esc(c.project)}</h2><p class="lead">Jira lists the fields of the create screen. Add the ones you want in your ticket form.</p>
    <div class="row"><select id="fb-type" aria-label="Ticket type">${c.types.map(t => `<option ${t === c.defaultType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><button class="btn primary" data-act="fb-load">Show fields</button></div>
    <div id="fb-list"></div>
    <div class="mfoot"><button class="btn" data-act="modal-close">Done</button></div>`, 'wide');
  fbLoad();
}
async function fbLoad() {
  const box = $('#fb-list'), c = S.ticketCfg, type = $('#fb-type').value;
  box.innerHTML = `<p class="help"><span class="spin"></span>Asking Jira</p>`;
  try {
    const skip = new Set(['project', 'issuetype', 'summary', 'description', 'assignee', 'reporter', 'parent', 'attachment', 'issuelinks', 'timetracking']);
    const fields = (await createMeta(c.project, type)).filter(f => !skip.has(f.id)).sort((a, b) => (b.required - a.required) || a.name.localeCompare(b.name));
    UI.fb = { type, fields };
    box.innerHTML = fields.length ? `<div class="picklist">${fields.map((f, i) => {
      const had = c.fields.some(x => x.fieldId === f.id);
      return `<div class="pick" style="cursor:default"><span class="grow"><span class="title">${esc(f.name)}${f.required ? ' <span class="due over">required</span>' : ''}</span><span class="meta"><span>${esc(f.id)}</span><span>${esc(KINDS[kindFromSchema(f.schema)].split(',')[0].split(' (')[0])}</span>${f.allowed ? `<span>${f.allowed.length} choices</span>` : ''}</span></span>
        <button class="btn small" data-act="fb-add" data-n="${i}" ${had ? 'disabled' : ''}>${had ? 'Added' : 'Add'}</button></div>`;
    }).join('')}</div>` : `<p class="help">Jira returned no extra fields for this type.</p>`;
  } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

/* ------------------------------------------------------------------ reminders */
function fireReminder(it) {
  sound('remind');
  const title = itemTitle(it), di = dueInfo(it);
  if (notifState() === 'granted') {
    try {
      const n = new Notification('FocusQuest reminder', { body: title + (di ? '\n' + di.text : ''), tag: it.id, requireInteraction: true });
      n.onclick = () => { window.focus(); openItem(it.id); n.close(); };
    } catch (e) { /* in-app reminder below still shows */ }
  }
  const snooze = min => { it.remind = localDT(new Date(Date.now() + min * 60000)); it.remFired = null; save(); refreshBoard(); if (UI.sel === it.id) renderDrawer(); toast(`Next reminder: ${fmtWhen(it.remind)}.`); };
  toast(`<b>Reminder</b>${esc(title)}${di ? `<br>${esc(di.text)}` : ''}`, {
    html: true, kind: 'remind', sticky: true, actions: [
      { label: 'Open', fn: () => openItem(it.id) },
      { label: 'In 10 min', fn: () => snooze(10) },
      { label: 'In 1 hour', fn: () => snooze(60) },
      { label: 'Dismiss', fn() { } }]
  });
}
function checkReminders() {
  const now = Date.now(); let changed = false;
  for (const it of S.items) {
    if (it.done) continue;
    const t = effReminder(it);
    if (t && t <= now && it.remFired !== t) { it.remFired = t; changed = true; fireReminder(it); }
  }
  if (changed) save();
}
function tick() {
  checkReminders();
  if (UI.day !== today()) { UI.day = today(); renderPlayer(); refreshBoard(); }
  const min = +S.settings.refreshMin || 0;
  if (min > 0 && jiraReady() && !helperDown && !$('#modals').children.length && Date.now() - UI.lastRefreshAll >= min * 60000) refreshAll(true);
}

/* ------------------------------------------------------------------ click actions */
const ACT = {
  view(el) { UI.view = el.dataset.view; if (UI.sel) closeDrawer(); renderMain(); window.scrollTo(0, 0); },
  tab(el) { UI.tab = el.dataset.tab; renderList(); },
  'cap-prio'(el) { UI.capPrio = UI.capPrio === 1 ? 3 : UI.capPrio - 1; el.className = 'pp p' + UI.capPrio; el.textContent = PRIO[UI.capPrio]; renderHint(); $('#q').focus(); },
  open(el, it) { if (it) openItem(it.id); },
  'close-drawer'() { closeDrawer(); },
  toggle(el, it) {
    if (!it) return;
    if (it.kind === 'ticket') { closeTicketFlow(it); return; }
    if (it.done) uncompleteTodo(it); else completeTodo(it, el);
  },
  'close-ticket'(el, it) { if (it) closeTicketFlow(it); },
  'now-skip'(el, it) { if (it) { UI.skipped.add(it.id); if (it.focus) { it.focus = false; save(); } refreshBoard(); } },
  'cycle-prio'(el, it) { it.prio = it.prio === 1 ? 3 : it.prio - 1; save(); refreshBoard(); if (UI.sel === it.id) renderDrawer(); },
  'set-prio'(el, it) { it.prio = +el.dataset.p; UI.planOpen = true; save(); refreshBoard(); renderDrawer(); },
  focus(el, it) { const on = !it.focus; S.items.forEach(i => { i.focus = false; }); it.focus = on; UI.skipped.delete(it.id); save(); refreshBoard(); },
  'due-q'(el, it) {
    const q = el.dataset.q, now = new Date();
    if (q === 'clear') { it.due = null; it.dueTime = null; }
    else if (q === 'mon') { let d = (1 - now.getDay() + 7) % 7; if (d === 0) d = 7; it.due = dstr(addDays(now, d)); }
    else it.due = dstr(addDays(now, +q));
    UI.planOpen = true; touchReminder(it); save(); refreshBoard(); renderDrawer();
  },
  'rem-q'(el, it) {
    const q = el.dataset.q;
    if (q === 'clear') it.remind = null;
    else if (q === 'tom') { const d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); it.remind = localDT(d); }
    else it.remind = localDT(new Date(Date.now() + (+q) * 60000));
    UI.planOpen = true; touchReminder(it); save(); refreshBoard(); renderDrawer();
    if (it.remind && notifState() === 'default') toast('Reminders show inside FocusQuest. Turn on notifications to also get a Windows notification.', { ttl: 9000, actions: [{ label: 'Turn on', fn: () => ACT['notif-on']() }] });
  },
  'step-del'(el, it) { const id = el.closest('[data-step]').dataset.step; it.steps = it.steps.filter(s => s.id !== id); save(); renderDrawer(); refreshBoard(); },
  del(el, it) { if (it) deleteItem(it); },
  'to-ticket'(el, it) { openTicketForm({ todoId: it.id }); },
  'new-ticket'() { openTicketForm({}); },
  'clear-done'() {
    const n = S.items.filter(i => i.done).length;
    confirmBox('Remove finished items?', `${n} finished ${n === 1 ? 'item leaves' : 'items leave'} the list. XP, badges and tickets in Jira stay as they are.`, 'Remove', () => { S.items = S.items.filter(i => !i.done); if (UI.sel && !byId(UI.sel)) closeDrawer(); save(); refreshBoard(); });
  },
  'modal-close'(el) { closeModal(el.closest('.overlay')); },

  import() { openImport(); },
  'imp-reload'() { loadMine(); },
  async 'imp-keys'(el) {
    const inp = $('#imp-keys'), keys = Array.from(new Set((inp.value.match(KEY_RE) || []).map(k => k.toUpperCase())));
    if (!keys.length) { showErr('#imp-err', 'Enter at least one ticket key such as PROJ-123.'); return; }
    busy(el, true, 'Importing');
    const r = await importKeys(keys);
    busy(el, false);
    const box = $('#imp-err'); if (!box) return;
    box.innerHTML = `<div class="${r.failed.length ? 'err' : 'okmsg'}">${esc(importReport(r))}</div>`;
    if (!r.failed.length) inp.value = '';
    loadMine();
  },
  async 'imp-selected'(el) {
    const keys = $$('.imp-c:checked').map(x => x.value); if (!keys.length) return;
    busy(el, true, 'Importing');
    const r = await importKeys(keys);
    if (r.failed.length) { busy(el, false); showErr('#imp-err', importReport(r)); loadMine(); return; }
    closeModal(el.closest('.overlay'));
    UI.tab = 'open'; refreshBoard();
  },
  'refresh-all'() { if (requireJira()) refreshAll(false); },
  async 'refresh-one'(el, it) {
    if (!requireJira()) return;
    busy(el, true, 'Refreshing');
    const ok = await refreshTicket(it);
    save(); refreshBoard(); renderDrawer(); if (!it.done) loadTransitions(it);
    if (!ok) toast(it.jira.error, { kind: 'bad', ttl: 8000 });
  },
  'add-comment'(el, it) { addComment(it, el); },
  'assign-me'(el, it) { assignMe(it, el); },
  transition(el, it) { const t = (UI.tr[it.jira.key] || { list: [] }).list.find(x => x.id === el.dataset.tr); if (t) openTransition(it, [t]); },
  'do-transition'(el) { doTransition(el); },

  'tf-create'(el) { tfCreate(el); },
  'tf-save'() { tfSaveTemplate(); },
  'tf-as-tpl'() { tfCollect(); TF.mode = 'template'; TF.fromCreate = true; TF.name = ''; tfRender(); const n = $('#tf-name', TF.w); if (n) n.focus(); },
  'tf-back'() { tfCollect(); TF.mode = 'create'; TF.fromCreate = false; tfRender(); },
  'tpl-new'() { openTicketForm({ mode: 'template' }); },
  'tpl-edit'(el) { openTicketForm({ mode: 'template', tplId: el.closest('[data-tpl]').dataset.tpl }); },
  'tpl-del'(el) {
    const id = el.closest('[data-tpl]').dataset.tpl, t = tplById(id);
    confirmBox('Delete this template?', `"${t.name}" is removed. Tickets you already created stay as they are.`, 'Delete', () => { S.ticketCfg.templates = S.ticketCfg.templates.filter(x => x.id !== id); save(); renderSettings(); });
  },

  'fld-add'() { S.ticketCfg.fields.push({ uid: 'f_' + uid(), label: '', fieldId: '', kind: 'single-option', values: [], required: false, def: '', types: [] }); save(); renderSettings(); },
  'fld-del'(el) { const i = +el.closest('[data-i]').dataset.i; S.ticketCfg.fields.splice(i, 1); save(); renderSettings(); },
  'fld-pick'(el) { fldPick(+el.closest('[data-i]').dataset.i, el); },
  'fld-browse'() { fldBrowse(); },
  'fb-load'() { fbLoad(); },
  'fb-add'(el) {
    const f = UI.fb.fields[+el.dataset.n], kind = kindFromSchema(f.schema);
    const names = (f.allowed || []).map(v => v.name || v.value).filter(Boolean);
    S.ticketCfg.fields.push({ uid: 'f_' + uid(), label: f.name, fieldId: f.id, kind, values: names.length <= 12 ? names : [], required: f.required, def: isMulti(kind) ? [] : '', types: [] });
    save(); el.disabled = true; el.textContent = 'Added'; renderSettings();
    if (names.length > 12) toast(`${f.name} added. It has ${names.length} choices: use "Pick the choices from Jira" to keep only yours.`, { ttl: 8000 });
  },

  async 'jira-save'(el) {
    const url = $('#j-url').value.trim().replace(/\/+$/, ''), tok = $('#j-tok').value.trim();
    if (!/^https?:\/\//i.test(url)) { showErr('#j-msg', 'Enter the Jira address starting with https://'); return; }
    busy(el, true, 'Testing');
    try {
      const body = { baseUrl: url }; if (tok) body.token = tok;
      await api('POST', '/api/jira-config', body);
      meta.jira.baseUrl = url; if (tok) meta.jira.hasToken = true;
      me = null;
      const u = await ensureMe();
      renderSettings(); renderRailFoot();
      $('#j-msg').innerHTML = `<div class="okmsg">Connected as ${esc(u.displayName || u.name)}.</div>`;
    } catch (e) { busy(el, false); renderRailFoot(); showErr('#j-msg', e.message); }
  },
  async 'jira-forget'() {
    try { await api('POST', '/api/jira-config', { token: '' }); meta.jira.hasToken = false; me = null; renderSettings(); renderRailFoot(); toast('Token removed from this PC.'); }
    catch (e) { toast(e.message, { kind: 'bad' }); }
  },
  async 'notif-on'() {
    if (!('Notification' in window)) return;
    try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
    if (UI.view === 'settings') renderSettings();
    if (notifState() === 'granted') toast('Notifications are on.');
  },
  'notif-test'() { fireReminder({ id: 'test', kind: 'todo', title: 'This is how a reminder looks', due: null, steps: [] }); },
  export() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
    a.download = `focusquest-backup-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  'import-file'() { $('#imp-file').click(); },
  async quit() {
    await flush();
    try { await api('POST', '/api/quit'); } catch (e) { /* already gone */ }
    helperDown = true; renderRailFoot();
    toast('The helper has stopped. You can close this tab. Start FocusQuest again with Start-FocusQuest.cmd.', { sticky: true });
  }
};

/* ------------------------------------------------------------------ change handlers */
const CH = {
  sort(el) { S.settings.sort = el.value; save(); renderList(); },
  title(el, it) { const v = el.value.replace(/\s+/g, ' ').trim(); if (v) { it.title = v; save(); refreshBoard(); } else el.value = it.title; },
  notes(el, it) { it.notes = el.value; save(); },
  due(el, it) { it.due = el.value || null; if (!it.due) it.dueTime = null; UI.planOpen = true; touchReminder(it); save(); refreshBoard(); renderDrawer(); },
  dueTime(el, it) { it.dueTime = el.value || null; if (it.dueTime && !it.due) it.due = today(); UI.planOpen = true; touchReminder(it); save(); refreshBoard(); renderDrawer(); },
  remind(el, it) { it.remind = el.value || null; UI.planOpen = true; touchReminder(it); save(); refreshBoard(); renderDrawer(); },
  step(el, it) {
    const s = it.steps.find(x => x.id === el.closest('[data-step]').dataset.step); if (!s) return;
    s.done = el.checked;
    if (s.done) { s.awarded = award('step', XP.step, 'Step: ' + s.text, { lucky: false }); sound('step'); }
    else if (s.awarded) { takeXp(s.awarded, 'step'); s.awarded = 0; }
    save(); renderDrawer(); refreshBoard();
    if (s.done && !it.done && it.steps.every(x => x.done)) toast('All steps ticked. Ready to finish the to-do?', { ttl: 7000, actions: [{ label: 'Mark as done', fn: () => completeTodo(it) }] });
  },
  set(el) {
    const path = el.dataset.path.split('.'); let o = S;
    for (const k of path.slice(0, -1)) o = o[k];
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.min(+el.max || 1e9, Math.max(+el.min || 0, Math.round(+el.value || 0))) : el.value.trim();
    if (el.dataset.upper) v = v.toUpperCase();
    if (el.dataset.list) { v = splitList(v); if (!v.length) v = defaults().ticketCfg.types; }
    o[path[path.length - 1]] = v;
    const c = S.ticketCfg; if (!c.types.includes(c.defaultType)) c.defaultType = c.types[0];
    save();
    const p = el.dataset.path;
    if (p === 'settings.theme') applyTheme();
    if (p === 'settings.dailyGoal') renderPlayer();
    if (p === 'ticketCfg.types' || el.type === 'number' || el.dataset.upper) renderSettings();
  },
  fld(el) {
    const f = S.ticketCfg.fields[+el.closest('[data-i]').dataset.i], k = el.dataset.k;
    if (k === 'required') f.required = el.checked;
    else if (k === 'values') f.values = splitList(el.value);
    else if (k === 'types') f.types = splitList(el.value);
    else if (k === 'def') f.def = isMulti(f.kind) ? splitList(el.value) : el.value.trim();
    else if (k === 'kind') { f.kind = el.value; f.def = normVal(f, f.def); }
    else f[k] = el.value.trim();
    save();
  },
  'tf-type'() { tfCollect(); tfRender(); },
  'tf-tpl'(el) { tfCollect(); tfApplyTemplate(el.value); },
  'tr-sel'(el) { TRX.sel = el.value; trxRender(); }
};

/* ------------------------------------------------------------------ wiring */
function wire() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act]; if (!fn) return;
    const holder = el.closest('[data-id]');
    fn(el, holder ? byId(holder.dataset.id) : null, e);
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'imp-all') { $$('.imp-c:not(:disabled)').forEach(c => { c.checked = t.checked; }); impSelCount(); return; }
    if (t.classList && t.classList.contains('imp-c')) { impSelCount(); return; }
    if (t.id === 'imp-file') { restoreBackup(t); return; }
    const el = t.closest('[data-ch]'); if (!el || !CH[el.dataset.ch]) return;
    const holder = el.closest('[data-id]');
    CH[el.dataset.ch](el, holder ? byId(holder.dataset.id) : null, e);
  });
  document.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('plan')) UI.planOpen = e.target.open; }, true);
  document.addEventListener('input', e => { if (e.target.id === 'q') renderHint(); });
  document.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'capture') { const q = $('#q'); if (addTodo(q.value)) { q.value = ''; renderHint(); } q.focus(); }
  });
  document.addEventListener('keydown', e => {
    const t = e.target, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (e.key === 'Escape') {
      if ($('#modals').children.length) closeModal(); else if (UI.sel) closeDrawer(); else if (typing) t.blur();
      return;
    }
    if (e.key === 'Enter' && t.id === 'step-new') {
      const it = byId(UI.sel), v = t.value.trim();
      if (it && v) { it.steps.push({ id: uid(), text: v, done: false }); save(); renderDrawer(); refreshBoard(); const n = $('#step-new'); if (n) n.focus(); }
      e.preventDefault(); return;
    }
    if (e.key === 'Enter' && t.classList.contains('dtitle')) { e.preventDefault(); t.blur(); return; }
    if (e.key === 'Enter' && t.id === 'imp-keys') { e.preventDefault(); const b = $('[data-act="imp-keys"]'); if (b && !b.disabled) ACT['imp-keys'](b); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && t.id === 'cmt') { const b = $('[data-act="add-comment"]'); if (b && !b.disabled) addComment(byId(UI.sel), b); return; }
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === '/') && !$('#modals').children.length) {
      e.preventDefault();
      if (UI.view !== 'board') { UI.view = 'board'; renderMain(); }
      $('#q').focus();
    }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  window.addEventListener('pagehide', () => {
    if (saveTimer && SERVED && !loadFailed) { try { fetch('/api/data', { method: 'PUT', keepalive: true, headers: { 'X-FQ-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(S) }); } catch (e) { /* best effort */ } }
  });
  if (bc) bc.onmessage = async ev => {
    if (!ev.data || ev.data.rev === S.rev || saveTimer) return;
    try { await loadState(); renderAll(); } catch (e) { /* keep what we have */ }
  };
}
function restoreBackup(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    let data = null; try { data = JSON.parse(rd.result); } catch (e) { data = null; }
    input.value = '';
    if (!data || !Array.isArray(data.items) || !data.game) { toast('This file is not a FocusQuest backup.', { kind: 'bad' }); return; }
    confirmBox('Restore this backup?', `It replaces everything in FocusQuest with the ${data.items.length} items and ${data.game.xp || 0} XP from the file.`, 'Restore', () => {
      S = merge(defaults(), data); for (const it of S.items) { if (!it.steps) it.steps = []; }
      save(); applyTheme(); closeDrawer(); renderAll(); toast('Backup restored.');
    });
  };
  rd.readAsText(file);
}
function renderAll() { applyTheme(); renderPlayer(); renderRailFoot(); renderMain(); if (UI.sel) renderDrawer(); }

async function start() {
  wire();
  // Without the helper the data lives in browser storage only: ask the browser not to evict it.
  if (!SERVED && navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { /* optional */ } }
  try { await loadState(); }
  catch (e) {
    loadFailed = true;
    $('#main').innerHTML = `<h1 class="view-h">FocusQuest could not load your data</h1><p class="lead">${esc(e.message)}</p>
      <p class="lead">Nothing was changed. If the helper window was closed, start FocusQuest again with Start-FocusQuest.cmd. If the data file is damaged, copy the newest file from data\\backups over data\\focusquest-data.json and reload.</p>`;
    return;
  }
  renderAll();
  const q = $('#q'); if (q) q.focus();
  const t = today(), open = openItems(), over = open.filter(i => i.due && i.due < t).length, due = open.filter(i => i.due === t).length;
  if (over || due) toast(`${due ? `${due} due today` : ''}${due && over ? ', ' : ''}${over ? `${over} overdue` : ''}. Pick one and start small.`, { ttl: 6000 });
  // reminders that came up while FocusQuest was closed fire now, then every 20 seconds
  setTimeout(checkReminders, 1500);
  setInterval(tick, 20000);
  if (jiraReady()) {
    ensureMe().then(renderRailFoot).catch(() => { });
    const stale = S.items.filter(i => i.kind === 'ticket' && !i.done).map(i => i.jira.fetchedAt || 0);
    if (stale.length && (+S.settings.refreshMin || 0) > 0 && Date.now() - Math.min(...stale) > S.settings.refreshMin * 60000) setTimeout(() => refreshAll(true), 2500);
  }
}
start();
