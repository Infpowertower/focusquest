const { chromium } = require('playwright'); const assert = require('assert');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  // 1) opened directly as a file: to-dos work, Jira is off
  await page.goto('file://' + __dirname + '/../app.html'); await page.waitForSelector('#q');
  assert.ok(await page.isVisible('.banner'));
  await page.fill('#q', 'Standalone check @fri'); await page.press('#q', 'Enter');
  await page.click('[data-act=import]'); await page.waitForSelector('.toast.bad');
  await page.reload(); await page.waitForSelector('.item');
  assert.equal(await page.evaluate(() => S.items.length), 1);
  console.log('ok   standalone mode');
  // 2) daily goal + streak + three completions in one day
  await page.evaluate(() => { Math.random = () => 0.5; });
  for (const t of ['a', 'b', 'c']) { await page.fill('#q', 'Thing ' + t); await page.press('#q', 'Enter'); }
  for (let i = 0; i < 3; i++) { await page.click('.item:not(.done) .check'); await page.waitForTimeout(500); }
  await page.waitForTimeout(1200);
  const g = await page.evaluate(() => ({ done: dayRec().done, goal: dayRec().goalHit, streak: streakNow(), badges: Object.keys(S.game.badges), xp: S.game.xp }));
  assert.equal(g.done, 3); assert.ok(g.goal); assert.equal(g.streak, 1); assert.ok(g.badges.includes('hat') && g.badges.includes('goal') && g.badges.includes('first'));
  assert.equal(await page.textContent('#p-done'), '3 of 3');
  console.log('ok   daily goal, streak, badges', JSON.stringify(g));
  // 3) weekend does not break the streak (Fri -> Mon), a missed workday does
  const r = await page.evaluate(() => [onlyWeekendBetween('2026-11-20', '2026-11-23'), onlyWeekendBetween('2026-11-19', '2026-11-23'), onlyWeekendBetween('2026-11-23', '2026-11-24')]);
  assert.deepEqual(r, [true, false, true]);
  console.log('ok   workday streak rule');
  // 4) date parsing
  const q = await page.evaluate(() => [parseQuick('Pay bill !2 @24.12.'), parseQuick('Email @home about p1 @2026-12-03 @9:05'), parseQuick('@tomorrow')]);
  assert.equal(q[0].prio, 2); assert.match(q[0].due, /-12-24$/); assert.equal(q[1].title, 'Email @home about'); assert.equal(q[1].due, '2026-12-03'); assert.equal(q[1].time, '09:05'); assert.equal(q[2].title, '');
  console.log('ok   quick-add parsing');
  // 5) backup export shape + helper-side token never in page
  assert.ok(!(await page.content()).includes('testtoken'));
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
