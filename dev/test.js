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
  const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { failed++; console.log('FAIL', name, '\n     ', e.message.split('\n')[0]); await shot('fail-' + name.replace(/\W+/g, '_')); } };
  const xp = () => page.evaluate(() => S.game.xp);

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
  await step('refresh shows activity by others', async () => {
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
  await step('update: quiet notice, notes, install, restart', async () => {
    await page.waitForSelector('.conn.upd');               // found by the automatic check after the start
    await page.click('[data-view=settings]');
    assert.match(await page.textContent('#upd-state'), /You have version 1\.0\.0\. Version 1\.1\.0 is available/);
    // a check that fails is one quiet line, nothing else
    await page.route('**/api/update/check*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, available: false, current: '1.0.0', latest: '', notes: '', message: 'GitHub could not be reached: test', checkedAt: new Date().toISOString() }) }));
    await page.click('[data-act=update-check]');
    await page.waitForFunction(() => /did not work\. GitHub could not be reached/.test(document.querySelector('#upd-state').textContent));
    assert.equal(await page.locator('.conn.upd, .toast.bad').count(), 0);
    await page.unroute('**/api/update/check*');
    await page.click('[data-act=update-check]');
    await page.waitForSelector('.conn.upd');
    assert.match(await page.textContent('#railfoot'), /Version 1\.1\.0 is available/);
    await page.click('.conn.upd');
    const txt = await page.textContent('.overlay .modal');
    assert.match(txt, /FocusQuest 1\.1\.0 is available/); assert.match(txt, /You have version 1\.0\.0\. Published 20 November 2026/);
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
  await page.click('.item:has-text("onboarding checklist") .ibody'); await page.waitForSelector('#tr-area .btn'); await shot('11-dark');
  await page.setViewportSize({ width: 420, height: 800 }); await page.click('[data-act=close-drawer]'); await shot('12-mobile');
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  if (failed) { console.log(failed + ' step(s) failed'); process.exit(1); }
})().catch(e => { console.error('CRASH', e); process.exit(1); });
