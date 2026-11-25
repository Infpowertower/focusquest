const { chromium } = require('playwright');
const assert = require('assert');
const PORT = +process.env.FQ_PORT || 8765, JPORT = +process.env.FQ_JIRA_PORT || 8799;
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['notifications'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const dataFile = process.env.FQ_DATA || __dirname + '/data.json';
  // screenshots only when FQ_SHOTS names a folder
  const shot = n => process.env.FQ_SHOTS ? page.screenshot({ path: `${process.env.FQ_SHOTS}/shot-${n}.png` }) : null;
  let failed = 0;
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message.split('\n')[0], ((e.stack || '').match(/test\.js:\d+/) || [''])[0]); await shot('fail-' + name.replace(/\W+/g, '_')); } };
  const xp = () => page.evaluate(() => S.game.xp);
  // Drag with the mouse like a person: press, move onto the target, move again (browsers only report "dragover",
  // which allows the drop, from the second move on), release. The target is looked up again after the drag has
  // started, because rows shift when the empty priorities appear.
  const drag = async (from, to, position) => {
    await page.locator(from).hover();
    await page.mouse.down();
    const src = await page.locator(from).boundingBox();
    await page.mouse.move(src.x + src.width / 2 + 12, src.y + src.height / 2 + 12, { steps: 4 });
    const opt = position ? { position } : {};
    await page.locator(to).hover(opt);
    await page.locator(to).hover(opt);
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(60);
  };

  await page.goto(`http://localhost:${PORT}/`);
  await page.evaluate(() => { Math.random = () => 0.5; });   // no lucky doubles, so XP is predictable
  await step('loads', async () => { await page.waitForSelector('#q'); assert.equal(await page.textContent('#p-lvl'), '1'); });
  await shot('01-empty');

  await step('quick add with shortcuts', async () => {
    await page.fill('#q', 'Call vendor about the invoice !1 @tomorrow');
    assert.match(await page.textContent('#qhint'), /high priority, due tomorrow/);
    await page.press('#q', 'Enter');
    await page.fill('#q', 'Book room for sprint review @14:30'); await page.press('#q', 'Enter');
    await page.fill('#q', 'Tidy up the shared mailbox rules p3'); await page.press('#q', 'Enter');
    await page.fill('#q', 'Request scanner access for Lena'); await page.press('#q', 'Enter');
    const s = await page.evaluate(() => S.items.map(i => [i.title, i.prio, i.due, i.dueTime]));
    assert.equal(s.length, 4); assert.equal(s[0][1], 1); assert.ok(s[0][2]); assert.equal(s[1][3], '14:30'); assert.equal(s[2][1], 3);
    assert.equal(await xp(), 20);
  });
  await step('complete and undo a to-do', async () => {
    await page.click('.item:has-text("Tidy up") .check');
    await page.waitForTimeout(600);
    assert.equal(await xp(), 40);
    await page.click('[data-tab=done]');
    await page.click('.item.done .check');
    assert.equal(await xp(), 20);
    await page.click('[data-tab=open]');
    await page.click('.item:has-text("Tidy up") .check');
    await page.waitForTimeout(600);
    assert.equal(await page.textContent('#p-closed'), '1');
    assert.equal(await page.textContent('#p-created'), '4');
    assert.equal(await page.textContent('#p-comments'), '0');
  });
  await step('drawer: steps, due chips, reminder', async () => {
    await page.click('.item:has-text("Call vendor") .ibody');
    await page.fill('#step-new', 'Find the invoice number'); await page.press('#step-new', 'Enter');
    await page.fill('#step-new', 'Ring accounts payable'); await page.press('#step-new', 'Enter');
    await page.check('.steps li:first-child input');
    await page.click('[data-act=rem-q][data-q="60"]');
    const it = await page.evaluate(() => S.items[0]);
    assert.equal(it.steps.length, 2); assert.ok(it.steps[0].done); assert.ok(it.remind);
    await page.fill('#d-notes', 'Invoice 4471 was paid twice.'); await page.locator('#d-notes').blur();
  });
  await shot('02-board-todo');
  await step('reminder fires', async () => {
    await page.evaluate(() => { const it = S.items[1]; it.remind = localDT(new Date(Date.now() - 60000)); it.remFired = null; checkReminders(); });
    await page.waitForSelector('.toast.remind');
    await page.click('.toast.remind button:has-text("In 10 min")');
    assert.ok(await page.evaluate(() => new Date(S.items[1].remind) > new Date()));
  });

  await step('connect Jira', async () => {
    await page.click('[data-view=settings]');
    await page.fill('#j-url', `http://localhost:${JPORT}/`); await page.fill('#j-tok', 'wrong');
    await page.click('[data-act=jira-save]');
    await page.waitForSelector('#j-msg .err');
    assert.match(await page.textContent('#j-msg'), /did not accept the token/);
    await page.fill('#j-tok', 'testtoken'); await page.click('[data-act=jira-save]');
    await page.waitForSelector('#j-msg .okmsg');
    assert.match(await page.textContent('#j-msg'), /Alex Brandt/);
    assert.match(await page.textContent('#railfoot'), /Jira connected as Alex Brandt/);
  });
  await step('ticket setup: project, pick type and components from Jira', async () => {
    await page.fill('#fm-project', 'ops'); await page.locator('#fm-project').blur();
    await page.waitForFunction(() => S.ticketCfg.forms[0].project === 'OPS');
    await page.click('[data-act=form-types]');
    await page.check('.picklist label:has-text("Story") input');
    await page.click('#ft-ok');
    assert.equal(await page.evaluate(() => S.ticketCfg.forms[0].type), 'Story');
    await page.fill('#fm-type', 'Task'); await page.locator('#fm-type').blur();
    await page.waitForFunction(() => S.ticketCfg.forms[0].type === 'Task');
    await page.click('[data-act=fld-pick]');
    await page.waitForSelector('#pk-filter');
    for (const n of ['Dispatch', 'Mail', 'Onboarding']) await page.check(`.picklist label:has-text("${n}") input`);
    await page.click('#pk-ok');
    assert.deepEqual(await page.evaluate(() => S.ticketCfg.forms[0].fields[0].values), ['Dispatch', 'Mail', 'Onboarding']);
    await page.click('[data-act=fld-browse]');
    await page.waitForSelector('#fb-list .picklist');
    await page.click('#fb-list .pick:has-text("Site") button');
    await page.click('.overlay [data-act=modal-close]');
    const f = await page.evaluate(() => S.ticketCfg.forms[0].fields[1]);
    assert.equal(f.fieldId, 'customfield_10042'); assert.equal(f.kind, 'single-option'); assert.deepEqual(f.values, ['Berlin', 'Hamburg', 'Leipzig']);
  });
  await step('several forms: copy for another type, new form for another project', async () => {
    await page.click('[data-act=form-dup]');
    await page.fill('#fm-name', 'Service request'); await page.locator('#fm-name').blur();
    await page.fill('#fm-type', 'Service Request'); await page.locator('#fm-type').blur();
    await page.waitForFunction(() => S.ticketCfg.forms.length === 2 && S.ticketCfg.forms[1].type === 'Service Request');
    await page.click('[data-act=form-add]');
    await page.fill('#fm-project', 'hr'); await page.locator('#fm-project').blur();
    await page.waitForFunction(() => S.ticketCfg.forms.length === 3 && S.ticketCfg.forms[2].project === 'HR');
    const c = await page.evaluate(() => S.ticketCfg);
    assert.equal(c.forms[1].fields.length, 2, 'copy keeps the fields'); assert.equal(c.forms[2].fields.length, 0);
    assert.equal(c.defaultForm, c.forms[0].id);
    // the settings are redrawn a moment after the change
    await page.waitForFunction(() => /Task in OPS\s*default.*Service request.*Task in HR/s.test(document.querySelector('#form-tabs').textContent));
    // switching the edited form shows its own values
    await page.check('#form-tabs label:has-text("Service request") input');
    assert.equal(await page.inputValue('#fm-type'), 'Service Request');
  });
  await shot('03b-forms');
  await shot('03-settings');

  await step('import: assigned to me + by key', async () => {
    await page.click('[data-view=board]');
    await page.click('[data-act=import]');
    await page.waitForSelector('.imp-c');
    assert.equal(await page.locator('.imp-c').count(), 4);
    await shot('04-import');
    await page.check('#imp-all');
    await page.click('#imp-sel-btn');
    await page.waitForSelector('.item .key');
    assert.equal(await page.evaluate(() => S.items.filter(i => i.kind === 'ticket').length), 4);
    await page.click('[data-act=import]');
    await page.fill('#imp-keys', `http://localhost:${JPORT}/browse/OPS-105, ops-999`);
    await page.click('[data-act=imp-keys]');
    await page.waitForSelector('#imp-err .err');
    assert.match(await page.textContent('#imp-err'), /Imported OPS-105.*OPS-999/);
    await page.click('.overlay [data-act=modal-close]');
    assert.equal(await page.evaluate(() => S.items.filter(i => i.kind === 'ticket').length), 5);
  });
  await step('ticket details are limited and sanitized', async () => {
    await page.click('.item:has-text("TLS certificate") .ibody');
    await page.waitForSelector('#tr-area .btn');
    const html = await page.innerHTML('#drawer');
    assert.ok(!/<script|onerror|javascript:/i.test(html), 'unsafe html leaked');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.match(await page.textContent('.facts'), /Assignee\s*Alex Brandt\s*Author\s*Priya Nair/);
    assert.match(await page.getAttribute('.rich a[href*="OPS-101"]', 'href'), new RegExp(`^http://localhost:${JPORT}/browse/OPS-101$`));
  });
  await step('comment', async () => {
    const before = await xp();
    await page.fill('#cmt', 'Certificate ordered, waiting for the CA.');
    await page.click('[data-act=add-comment]');
    await page.waitForSelector('.cmt');
    assert.equal(await xp(), before + 20);
    assert.match(await page.textContent('.cmt'), /Alex Brandt.*Certificate ordered/s);
    // after a comment FocusQuest asks for the time spent
    await page.waitForSelector('#at-val');
    assert.match(await page.textContent('.overlay .modal'), /Time on OPS-103/);
    await page.click('[data-act=at-pick][data-min="30"]');
    await page.waitForSelector('.toast:has-text("30 min booked on OPS-103")');
    assert.deepEqual(await page.evaluate(() => S.time.log.map(e => [e.key, e.min, e.day === today(), e.wl])), [['OPS-103', 30, true, null]]);
  });
  await step('time on a ticket: quick add, timer, own amount, work log in Jira', async () => {
    await page.click('[data-act=tt-add][data-min="15"]');
    assert.match(await page.textContent('#tt-sect'), /45 min booked/);
    await page.click('[data-act=tt-start]');
    await page.waitForSelector('.conn.tkt:has-text("OPS-103")');
    await page.evaluate(() => { S.time.ticket.start -= 20 * 60000; });
    await page.click('[data-act=tt-stop]');
    await page.waitForSelector('.toast:has-text("20 min booked on OPS-103")');
    assert.match(await page.textContent('#tt-sect'), /1 h 5 min booked/);
    assert.equal(await page.locator('.conn.tkt').count(), 0);
    await page.click('[data-act=tt-other]');
    await page.fill('#at-val', 'soon'); await page.click('[data-act=at-save]');
    assert.match(await page.textContent('#at-err'), /Write the time like/);
    await page.fill('#at-val', '1:30'); await page.fill('#at-note', 'Checked the chain');
    await page.check('#at-jira');
    await page.press('#at-val', 'Enter');
    await page.waitForFunction(() => S.time.log.some(e => e.min === 90 && e.wl));
    const wl = await page.evaluate(() => jira('GET', 'rest/api/2/issue/OPS-103/worklog'));
    assert.equal(wl.worklogs.length, 1, 'only the entry that asked for it went to Jira');
    assert.equal(wl.worklogs[0].timeSpentSeconds, 5400); assert.equal(wl.worklogs[0].comment, 'Checked the chain');
    assert.match(wl.worklogs[0].started, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000[+-]\d{4}$/);
    assert.equal(await page.evaluate(() => ticketMinutes('OPS-103')), 155);
  });
  await step('transition to in progress', async () => {
    const before = await xp();
    await page.click('#tr-area button:has-text("Start progress")');
    await page.click('[data-act=do-transition]');
    await page.waitForSelector('#drawer .st:has-text("In Progress")');
    assert.equal(await xp(), before + 15);
  });
  await shot('05-ticket-drawer');
  await step('close ticket with resolution', async () => {
    const before = await xp();
    await page.click('.item:has-text("TLS certificate") .check');
    await page.waitForSelector('[data-trf=resolution]');
    await page.fill('#tr-cmt', 'New certificate installed.');
    await shot('06-close-dialog');
    await page.click('[data-act=do-transition]');
    await page.waitForSelector('.cheer');
    await page.waitForTimeout(400);
    await shot('07-celebration');
    await page.waitForSelector('#at-val');                  // the closing comment counts as a comment too
    await page.click('.overlay [data-act=modal-close]');
    assert.equal(await xp(), before + 20 + 120);
    assert.ok(await page.evaluate(() => ticketByKey('OPS-103').done));
    await page.waitForTimeout(3000);
  });
  await step('create ticket from to-do: required field, template, conversion', async () => {
    await page.click('[data-act=close-drawer]');
    await page.click('.item:has-text("Call vendor") .ibody');
    await page.click('[data-act=to-ticket]');
    await page.waitForSelector('#tf-summary');
    assert.equal(await page.inputValue('#tf-summary'), 'Call vendor about the invoice');
    assert.match(await page.inputValue('#tf-desc'), /Invoice 4471[\s\S]*\* Find the invoice number/);
    assert.match(await page.textContent('#tf-where'), /Creates a Task in OPS/);
    await page.click('[data-act=tf-create]');
    assert.match(await page.textContent('#tf-err'), /Components is required/);
    await page.selectOption('#tf-form', { label: 'Task in HR' });
    assert.match(await page.textContent('#tf-where'), /Creates a Task in HR/);
    assert.equal(await page.locator('.modal [data-f]').count(), 0, 'HR form has no extra fields');
    await page.selectOption('#tf-form', { label: 'Service request' });
    assert.match(await page.textContent('#tf-where'), /Creates a Service Request in OPS/);
    assert.equal(await page.inputValue('#tf-summary'), 'Call vendor about the invoice', 'text survives a form change');
    await page.check('.modal label.chip:has-text("Dispatch") input');
    await page.selectOption('[data-f]:is(select)', 'Hamburg');
    await page.click('[data-act=tf-as-tpl]');
    await page.fill('#tf-name', 'Vendor request');
    await page.fill('#tf-summary', 'Vendor: {title}');
    await page.click('[data-act=tf-save]');
    await page.waitForSelector('#tf-tpl');
    await page.selectOption('#tf-form', { label: 'Task in HR' });
    await page.selectOption('#tf-tpl', { label: 'Vendor request' });
    assert.equal(await page.inputValue('#tf-form'), await page.evaluate(() => S.ticketCfg.forms[1].id), 'template brings its form');
    assert.ok(await page.isChecked('.modal label.chip:has-text("Dispatch") input'), 'template fills the fields');
    assert.equal(await page.inputValue('#tf-summary'), 'Vendor: Call vendor about the invoice');
    await shot('08-create-ticket');
    await page.click('[data-act=tf-create]');
    await page.waitForSelector('#drawer .key');
    const it = await page.evaluate(() => S.items[0]);
    assert.equal(it.kind, 'ticket'); assert.equal(it.prio, 1); assert.match(it.jira.key, /^OPS-2/); assert.equal(it.jira.type, 'Service Request');
  });
  await step('ticket in a second project', async () => {
    await page.click('[data-act=close-drawer]');
    await page.click('[data-act=new-ticket]');
    await page.waitForSelector('#tf-summary');
    await page.selectOption('#tf-form', { label: 'Task in HR' });
    await page.fill('#tf-summary', 'Update the leave policy page');
    await page.click('[data-act=tf-create]');
    await page.waitForSelector('#drawer .key:has-text("HR-")');
    const it = await page.evaluate(() => S.items[S.items.length - 1]);
    assert.match(it.jira.key, /^HR-2/); assert.equal(it.jira.type, 'Task');
    const st = await page.evaluate(() => statsOf(dayRec().n));
    assert.deepEqual(st, { created: 6, closed: 2, comments: 2 });
    assert.equal(await page.textContent('#p-comments'), '2');
  });
  await step('sub-tickets: epic cannot be closed, its tickets open from the list', async () => {
    await page.click('[data-act=close-drawer]');
    await page.click('[data-act=import]');
    await page.fill('#imp-keys', 'OPS-110'); await page.click('[data-act=imp-keys]');
    await page.waitForFunction(() => !!ticketByKey('OPS-110'));
    await page.click('.overlay [data-act=modal-close]');
    const row = '.item:has-text("warehouse scanners")';
    assert.match(await page.textContent(row), /1 of 2 sub-tickets done/);
    assert.ok(await page.evaluate(() => nowItem().jira ? nowItem().jira.key !== 'OPS-110' : true), 'an epic with open tickets is not suggested as next');
    await page.click(row + ' .check.hold');
    await page.waitForSelector('.toast:has-text("OPS-110 has 1 open sub-ticket")');
    assert.equal(await page.locator('[data-trf]').count(), 0, 'no close dialog');
    await page.click(row + ' .ibody');
    await page.waitForSelector('#tr-area .help:has-text("can be closed when they are done")');
    assert.equal(await page.locator('#tr-area button:has-text("Done")').count(), 0);
    assert.match(await page.textContent('#kids-sect'), /Tickets in this epic\s*1 open.*OPS-111.*not on my board/s);
    assert.equal(await page.locator('#kids-sect .kid').count(), 1, 'the done one is hidden');
    await page.click('[data-act=kids-toggle]:has-text("Show 1 done")');
    assert.match(await page.textContent('#kids-sect'), /OPS-111.*OPS-112.*Hide the done ones/s);
    await page.click('[data-act=kids-toggle]');
    assert.equal(await page.locator('#kids-sect .kid').count(), 1);
    assert.equal(await page.locator('#drawer [data-act=new-subtask]').count(), 0);
    await shot('14-epic');
    await page.click('.kid:has-text("OPS-111")');
    await page.waitForSelector('#drawer a.key:has-text("OPS-111")');
    assert.match(await page.textContent('#drawer'), /Part of\s*OPS-110 Roll out/);
    await page.waitForSelector('#tr-area .btn');
    await page.click('#tr-area button:has-text("Done")');
    await page.click('[data-act=do-transition]');
    await page.waitForSelector('.toast:has-text("All sub-tickets of OPS-110 are done")');
    assert.equal(await page.evaluate(() => holdsOpen(ticketByKey('OPS-110'))), false);
    await page.waitForTimeout(3000);
  });
  await step('sub-tickets: create a sub-task and a ticket in an epic from the app', async () => {
    await page.click('[data-act=close-drawer]');
    await page.click('.item:has-text("mailbox quota") .ibody');
    await page.waitForSelector('#kids-sect .kid:has-text("OPS-106")');
    await page.click('[data-act=new-subtask]');
    await page.waitForSelector('#tf-parent');
    assert.equal(await page.inputValue('#tf-parent'), 'OPS-102');
    assert.match(await page.textContent('#tf-where'), /Creates a Sub-task in OPS/);
    assert.ok(await page.evaluate(() => S.ticketCfg.forms.some(f => f.project === 'OPS' && f.type === 'Sub-task' && f.subtask)), 'a sub-task form was added');
    await page.fill('#tf-summary', 'Check the quota report');
    await page.click('[data-act=tf-create]');
    await page.waitForSelector('#drawer h2:has-text("Check the quota report")');
    assert.match(await page.textContent('#drawer'), /Part of\s*OPS-102 Raise mailbox quota/);
    await page.waitForFunction(() => kids(ticketByKey('OPS-102').jira).length === 2);
    // "only ask for Change Requests and their sub-tasks"
    const ask = await page.evaluate(() => {
      const sub = S.items.find(i => i.jira && i.jira.summary === 'Check the quota report'), cr = ticketByKey('OPS-102'), task = ticketByKey('OPS-103');
      S.settings.timeAskTypes = ['change request'];
      const a = [asksTime(cr), asksTime(sub), asksTime(task)];
      S.settings.timeAskSubs = false; a.push(asksTime(sub));
      S.settings.timeAsk = false; a.push(asksTime(cr));
      S.settings.timeAskTypes = []; S.settings.timeAskSubs = true; S.settings.timeAsk = true; a.push(asksTime(task));
      return a;
    });
    assert.deepEqual(ask, [true, true, false, false, false, true]);
    // a ticket inside the epic needs the "Epic Link" field in the form
    await page.click('[data-act=close-drawer]');
    await page.click('.item:has-text("warehouse scanners") .ibody');
    await page.click('[data-act=new-in-epic]');
    await page.waitForSelector('#tf-summary');
    assert.match(await page.textContent('.overlay .modal'), /This form has no "Epic Link" field/);
    await page.click('.overlay [data-act=modal-close]');
    await page.evaluate(() => { S.ticketCfg.forms[0].fields.push({ uid: 'f_epic', label: 'Epic Link', fieldId: 'customfield_10100', kind: 'text', values: [], required: false, def: '' }); save(); });
    await page.click('[data-act=new-in-epic]');
    await page.waitForSelector('#tf-summary');
    assert.match(await page.textContent('.overlay .modal'), /It is added to the epic OPS-110/);
    assert.equal(await page.inputValue('[data-f="f_epic"]'), 'OPS-110');
    await page.fill('#tf-summary', 'Label the charging stations');
    await page.check('.modal label.chip:has-text("Dispatch") input');
    await page.click('[data-act=tf-create]');
    await page.waitForSelector('#drawer h2:has-text("Label the charging stations")');
    await page.waitForFunction(() => kids(ticketByKey('OPS-110').jira).length === 3 && holdsOpen(ticketByKey('OPS-110')));
    await page.waitForFunction(() => /Part of\s*OPS-110/.test(document.querySelector('#drawer').textContent));
  });
  await step('order by hand: drag within a priority, into another priority, with the keyboard', async () => {
    await page.click('[data-act=close-drawer]');
    const order = p => page.evaluate(p => viewOpen().filter(i => i.prio === p).sort(cmpPrio).map(i => itemTitle(i)), p);
    const before = await order(2);
    assert.ok(before.length >= 3, 'needs three medium rows');
    const row = t => `#list .item:has(.title:text-is("${t}"))`;
    // the last medium row goes to the top of medium
    await drag(row(before[before.length - 1]) + ' .ibody', row(before[0]), { x: 200, y: 4 });
    let now = await order(2);
    assert.equal(now[0], before[before.length - 1]); assert.equal(now[1], before[0]);
    assert.deepEqual(await page.$$eval('#list .group[data-prio="2"] .item .title', els => els.map(e => e.textContent)), now, 'the list shows the new order');
    // a row dropped below a high-priority row becomes high priority
    const high = await order(1), moved = now[now.length - 1];
    await drag(row(moved) + ' .ibody', row(high[0]), { x: 200, y: 40 });
    assert.deepEqual((await order(1)).slice(0, 2), [high[0], moved]);
    assert.equal(await page.evaluate(t => S.items.find(i => itemTitle(i) === t).prio, moved), 1);
    // low priority is empty and only shows while dragging; dropping there works too
    assert.equal(await page.locator('#list .group[data-prio="3"]').isVisible(), false);
    await drag(row(moved) + ' .ibody', '#list .group[data-prio="3"] .items');
    assert.equal(await page.locator('#list .group[data-prio="3"]').isVisible(), true);
    assert.equal(await page.evaluate(t => S.items.find(i => itemTitle(i) === t).prio, moved), 3);
    // keyboard: Alt + arrow up moves it to the end of medium
    await page.focus(row(moved) + ' .ibody');
    await page.keyboard.press('Alt+ArrowUp');
    now = await order(2);
    assert.equal(now[now.length - 1], moved);
    await page.keyboard.press('Alt+ArrowUp');
    assert.equal((await order(2))[now.length - 2], moved);
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('ibody')), 'the row keeps the keyboard focus');
  });
  await step('contexts: create, carousel, add with #name, drag onto a context, set in the details', async () => {
    assert.equal(await page.locator('#ctxbar').count(), 0, 'no carousel before the first context');
    await page.click('.toolbar [data-act=ctx-new]');
    await page.fill('#cx-name', 'Web shop'); await page.press('#cx-name', 'Enter');
    await page.waitForSelector('#ctxbar .ctx.on:has-text("Web shop")');
    assert.match(await page.textContent('#now'), /Nothing is waiting in Web shop/);
    assert.equal(await page.locator('#list .item').count(), 0);
    const shop = await page.evaluate(() => S.contexts[0].id);
    // a new to-do lands in the open context; #name picks or creates another one
    await page.fill('#q', 'Design the banner'); await page.press('#q', 'Enter');
    await page.fill('#q', 'Renew the wildcard certificate #infra-team !1');
    assert.match(await page.textContent('#qhint'), /in the new context "infra team"/);
    await page.press('#q', 'Enter');
    await page.waitForSelector('.toast:has-text("Added to infra team")');
    await page.fill('#q', 'Check the checkout flow #web-shop');
    assert.match(await page.textContent('#qhint'), /in Web shop/);
    await page.press('#q', 'Enter');
    assert.deepEqual(await page.evaluate(() => S.contexts.map(c => [c.name, S.items.filter(i => i.ctx === c.id).map(i => i.title).sort().join('|')])),
      [['Web shop', 'Check the checkout flow|Design the banner'], ['infra team', 'Renew the wildcard certificate']]);
    assert.match(await page.textContent('#ctxbar'), /Everything\s*\d+ open.*Web shop\s*2 open.*infra team\s*1 open.*No context\s*\d+ open/s);
    assert.equal(await page.locator('#list .item').count(), 2, 'only the open context is listed');
    assert.match(await page.textContent('#now h2'), /Design the banner|Check the checkout flow/);
    await shot('16-contexts');
    // drag a row from "Everything" onto a context
    await page.click('#ctxbar .ctx[data-ctx=all] .ctx-main');
    await drag('#list .item:has-text("Book room for sprint review") .ibody', `#ctxbar .ctx[data-ctx="${shop}"]`);
    await page.waitForSelector('.toast:has-text("Moved to Web shop")');
    assert.equal(await page.evaluate(() => S.items.find(i => i.title === 'Book room for sprint review').ctx), shop);
    // and back out again by dropping it on "No context"
    await drag('#list .item:has-text("Book room for sprint review") .ibody', '#ctxbar .ctx[data-ctx=none]');
    assert.equal(await page.evaluate(() => S.items.find(i => i.title === 'Book room for sprint review').ctx), null);
    // in the details: for a to-do and for a ticket, also with a context that does not exist yet
    await page.click('#list .item:has-text("Book room for sprint review") .ibody');
    await page.selectOption('#d-ctx', { label: 'infra team' });
    assert.equal(await page.evaluate(() => ctxById(S.items.find(i => i.title === 'Book room for sprint review').ctx).name), 'infra team');
    await page.click('#list .item:has-text("mailbox quota") .ibody');
    await page.click('#drawer details.plan summary');
    await page.selectOption('#d-ctx', '__new');
    await page.fill('#cx-name', 'Mail'); await page.click('#cx-ok');
    await page.waitForFunction(() => { const c = ctxByName('Mail'); return c && ticketByKey('OPS-102').ctx === c.id; });
    // a sub-ticket opened from a ticket joins that ticket's context
    await page.click('#kids-sect .kid:has-text("OPS-106")');
    await page.waitForSelector('#drawer a.key:has-text("OPS-106")');
    assert.equal(await page.evaluate(() => ctxById(ticketByKey('OPS-106').ctx).name), 'Mail');
    // rename and delete
    await page.click('[data-act=close-drawer]');
    await page.click(`#ctxbar .ctx[data-ctx="${shop}"] .ctx-main`);
    await page.click('#ctxbar .ctx.on .ctx-edit');
    await page.fill('#cx-name', 'Mail'); await page.click('#cx-ok');
    assert.match(await page.textContent('#cx-err'), /already a context "Mail"/);
    await page.fill('#cx-name', 'Shop'); await page.click('#cx-ok');
    await page.waitForSelector('#ctxbar .ctx.on:has-text("Shop")');
    await page.click('#ctxbar .ctx.on .ctx-edit');
    await page.click('#cx-del'); await page.click('#cf-ok');
    assert.deepEqual(await page.evaluate(() => [S.contexts.map(c => c.name), S.settings.ctx, S.items.filter(i => i.title === 'Design the banner')[0].ctx]), [['infra team', 'Mail'], 'all', null]);
    await page.waitForTimeout(600); await page.evaluate(() => flush());
    await page.reload(); await page.waitForSelector('#ctxbar');
    assert.equal(await page.evaluate(() => S.contexts.length), 2);
  });
  await step('refresh shows activity by others', async () => {
    if (await page.locator('[data-act=close-drawer]').count() === 0) await page.click('.item:has-text("mailbox quota") .ibody');
    await page.click('[data-act=close-drawer]');
    await fetch(`http://localhost:${JPORT + 1}/`);
    await page.click('#refall');
    await page.waitForSelector('.item:has-text("mailbox quota") .fresh');
  });
  await step('data survives reload', async () => {
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => S.items.length), x = await xp();
    await page.reload(); await page.waitForSelector('#q');
    assert.equal(await page.evaluate(() => S.items.length), n); assert.equal(await xp(), x);
    assert.ok(require('fs').existsSync(dataFile));
    const raw = require('fs').readFileSync(dataFile, 'utf8');
    assert.ok(!raw.includes('testtoken'), 'token must not be in the data file');
  });
  await step('working time: starts by itself, stop and start, PC restart, sleep', async () => {
    const awake = t => page.evaluate(t => api('POST', '/api/test/awake', { t: new Date(t).toISOString() }), t);
    assert.match(await page.textContent('#t-state'), /today, since \d\d:\d\d/);
    assert.ok(await page.evaluate(() => !!S.time.open && S.time.autoFor !== ''), 'tracking started when the app started');
    await page.click('#t-toggle');
    assert.match(await page.textContent('#t-state'), /today, not tracking/);
    assert.equal(await page.textContent('#t-toggle'), 'Start');
    await page.evaluate(() => flush());
    await page.reload(); await page.waitForSelector('#q'); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => S.time.open), null, 'a manual stop holds while the PC stays on');
    // the PC starts again: tracking starts by itself, at the moment the PC came up
    const up = Date.now() - 2 * 60000;
    await page.evaluate(() => { S.time.beat = Date.now() - 10 * 60000; save(); return flush(); });   // as if the stop was ten minutes ago
    await awake(up);
    await page.reload(); await page.waitForSelector('#q');
    await page.waitForFunction(() => !!S.time.open);
    assert.ok(Math.abs(await page.evaluate(() => S.time.open.start) - up) < 1500);
    // the PC was switched off without stopping: the period ends at the last sign of life, a new one starts
    const now = Date.now();
    await page.evaluate(n => { S.time.spans = []; S.time.open = { start: n - 90 * 60000 }; S.time.beat = n - 30 * 60000; save(); return flush(); }, now);
    await awake(now - 5 * 60000);
    await page.reload(); await page.waitForSelector('#q');
    await page.waitForFunction(n => S.time.open && S.time.open.start > n - 6 * 60000, now);
    const total = await page.evaluate(() => S.time.spans.reduce((x, p) => x + p.e - p.s, 0));
    assert.ok(total >= 59 && total <= 61, 'the old period ends at the last sign of life, got ' + total);
    // the tab was closed for a while but the PC stayed on: the period simply goes on
    const keep = await page.evaluate(n => { S.time.spans = []; S.time.open = { start: n - 90 * 60000 }; S.time.beat = n - 30 * 60000; save(); return flush().then(() => S.time.open.start); }, Date.now());
    await awake(Date.now() - 3 * 3600000);                 // the helper has been awake for three hours
    await page.reload(); await page.waitForSelector('#q');
    await page.waitForFunction(() => Date.now() - S.time.beat < 5000);
    assert.equal(await page.evaluate(() => S.time.open.start), keep);
    assert.equal(await page.evaluate(() => S.time.spans.length), 0);
    assert.match(await page.textContent('#t-today'), /1 h 3\d min|^\d+ min$/);   // 90 minutes unless midnight is in between
  });
  await step('time view: hours per day, correct a day', async () => {
    const yd = await page.evaluate(() => {
      const d = dstr(addDays(new Date(), -1)), it = ticketByKey('OPS-103');
      S.time.spans.push({ id: 'y1', day: d, s: 480, e: 720 });
      S.time.log.push({ id: 'l1', itemId: it.id, key: 'OPS-103', summary: it.jira.summary, day: d, min: 30, note: '', at: Date.now(), wl: null });
      save(); return d;
    });
    await page.click('[data-view=time]');
    const row = `.dayrow[data-day="${yd}"]`;
    assert.match(await page.textContent(row), /4 h\s*08:00\u201312:00\s*On tickets: OPS-103 30 min/);
    assert.match(await page.textContent('.dayrow.today'), /\u2013now/);
    await page.click(row + ' [data-act=day-edit]');
    await page.fill('.sp-e', '12:30');
    await page.click('[data-act=sp-add]');
    assert.deepEqual(await page.$$eval('.row.sp input', els => els.map(e => e.value)), ['08:00', '12:30', '12:30', '13:30']);
    await page.fill('.row.sp:nth-of-type(2) .sp-s', '12:00');
    await page.fill('.lg-min', '1:15');
    await page.click('[data-act=day-save]');
    assert.match(await page.textContent('#de-err'), /overlap/);
    await page.fill('.row.sp:nth-of-type(2) .sp-s', '13:00'); await page.fill('.row.sp:nth-of-type(2) .sp-e', '17:00');
    await page.click('[data-act=day-save]');
    await page.waitForFunction(() => !document.querySelector('.overlay'));
    assert.match(await page.textContent(row), /8 h 30 min\s*08:00\u201312:30, 13:00\u201317:00\s*On tickets: OPS-103 1 h 15 min/);
    assert.equal(await page.evaluate(d => workedOn(d), yd), 510);
    await shot('15-time');
    // autostart with Windows is a switch that the helper carries out
    await page.click('[data-view=settings]');
    await page.check('#s-autostart');
    await page.waitForFunction(() => meta.autostart === true);
    await page.uncheck('#s-autostart');
    await page.waitForFunction(() => meta.autostart === false);
    await page.fill('#s-tat', 'Change Request, Incident'); await page.locator('#s-tat').blur();
    assert.deepEqual(await page.evaluate(() => S.settings.timeAskTypes), ['Change Request', 'Incident']);
    await page.fill('#s-tat', ''); await page.locator('#s-tat').blur();
    await page.click('[data-view=board]');
  });
  await step('diagnostics: the log in the app', async () => {
    await page.evaluate(() => fetchIssue('OPS-999').catch(() => toast('Test problem for the log', { kind: 'bad' })));
    await page.waitForSelector('.toast.bad:has-text("Test problem")');
    await page.click('[data-view=settings]');
    await page.click('[data-act=diag]');
    await page.waitForFunction(() => /What the helper did/.test((document.querySelector('#dg-text') || {}).value || ''));
    const log = await page.inputValue('#dg-text');
    assert.match(log, /Page version: 1\.0\.0\s+Helper version: 1\.0\.0\s+Mode: helper/);
    assert.match(log, /jira POST rest\/api\/2\/issue\/OPS-103\/comment -> 201/);
    assert.match(log, /jira GET rest\/api\/2\/issue\/OPS-999 -> 404/);
    assert.match(log, /shown to you: Test problem for the log/);
    assert.match(log, /page opened[\s\S]*page opened/, 'the log survives a reload');
    assert.match(log, /FocusQuest helper \(test stand-in\) starting/);
    assert.ok(!/testtoken|devsecret|localhost:8799|Certificate ordered|TLS certificate/i.test(log.replace(/Renew the wildcard certificate/g, '')), 'no token, no Jira address, no ticket texts');
    await page.click('[data-act=diag-copy]');
    await page.waitForSelector('[data-act=diag-copy]:has-text("Copied")');
    await page.click('.overlay [data-act=modal-close]');
    await page.click('[data-view=board]');
  });
  await step('new files but the old helper is still running: said plainly, fixed with one click', async () => {
    // files of 1.0.5 on disk, a helper from before the autostart switch still running
    await page.evaluate(() => api('POST', '/api/test/page-version', { v: '1.0.5', old: true }));
    await page.reload(); await page.waitForSelector('#q');
    assert.match(await page.textContent('#railfoot'), /The helper is still version 1\.0\.0\. Restart it/);
    await page.click('[data-view=settings]');
    await page.check('#s-autostart');
    await page.waitForSelector('.toast.bad:has-text("older than this page")');
    assert.equal(await page.isChecked('#s-autostart'), false);
    await Promise.all([page.waitForNavigation({ timeout: 20000 }), page.click('#railfoot [data-act=helper-restart]')]);
    await page.waitForSelector('#q');
    assert.equal(await page.evaluate(() => meta.version), '1.0.5');
    assert.equal(await page.locator('#railfoot [data-act=helper-restart]').count(), 0);
    // the other way round: an old page in a tab, a newer helper running
    await page.evaluate(() => api('POST', '/api/test/page-version', { v: '1.0.4' }));
    await page.reload(); await page.waitForSelector('#q');
    assert.match(await page.textContent('#railfoot'), /FocusQuest 1\.0\.5 is running\. Reload this page/);
    await page.evaluate(() => api('POST', '/api/test/page-version', { v: '' }));
    await page.reload(); await page.waitForSelector('#q');
    assert.equal(await page.locator('#railfoot .conn.bad').count(), 0);
  });
  await step('update: quiet notice, notes, install, restart', async () => {
    await page.waitForSelector('.conn.upd');               // found by the automatic check after the start
    await page.click('[data-view=settings]');
    assert.match(await page.textContent('#upd-state'), /You have version 1\.0\.5\. Version 1\.1\.0 is available/);
    // a check that fails is one quiet line, nothing else
    await page.route('**/api/update/check*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, available: false, current: '1.0.5', latest: '', notes: '', message: 'GitHub could not be reached: test', checkedAt: new Date().toISOString() }) }));
    await page.click('[data-act=update-check]');
    await page.waitForFunction(() => /did not work\. GitHub could not be reached/.test(document.querySelector('#upd-state').textContent));
    assert.equal(await page.locator('.conn.upd, .toast.bad').count(), 0);
    await page.unroute('**/api/update/check*');
    await page.click('[data-act=update-check]');
    await page.waitForSelector('.conn.upd');
    assert.match(await page.textContent('#railfoot'), /Version 1\.1\.0 is available/);
    await page.click('.conn.upd');
    const txt = await page.textContent('.overlay .modal');
    assert.match(txt, /FocusQuest 1\.1\.0 is available/); assert.match(txt, /You have version 1\.0\.5\. Published 20 November 2026/);
    assert.match(txt, /Ticket forms for several projects/); assert.ok(!/Download the zip/.test(txt), 'install instructions are left out');
    await shot('13-update');
    const n = await page.evaluate(() => S.items.length);
    await Promise.all([page.waitForNavigation(), page.click('[data-act=update-apply]')]);
    await page.waitForSelector('#q');
    await page.waitForSelector('.toast:has-text("FocusQuest 1.1.0 is installed")');
    assert.equal(await page.evaluate(() => meta.version), '1.1.0');
    assert.equal(await page.evaluate(() => S.items.length), n);
    await page.waitForFunction(() => UPD && UPD.ok);
    assert.equal(await page.locator('.conn.upd').count(), 0);
    // the automatic check can be switched off
    await page.click('[data-view=settings]');
    assert.match(await page.textContent('#upd-state'), /You have version 1\.1\.0\. That is the newest one/);
    await page.uncheck('input[data-path="settings.updateCheck"]');
    await page.waitForTimeout(500);
    await page.reload(); await page.waitForSelector('#q');
    await page.waitForTimeout(3600);
    assert.equal(await page.evaluate(() => UPD), null, 'no check when switched off');
    await page.click('[data-view=board]');
  });
  await shot('09-board-full');
  await page.click('[data-view=rewards]'); await shot('10-rewards');
  await page.evaluate(() => { S.settings.theme = 'dark'; applyTheme(); }); await page.click('[data-view=board]');
  await page.click('.item:has-text("onboarding checklist") .ibody'); await page.waitForSelector('#tr-area .row'); await shot('11-dark');
  await page.setViewportSize({ width: 420, height: 800 }); await page.click('[data-act=close-drawer]'); await shot('12-mobile');
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  if (failed) { console.log(failed + ' step(s) failed'); process.exit(1); }
})().catch(e => { console.error('CRASH', e); process.exit(1); });
