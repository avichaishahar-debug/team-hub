// בדיקות דפדפן מלאות עם backend מדומה (בלי Firebase ובלי רשת).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(0);
const base = 'http://localhost:' + server.address().port + '/';

const OWNER = { uid: 'u-owner', email: 'avichaishahar@gmail.com', name: 'אביחי שחר', verified: true };
const NAMES = ['שחם ברקת', 'יובל כנען', 'ירון פורת', 'דורון צייזל', 'דורון קלס', 'ליעד כושי שגיא', 'איתמר שוורץ', 'אביחי שחר', 'שקד אנג׳ל', 'מיקי בורדה', 'אמרי הורוביץ', 'גיל מזור', 'יובל רוזנברג', 'אייל רוטשטיין', 'עופר שכטר', 'עודד מרלא', 'יאיר רינגל'];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
async function open(user, opts = {}) {
  const ctx = opts.ctx || await browser.newContext({ viewport: { width: 400, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(([u, o]) => { window.__USE_FAKE__ = true; window.__FAKE_OPTS__ = { delay: o.delay ?? 600, user: u }; }, [user, opts]);
  await p.goto(base);
  return p;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ===== 1. בעל המערכת: כניסה ראשונה ===== */
let p = await open(OWNER);
await p.waitForSelector('form[data-form="bootstrap"]');
await p.screenshot({ path: 'shot_bootstrap.png' });
await p.fill('#bs-name', 'אביחי שחר'); await p.click('button[type=submit]');
await p.waitForSelector('#nav:not([hidden])');
let fake = () => p.evaluate(() => JSON.parse(JSON.stringify({ d: window.__fake.data, l: window.__fake.links })));
assert.equal((await fake()).d.members[0].role, 'admin');
assert.equal((await fake()).l[OWNER.uid], (await fake()).d.members[0].id);

// seed the team (as the migration/admin would)
await p.evaluate(names => Promise.all(names.filter(n => n !== 'אביחי שחר').map(n => window.__fake.saveMember({ id: window.__fake.newId(), name: n, email: '', role: 'member', birthday: '' }))), NAMES);
await sleep(900);
assert.equal((await fake()).d.members.length, 17);

/* ===== 2. מפגש חדש, נוכחות ===== */
await p.click('[data-a="new-toggle"]'); await p.fill('#ne-name', 'סוף שבוע באילת'); await p.fill('#ne-date', '2026-11-05');
let t0 = Date.now(); await p.click('form[data-form="new-meetup"] button[type=submit]');
await p.waitForSelector('[data-a="att-toggle"]', { timeout: 400 }); assert.ok(Date.now() - t0 < 500, 'meetup appears before the server answers');
await sleep(1000);

// ---- attendance: UI answers instantly, then "saved" ----
t0 = Date.now(); await p.click('[data-a="att-all"]');
await p.waitForFunction(() => document.querySelectorAll('.who.on').length === 17, null, { timeout: 400 }); assert.ok(Date.now() - t0 < 500);
await p.waitForFunction(() => document.getElementById('sync').textContent === 'שומר…', null, { timeout: 400 });
await sleep(1000); assert.equal(await p.textContent('#sync'), '✓ נשמר');
await p.click('[data-a="att-day"][data-day="2"]'); await p.click('[data-a="att-all"]');
await p.click('[data-a="att-toggle"]:has-text("יאיר רינגל")'); await p.click('[data-a="att-toggle"]:has-text("גיל מזור")'); await p.click('[data-a="att-toggle"]:has-text("גיל מזור")');
await p.click('[data-a="att-day"][data-day="3"]'); await p.click('[data-a="att-copy"]'); await p.click('[data-a="att-toggle"]:has-text("עופר שכטר")');
await p.waitForFunction(() => document.querySelectorAll('.who.on').length === 15, null, { timeout: 400 });
await sleep(2500);
const memId = async n => (await fake()).d.members.find(m => m.name === n).id;
let att = (await fake()).d.meetups[0].attendance;
assert.equal(att['1'].length, 17); assert.equal(att['2'].length, 16); assert.equal(att['3'].length, 15);
assert.ok(!att['2'].includes(await memId('יאיר רינגל')) && !att['3'].includes(await memId('עופר שכטר')) && att['3'].includes(await memId('גיל מזור')));
await p.screenshot({ path: 'shot_attendance.png' });

// ---- expenses: collapsed form, draft survives re-render, optimistic list ----
await p.click('[data-a="tab"][data-t="exp"]');
assert.equal(await p.locator('form[data-form="exp"]').count(), 0); assert.ok(await p.locator('.fab').isVisible());
await p.click('.fab'); await p.waitForSelector('#x-amt');
await p.fill('#x-amt', '1800'); await p.check('input[name="xt"][value="מזון"]', { force: true }); await p.selectOption('#x-payer', { label: 'אביחי שחר' }); await p.fill('#x-note', 'ארוחת שבת');
await p.evaluate(() => window.__fake.saveMember({ ...window.__fake.data.members[3] }));          // a background snapshot while typing
await sleep(300);
assert.equal(await p.inputValue('#x-amt'), '1800'); assert.equal(await p.inputValue('#x-note'), 'ארוחת שבת');
t0 = Date.now(); await p.click('form[data-form="exp"] button[type=submit]:not([data-keep])');
assert.equal(await p.locator('form[data-form="exp"]').count(), 0); await p.waitForSelector('.xrow', { timeout: 400 }); assert.ok(Date.now() - t0 < 500);
// meat for day 2 only, add-and-continue
await p.click('.fab'); await p.fill('#x-amt', '600'); await p.selectOption('#x-payer', { label: 'אביחי שחר' }); await p.fill('#x-note', 'בשר ליום שני');
await p.locator('details.opt summary').click(); await p.uncheck('input[name="dd"][value="1"]'); await p.uncheck('input[name="dd"][value="3"]');
assert.ok((await p.textContent('#x-sum')).includes('יום 2'));
await p.click('button[data-keep="1"]'); assert.equal(await p.inputValue('#x-amt'), '');
await p.fill('#x-amt', '4200'); await p.check('input[name="xt"][value="לינה"]', { force: true }); await p.selectOption('#x-payer', { label: 'גיל מזור' }); await p.fill('#x-note', 'וילה');
await p.click('form[data-form="exp"] button[type=submit]:not([data-keep])');
await sleep(1200);
let exs = (await fake()).d.expenses; assert.equal(exs.length, 3);
const meat = exs.find(x => x.note === 'בשר ליום שני'); assert.deepEqual(meat.dayList, [2]); assert.equal(meat.amountCents, 60000);
assert.equal(exs[0].addedById, (await fake()).d.members[0].id);
// no day selected is rejected locally
await p.click('.fab'); await p.fill('#x-amt', '10'); await p.selectOption('#x-payer', { label: 'גיל מזור' }); await p.locator('details.opt summary').click();
for (const d of [1, 2, 3]) await p.uncheck('input[name="dd"][value="' + d + '"]');
await p.click('form[data-form="exp"] button[type=submit]:not([data-keep])'); await p.waitForSelector('#toast .err'); assert.equal((await fake()).d.expenses.length, 3);
await p.click('[data-a="close-form"]');
// expand, edit, delete
await p.click('.xmain >> nth=0'); await p.screenshot({ path: 'shot_expenses.png' });
await p.click('[data-a="edit-exp"]'); await p.waitForSelector('#x-amt'); await p.fill('#x-amt', '100'); await p.click('form[data-form="exp"] button[type=submit]'); await sleep(900);
assert.ok((await fake()).d.expenses.some(x => x.amountCents === 10000));
if (!(await p.locator('.xdet').count())) await p.click('.xmain >> nth=0');
await p.click('[data-a="del-exp"]'); await p.click('[data-a="del-exp"]'); assert.equal(await p.locator('.xrow').count(), 2); await sleep(900); assert.equal((await fake()).d.expenses.length, 2);

// ---- settlement: personal card + copy ----
await p.click('[data-a="tab"][data-t="set"]'); await p.waitForSelector('[data-mine]');
assert.ok((await p.textContent('[data-mine]')).includes('אביחי שחר'));
await p.click('[data-a="copy-set"]'); await p.waitForSelector('#toast div');
assert.ok((await p.evaluate(() => navigator.clipboard.readText())).includes('התחשבנות סוף שבוע באילת'));
await p.screenshot({ path: 'shot_settle.png' });

// ---- edit meetup: shortening drops attendance of the removed day ----
await p.click('[data-a="edit-meetup-toggle"]'); await p.fill('#ee-days', '2'); await p.click('form[data-form="edit-meetup"] button[type=submit]'); await sleep(900);
assert.equal(Object.keys((await fake()).d.meetups[0].attendance).includes('3'), false);
await p.click('[data-a="edit-meetup-toggle"]'); await p.fill('#ee-days', '3'); await p.click('form[data-form="edit-meetup"] button[type=submit]'); await sleep(900);

// ---- team tab ----
await p.click('[data-a="nav"][data-v="team"]'); await p.waitForSelector('.mrow');
await p.click('[data-a="add-member-toggle"]'); await p.fill('#nm-name', 'חבר חדש'); await p.fill('#nm-email', 'NEW@Gmail.com'); await p.click('form[data-form="add-member"] button[type=submit]'); await sleep(900);
assert.equal((await fake()).d.members.find(m => m.name === 'חבר חדש').email, 'new@gmail.com');
await p.locator('details[data-k="bulk"] summary').click();
await p.fill('#bulk-text', 'גיל מזור, gil@gmail.com\nירון פורת\tyaron@gmail.com\nמישהו לא קיים, x@y.com');
await p.click('form[data-form="bulk"] button[type=submit]'); await sleep(900);
assert.equal((await fake()).d.members.find(m => m.name === 'גיל מזור').email, 'gil@gmail.com');
assert.ok((await p.textContent('details[data-k="bulk"]')).includes('מישהו לא קיים'));
await p.fill('#my-bday', '1982-03-09'); await p.dispatchEvent('#my-bday', 'change'); await sleep(900);
assert.equal((await fake()).d.members.find(m => m.name === 'אביחי שחר').birthday, '1982-03-09');
// make Yaron a manager (admin only), then remove-protection for a used member
await p.click('[data-a="em-edit"][data-id="' + await memId('ירון פורת') + '"]'); await p.selectOption('#em-role', 'manager'); await p.click('form[data-form="edit-member"] button[type=submit]'); await sleep(900);
assert.equal((await fake()).d.members.find(m => m.name === 'ירון פורת').role, 'manager');
await p.click('[data-a="em-edit"][data-id="' + await memId('גיל מזור') + '"]'); await p.click('[data-a="rm-member"]'); await p.waitForSelector('#toast .err');   // used in expenses
await p.click('[data-a="em-cancel"]');
await p.screenshot({ path: 'shot_team.png', fullPage: true });

// ---- import from the old sheet (idempotent) ----
const old = { members: ['גיל מזור', 'חבר ישן'], managers: ['חבר ישן'], events: [{ id: 'e1', name: 'ישן', startDate: '2026-01-10', days: 2, participants: { 'גיל מזור': [1, 2], 'חבר ישן': [2] }, createdAt: '2026-01-01T10:00:00.000Z' }],
  expenses: [{ id: 'x1', eventId: 'e1', type: 'מזון', amount: 120.5, date: '2026-01-10', payer: 'חבר ישן', note: 'קניות', sharers: [], addedBy: 'גיל מזור', createdAt: '2026-01-10T10:00:00.000Z', dayList: [], mode: 'days' }] };
await p.locator('details[data-k="imp"] summary').click();
for (let i = 0; i < 2; i++) { await p.fill('#imp-text', 'INFO ' + JSON.stringify(old)); await p.click('form[data-form="import"] button[type=submit]'); await sleep(900); }
let d = (await fake()).d;
assert.equal(d.members.filter(m => m.name === 'חבר ישן').length, 1); assert.equal(d.members.find(m => m.name === 'חבר ישן').role, 'manager');
assert.equal(d.members.filter(m => m.name === 'גיל מזור').length, 1);
assert.equal(d.meetups.filter(m => m.name === 'ישן').length, 1); assert.equal(d.expenses.filter(x => x.note === 'קניות').length, 1);
assert.equal(d.expenses.find(x => x.note === 'קניות').amountCents, 12050);
const im = d.meetups.find(m => m.name === 'ישן'); assert.equal(im.attendance['2'].length, 2); assert.equal(im.attendance['1'].length, 1);

// ---- reload keeps working; offline banner ----
await p.context().setOffline(true); await p.waitForSelector('.offline'); await p.context().setOffline(false);

/* ===== 3. משתמשים אחרים: לא מוזמן / חבר רגיל / מנהל ===== */
const as = async (email, uid) => { await p.evaluate(([e, u]) => { window.__fake.__nextUser = { uid: u, email: e, name: 'x', verified: true }; return window.__fake.signOut().then(() => window.__fake.signIn()); }, [email, uid]); };
// קוד הצטרפות: מנהל-על קובע קוד במסך הצוות
await p.click('[data-a="nav"][data-v="team"]'); await p.click('details[data-k="join"] summary'); await p.fill('#jc-set', 'gf-test1'); await p.click('form[data-form="join-set"] button[type=submit]');
await p.waitForFunction(() => window.__fake.joinCode === 'gf-test1');
await as('stranger@gmail.com', 'u-x'); await p.waitForSelector('text=הצטרפות לצוות'); await p.screenshot({ path: 'shot_notinvited.png' });
await p.fill('#jc-code', 'wrong-code'); await p.click('form[data-form="join-code"] button[type=submit]'); await p.waitForSelector('#toast div.err');   // קוד שגוי
assert.equal(await p.locator('.who').count(), 0);
await p.fill('#jc-code', 'gf-test1'); await p.click('form[data-form="join-code"] button[type=submit]'); await p.waitForSelector('[data-a="pick-me"]');
await p.screenshot({ path: 'shot_pick.png' });
assert.equal(await p.locator('[data-a="pick-me"]', { hasText: 'אביחי שחר' }).count(), 0);   // מנהלים לא מופיעים ברשימה
await p.click('[data-a="pick-me"]:has-text("עודד מרלא")'); await p.waitForSelector('#nav:not([hidden])');
assert.equal((await fake()).l['u-x'], await memId('עודד מרלא'));
await p.click('[data-a="nav"][data-v="team"]'); assert.equal(await p.locator('details[data-k="join"]').count(), 0);   // חבר רגיל לא רואה את הקוד
// מנהל-על מנתק את הקישור
await as('avichaishahar@gmail.com', 'u-owner'); await p.waitForSelector('#nav:not([hidden])');
await as('gil@gmail.com', 'u-gil'); await p.waitForSelector('#nav:not([hidden])');
assert.equal((await fake()).l['u-gil'], await memId('גיל מזור'));
await p.click('[data-a="nav"][data-v="expenses"]');
assert.equal(await p.locator('[data-a="new-toggle"]').count(), 0);
await p.locator('.ev', { hasText: 'סוף שבוע' }).click(); await p.click('[data-a="tab"][data-t="ppl"]');
assert.equal(await p.locator('[data-a="att-toggle"]').count(), 0); assert.ok(await p.locator('text=רק מנהל יכול לסמן נוכחות').count());
await p.click('[data-a="tab"][data-t="exp"]'); assert.ok(await p.locator('.fab').isVisible());          // any member can add an expense
await p.click('.xmain >> nth=0'); assert.equal(await p.locator('[data-a="edit-exp"]').count(), 0);        // but not edit
await p.click('[data-a="nav"][data-v="team"]'); assert.equal(await p.locator('[data-a="add-member-toggle"]').count(), 0);
assert.equal(await p.locator('details[data-k="imp"]').count(), 0);
await as('yaron@gmail.com', 'u-yaron'); await p.waitForSelector('#nav:not([hidden])');                  // linked by the email we pasted
await p.click('[data-a="nav"][data-v="expenses"]'); await p.waitForSelector('[data-a="new-toggle"]');   // manager sees the manager tools
await p.locator('.ev', { hasText: 'סוף שבוע' }).click(); await p.click('[data-a="tab"][data-t="ppl"]'); assert.ok(await p.locator('[data-a="att-toggle"]').count() > 0);
await p.click('[data-a="nav"][data-v="team"]'); assert.equal(await p.locator('details[data-k="imp"]').count(), 0); assert.equal(await p.locator('[data-a="em-edit"]').count() > 0, true);
await p.screenshot({ path: 'shot_manager.png' });

/* ===== 4. פתיחה חוזרת: נשאר במפגש האחרון ===== */
console.log('errors:', errs); assert.equal(errs.length, 0);
await browser.close(); server.close(); console.log('e2e ok');
