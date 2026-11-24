const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  // 1) opened directly as a file: to-dos work, Jira is off
  await page.goto('file://' + __dirname + '/../app.html'); await page.waitForSelector('#q');
  assert.ok(await page.isVisible('.banner'));
  await page.fill('#q', 'Standalone check @fri'); await page.press('#q', 'Enter');
  await page.click('[data-act=import]'); await page.waitForSelector('.toast.bad');
  await page.reload(); await page.waitForSelector('.item');
  assert.equal(await page.evaluate(() => S.items.length), 1);
  // working time is tracked without the helper too
  await page.waitForFunction(() => !!S.time.open);
  assert.match(await page.textContent('#t-state'), /today, since/);
  await page.click('#t-toggle');
  assert.equal(await page.evaluate(() => S.time.open), null);
  await page.reload(); await page.waitForSelector('.item'); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => S.time.open), null, 'stays stopped in the same browser session');
  console.log('ok   standalone mode');
  // 2) statistics + streak + three completions in one day
  await page.evaluate(() => { Math.random = () => 0.5; });
  for (const t of ['a', 'b', 'c']) { await page.fill('#q', 'Thing ' + t); await page.press('#q', 'Enter'); }
  for (let i = 0; i < 3; i++) { await page.click('.item:not(.done) .check'); await page.waitForTimeout(500); }
  await page.waitForTimeout(1200);
  const g = await page.evaluate(() => ({ done: dayRec().done, stats: statsOf(dayRec().n), streak: streakNow(), badges: Object.keys(S.game.badges), xp: S.game.xp }));
  assert.equal(g.done, 3); assert.equal(g.streak, 1); assert.ok(g.badges.includes('hat') && g.badges.includes('first') && !g.badges.includes('goal'));
  assert.deepEqual(g.stats, { created: 4, closed: 3, comments: 0 });
  assert.equal(await page.evaluate(() => S.game.counts.goal), undefined, 'no bonus for a daily goal');
  assert.equal(await page.textContent('#p-closed'), '3'); assert.equal(await page.textContent('#p-created'), '4');
  assert.equal(await page.locator('#p-done, #p-dots, #s-goal').count(), 0);
  // undoing a to-do takes it out of the statistics again
  await page.click('[data-tab=done]'); await page.click('.item.done .check');
  assert.equal(await page.textContent('#p-closed'), '2');
  await page.click('[data-tab=open]');
  console.log('ok   statistics, streak, badges', JSON.stringify(g));
  // 3) weekend does not break the streak (Fri -> Mon), a missed workday does
  const r = await page.evaluate(() => [onlyWeekendBetween('2026-11-20', '2026-11-23'), onlyWeekendBetween('2026-11-19', '2026-11-23'), onlyWeekendBetween('2026-11-23', '2026-11-24')]);
  assert.deepEqual(r, [true, false, true]);
  console.log('ok   workday streak rule');
  // 4) date parsing
  const q = await page.evaluate(() => [parseQuick('Pay bill !2 @24.12.'), parseQuick('Email @home about p1 @2026-12-03 @9:05'), parseQuick('@tomorrow')]);
  assert.equal(q[0].prio, 2); assert.match(q[0].due, /-12-24$/); assert.equal(q[1].title, 'Email @home about'); assert.equal(q[1].due, '2026-12-03'); assert.equal(q[1].time, '09:05'); assert.equal(q[2].title, '');
  console.log('ok   quick-add parsing');
  // 5) a data file from version 1 (one project, shared field list, daily goal) opens and is converted
  const v1 = { v: 1, rev: 7, items: [{ id: 'a1', kind: 'todo', title: 'Old to-do', prio: 2, steps: [], done: false, createdAt: 1 }],
    game: { xp: 120, log: [], streak: { count: 2, last: '2026-11-20', best: 4 }, counts: { todoDone: 3, comment: 2, goal: 1 }, days: { '2026-11-20': { xp: 80, done: 2, goalHit: true } }, badges: { goal: 1 } },
    settings: { dailyGoal: 5, sound: false, motion: true, theme: 'dark', sort: 'prio', dayRemindTime: '08:30', refreshMin: 10, jql: 'project = OPS' },
    ticketCfg: { project: 'OPS', types: ['Service Request', 'Task'], defaultType: 'Task', assignToMe: false,
      fields: [{ uid: 'f_components', label: 'Components', fieldId: 'components', kind: 'multi-name', values: ['Mail'], required: true, def: ['Mail'], types: [] },
        { uid: 'f_site', label: 'Site', fieldId: 'customfield_10042', kind: 'single-option', values: ['Berlin'], required: false, def: '', types: ['Service Request'] }],
      templates: [{ id: 't1', name: 'Access', project: 'OPS', type: 'Service Request', summary: 'Access: {title}', description: '', assignToMe: true, fields: { f_site: 'Berlin' } },
        { id: 't2', name: 'HR thing', project: 'HR', type: 'Task', summary: '', description: '', assignToMe: false, fields: {} }] } };
  await page.evaluate(d => localStorage.setItem('focusquest', JSON.stringify(d)), v1);
  await page.reload(); await page.waitForSelector('.item');
  const m = await page.evaluate(() => S);
  assert.equal(m.v, 2); assert.equal(m.items[0].title, 'Old to-do'); assert.equal(m.game.xp, 120); assert.equal(m.settings.theme, 'dark'); assert.ok(!('dailyGoal' in m.settings));
  const fm = m.ticketCfg.forms;
  assert.deepEqual(fm.map(f => [f.project, f.type, f.assignToMe, f.fields.map(x => x.fieldId).join()]), [['OPS', 'Service Request', false, 'components,customfield_10042'], ['OPS', 'Task', false, 'components'], ['HR', 'Task', false, 'components']]);
  assert.equal(m.ticketCfg.defaultForm, fm[1].id);
  assert.deepEqual(m.ticketCfg.templates.map(t => [t.name, t.formId, t.fields.f_site]), [['Access', fm[0].id, 'Berlin'], ['HR thing', fm[2].id, undefined]]);
  assert.ok(!('project' in m.ticketCfg) && !('fields' in m.ticketCfg));
  await page.click('[data-view=settings]'); await page.waitForSelector('#form-tabs');
  assert.equal(await page.inputValue('#fm-type'), 'Task');
  await page.click('[data-view=rewards]'); await page.waitForSelector('.tiles');
  console.log('ok   version 1 data is converted');
  // 6) backup export shape + helper-side token never in page
  assert.ok(!(await page.content()).includes('testtoken'));
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
