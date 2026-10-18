// Team Hub: האפליקציה (ממשק). הנתונים מגיעים משכבת backend (Firebase, או מדומה בבדיקות).
import { settle, participants, idsOnDay, dayRange } from './settle.js';
import { OWNER_EMAIL, EXPENSE_TYPES, MAX_DAYS } from './config.js';

let backend;
if (window.__USE_FAKE__) { const m = await import('./backend-fake.js'); backend = window.__fake = m.makeFake(window.__FAKE_OPTS__ || {}); }
else { backend = (await import('./backend-firebase.js')).backend; }

/* ---------- עזרים ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = c => (c / 100).toLocaleString('he-IL', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' ₪';
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const heDate = s => { const [y, m, d] = s.split('-'); return d + '.' + m + '.' + y; };
const shortDate = s => { const [, m, d] = s.split('-'); return Number(d) + '.' + Number(m); };
const weekday = s => { try { return new Date(s + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long' }); } catch (e) { return ''; } };
const range = ev => ev.days > 1 ? heDate(ev.startDate) + ' – ' + heDate(addDays(ev.startDate, ev.days - 1)) : heDate(ev.startDate);
const clean1 = s => String(s || '').replace(/\s+/g, ' ').trim();
// התאמת שם לחבר צוות: שם מדויק, ואם אין: שם חלקי (למשל "מרלא") שמתאים לחבר אחד בלבד. גרש ותווי ניקוד לא משנים.
const normName = s => clean1(s).replace(/[׳'’`"״]/g, '').toLowerCase();
export function matchMember(members, name) {
  const n = normName(name); if (!n) return null;
  const exact = members.filter(m => normName(m.name) === n); if (exact.length === 1) return exact[0];
  const toks = n.split(' ');
  const part = members.filter(m => { const mn = ' ' + normName(m.name) + ' '; return toks.every(t => mn.indexOf(' ' + t + ' ') !== -1 || mn.indexOf(' ' + t) !== -1); });
  return part.length === 1 ? part[0] : null;
}
const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const load = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
let toastT;
function toast(msg, err) { const t = $('toast'); t.innerHTML = '<div class="' + (err ? 'err' : '') + '">' + esc(msg) + '</div>'; clearTimeout(toastT); toastT = setTimeout(() => { t.innerHTML = ''; }, err ? 5000 : 2500); }
function friendly(e) {
  const c = (e && (e.code || e.message)) || '';
  if (/permission-denied/.test(c)) return 'אין לך הרשאה לפעולה הזו (' + c + ')';
  if (/unavailable|network/.test(c)) return 'אין חיבור. הפעולה תישמר ותישלח כשיחזור';
  return (e && e.message) || 'שגיאה';
}
const fire = p => { Promise.resolve(p).catch(e => toast(friendly(e), true)); };

/* ---------- מצב ---------- */
const S = {
  phase: 'loading', error: '', authUser: null, linkId: null,
  members: [], meetups: [], expenses: [], me: null, pending: false, fromCache: false, online: navigator.onLine,
  view: 'expenses', meetupId: null, tab: 'exp', day: 1,
  newMeetup: false, editMeetup: false, confirm: '',
  formOpen: false, draft: null, editExp: null, openExp: null, showAll: false,
  editMember: null, addMember: false, open: {}, bulkResult: '', installEvt: null, restored: false
};
const M = id => S.members.find(m => m.id === id);
const nameOf = id => (M(id) || {}).name || 'לא ידוע';
const sortedMembers = () => S.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'he'));
const isOwner = () => !!(S.authUser && S.authUser.email === OWNER_EMAIL);
const isAdmin = () => isOwner() || (S.me && S.me.role === 'admin');
const canEdit = () => isAdmin() || (S.me && S.me.role === 'manager');
const curMeetup = () => S.meetups.find(m => m.id === S.meetupId);
const meetupExpenses = id => S.expenses.filter(e => e.meetupId === id);
const opened = (k, def) => S.open[k] === undefined ? !!def : !!S.open[k];
const roleLabel = r => ({ admin: 'מנהל-על', manager: 'מנהל', member: 'חבר צוות' }[r] || 'חבר צוות');
const HUES = [205, 160, 28, 45, 185, 120, 10, 225];
const hueOf = n => { let h = 0; for (const c of String(n || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; };
const avs = n => ' style="--h:' + hueOf(n) + '"';
const initial = n => (n || '?').trim().charAt(0);

/* ---------- התחברות וקישור לחבר צוות ---------- */
let stopWatch = null;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('לא התקבלה תשובה מהשרת (' + what + '). בדוק שמסד Firestore נוצר ושהכללים פורסמו.')), ms))]);
async function linkFlow(user) {
  S.phase = 'linking'; render();
  try {
    let id = await withTimeout(backend.getLink(user.uid), 15000, 'users');
    if (!id) {
      const m = await withTimeout(backend.findMemberByEmail(user.email), 15000, 'members');
      if (m) { await backend.link(user.uid, m.id); id = m.id; }
    }
    if (id) { S.linkId = id; startWatch(); return; }
    if (user.email === OWNER_EMAIL) { S.phase = 'bootstrap'; render(); return; }
    try { S.roster = await backend.listRoster(); S.phase = 'pick'; } catch (e) { S.phase = 'notInvited'; }   // כבר הקליד קוד בעבר?
    render();
  } catch (e) { S.phase = 'error'; S.error = friendly(e); render(); }
}
function startWatch() {
  S.phase = 'syncing'; render();
  if (stopWatch) stopWatch();
  stopWatch = backend.watch((kind, rows, pending, fromCache, err) => {
    if (err) { if (S.phase !== 'ready') { S.phase = 'error'; S.error = friendly(err); render(); } return; }
    S[kind] = rows; S.pending = pending; S.fromCache = fromCache;
    if (kind === 'members') resolveMe();
    scheduleRender();
  });
}
async function resolveMe() {
  S.me = M(S.linkId) || null;
  if (S.me && S.phase !== 'ready') {
    S.phase = 'ready'; restoreLast();
    if (isAdmin()) backend.getJoinCode().then(c => { S.joinCode = c || ''; scheduleRender(); }).catch(() => {});
  }
  else if (!S.me && S.phase === 'syncing' && !S.fromCache && S.members.length) {
    // הקישור הישן מצביע על חבר שנמחק: מנקים ומקשרים מחדש לפי המייל
    if (stopWatch) { stopWatch(); stopWatch = null; }
    try { await backend.unlink(S.authUser.uid); } catch (e) {}
    S.linkId = null; linkFlow(S.authUser);
  }
}
function restoreLast() {
  if (S.restored) return; S.restored = true;
  const id = load('thLast'); if (id && S.meetups.some(m => m.id === id)) { S.view = 'expenses'; S.meetupId = id; }
}
backend.onAuth(user => {
  S.authUser = user;
  if (stopWatch) { stopWatch(); stopWatch = null; }
  Object.assign(S, { members: [], meetups: [], expenses: [], me: null, linkId: null, restored: false, meetupId: null });
  if (!user) { S.phase = 'signedOut'; render(); return; }
  linkFlow(user);
});

/* ---------- רינדור ---------- */
let rafId = 0, dirty = false;
const typing = () => { const a = document.activeElement; return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest && a.closest('#app form')); };
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; if (typing()) { dirty = true; return; } render(); });
}
document.addEventListener('focusout', () => { if (dirty) setTimeout(() => { if (dirty && !typing()) { dirty = false; render(); } }, 60); });

const ICON = {
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2"/><circle cx="16.5" cy="14" r="1"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14c2.4 0 4 1.8 4 4.5"/></svg>'
};

function render() {
  const app = $('app'), nav = $('nav');
  if (S.phase !== 'ready') { nav.hidden = true; app.innerHTML = gateView(); return; }
  nav.hidden = false;
  nav.innerHTML = [['expenses', 'הוצאות', ICON.wallet], ['team', 'צוות', ICON.team]].map(([k, l, i]) =>
    '<button data-a="nav" data-v="' + k + '"' + (S.view === k ? ' aria-current="page"' : '') + '>' + i + '<span>' + l + '</span></button>').join('');
  app.innerHTML = topbar() + (S.online ? '' : '<div class="offline">אין חיבור. אפשר להמשיך, והשינויים יישלחו כשהחיבור יחזור</div>') +
    (S.view === 'team' ? teamView() : expensesView());
  if (S.focusAmt) { S.focusAmt = false; const a = $('x-amt'); if (a) { a.focus({ preventScroll: true }); a.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }
}

function gateView() {
  const logo = '<img src="icons/icon-192.png" alt="">';
  const out = '<button class="btn" data-a="signout">התנתקות</button>';
  if (S.phase === 'signedOut') return '<div class="gate">' + logo + '<h1>צוות גולדפרב</h1><p class="muted">הוצאות מפגשים, ימי הולדת ואירועים במקום אחד.</p>' +
    '<button class="btn primary" style="padding:12px 24px;font-size:1.05rem" data-a="signin">התחברות עם Google</button></div>';
  if (S.phase === 'notInvited') return '<div class="gate">' + logo + '<div class="card"><h2>הצטרפות לצוות</h2><p>המייל <b dir="ltr">' + esc(S.authUser.email) +
    '</b> לא רשום בצוות. אם קיבלת קוד הצטרפות, הקלד אותו כאן ובחר את השמך מהרשימה. אפשר גם להתחבר עם חשבון Google אחר.</p>' +
    '<form data-form="join-code"><label>קוד הצטרפות<input id="jc-code" dir="ltr" autocomplete="off" autocapitalize="off" required maxlength="40"></label>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" type="submit">המשך</button>' + out + '</div></form></div></div>';
  if (S.phase === 'pick') return '<div class="gate">' + logo + '<div class="card"><h2>מי אתה?</h2><p class="muted">בחר את השם שלך. הבחירה נשמרת לחשבון הזה, ואם טעית אפשר לבקש ממנהל-על לאפס אותה.</p>' +
    '<div class="who-grid">' + (S.roster || []).filter(m => m.role === 'member').sort((x, y) => x.name.localeCompare(y.name, 'he')).map(m =>
      '<button class="who" data-a="pick-me" data-id="' + esc(m.id) + '"><span class="avatar"' + avs(m.name) + '>' + esc(initial(m.name)) + '</span>' + esc(m.name) + '</button>').join('') +
    '</div><p class="muted small">מנהלים נכנסים לפי המייל שלהם, ולכן הם לא מופיעים כאן.</p><div class="row">' + out + '</div></div></div>';
  if (S.phase === 'bootstrap') return '<div class="gate">' + logo + '<div class="card"><h2>ברוך הבא, בעל המערכת</h2><p>זו הכניסה הראשונה. ניצור לך פרופיל מנהל-על.</p>' +
    '<form data-form="bootstrap"><label>השם שיוצג<input id="bs-name" required maxlength="60" value="' + esc(S.authUser.name) + '"></label>' +
    '<div class="row" style="margin-top:12px"><button class="btn primary" type="submit">יצירת פרופיל</button>' + out + '</div></form></div></div>';
  if (S.phase === 'error') return '<div class="gate">' + logo + '<div class="card"><h2>משהו השתבש</h2><p>' + esc(S.error) + '</p><div class="row"><button class="btn" data-a="reload">נסה שוב</button>' + out + '</div></div></div>';
  return '<div class="gate">' + logo + '<p class="muted">טוען…</p></div>';
}

function topbar() {
  const st = !S.online ? 'מחוץ לרשת' : S.pending ? 'שומר…' : (S.fromCache ? 'מרענן…' : '✓ נשמר');
  const cls = (S.pending || S.fromCache || !S.online) ? 'busy' : '';
  return '<div class="top"><h1>' + (S.view === 'team' ? 'צוות גולדפרב' : 'הוצאות מפגשים') + '</h1><div class="row"><span id="sync" class="' + cls + '">' + st + '</span>' +
    '<button class="avatar" data-a="nav" data-v="team" aria-label="הפרופיל שלי"' + avs(S.me && S.me.name) + '>' + esc(initial(S.me && S.me.name)) + '</button></div></div>';
}

/* ---------- הוצאות: רשימת מפגשים ---------- */
function expensesView() { return S.meetupId && curMeetup() ? meetupView() : homeView(); }

function installCard() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || load('thInstallDismissed')) return '';
  if (S.installEvt) return '<div class="card"><b>התקנה על המסך הראשי</b><span class="muted small">פתיחה מהירה במסך מלא, כמו אפליקציה רגילה.</span><div class="row"><button class="btn primary" data-a="install">התקנה</button><button class="btn" data-a="install-hide">לא עכשיו</button></div></div>';
  if (ios) return '<div class="card"><b>התקנה באייפון</b><span class="muted small">בדפדפן Safari לחץ על כפתור השיתוף, ואז "הוסף למסך הבית".</span><div class="row"><button class="btn" data-a="install-hide">הבנתי</button></div></div>';
  return '';
}

function homeView() {
  const list = S.meetups.slice().sort((a, b) => b.startDate.localeCompare(a.startDate));
  const cards = list.length ? '<ul class="events">' + list.map(e => {
    const ex = meetupExpenses(e.id), tot = ex.reduce((s, x) => s + x.amountCents, 0), n = Object.keys(participants(e)).length;
    return '<li><button class="ev" data-a="open" data-id="' + esc(e.id) + '"><b>' + esc(e.name) + '</b><span class="muted small">' + range(e) + ' · ' + e.days + ' ימים</span>' +
      '<span class="small">' + n + ' משתתפים · ' + ex.length + ' הוצאות · ' + fmt(tot) + '</span></button></li>';
  }).join('') + '</ul>' : '<p class="muted">עדיין אין מפגשים. ' + (canEdit() ? 'פתח את המפגש הראשון.' : 'מנהל צריך לפתוח מפגש חדש.') + '</p>';
  const form = !canEdit() ? '' : S.newMeetup ?
    '<form class="card" data-form="new-meetup"><h3>מפגש חדש</h3><div class="grid">' +
    '<label>שם המפגש<input id="ne-name" required maxlength="80" placeholder="למשל: סוף שבוע באילת"></label>' +
    '<label>תאריך התחלה<input type="date" id="ne-date" value="' + todayStr() + '" required></label>' +
    '<label>מספר ימים<input type="number" id="ne-days" min="1" max="' + MAX_DAYS + '" value="3" required></label></div>' +
    '<div class="row"><button class="btn primary" type="submit">יצירת מפגש</button><button class="btn" type="button" data-a="new-toggle">ביטול</button></div></form>'
    : '<div><button class="btn primary" data-a="new-toggle">מפגש חדש</button></div>';
  return installCard() + form + cards;
}

/* ---------- מפגש ---------- */
function meetupView() {
  const ev = curMeetup(), ex = meetupExpenses(ev.id), r = settle(ev, ex, nameOf);
  const perDay = r.personDays ? Math.round(r.total / r.personDays) : 0;
  const head = '<div class="ehead"><button class="btn sm" data-a="back">› חזרה</button><h2>' + esc(ev.name) + '</h2>' +
    (canEdit() ? '<button class="btn sm" data-a="edit-meetup-toggle">עריכת מפגש</button>' : '') + '</div>' +
    '<div class="muted small" style="margin-top:-6px">' + range(ev) + ' · ' + ev.days + ' ימים</div>';
  const editForm = (canEdit() && S.editMeetup) ?
    '<form class="card" data-form="edit-meetup"><div class="grid"><label>שם<input id="ee-name" value="' + esc(ev.name) + '" required maxlength="80"></label>' +
    '<label>תאריך התחלה<input type="date" id="ee-date" value="' + esc(ev.startDate) + '" required></label>' +
    '<label>מספר ימים<input type="number" id="ee-days" min="1" max="' + MAX_DAYS + '" value="' + ev.days + '" required></label></div>' +
    '<div class="row"><button class="btn primary" type="submit">שמירה</button><button class="btn" type="button" data-a="edit-meetup-toggle">ביטול</button>' +
    '<button class="btn danger' + (S.confirm === 'del-meetup' ? ' sure' : '') + '" type="button" data-a="del-meetup">' + (S.confirm === 'del-meetup' ? 'בטוח? מחיקת המפגש וכל הוצאותיו' : 'מחיקת מפגש') + '</button></div></form>' : '';
  const stats = '<div class="strip"><div class="mini"><span>סה״כ</span><strong>' + fmt(r.total) + '</strong></div>' +
    '<div class="mini"><span>משתתפים</span><strong>' + r.attendees + '</strong></div>' +
    '<div class="mini"><span>ליום-אדם</span><strong>' + (r.personDays ? fmt(perDay) : '—') + '</strong></div></div>';
  const tabs = '<div class="tabs" role="tablist">' + [['exp', 'הוצאות (' + ex.length + ')'], ['ppl', 'נוכחות'], ['set', 'התחשבנות']].map(t =>
    '<button class="tab" role="tab" data-a="tab" data-t="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>';
  const body = S.tab === 'exp' ? expTab(ev, ex) : S.tab === 'ppl' ? pplTab(ev) : setTab(ev, r);
  const fab = (S.tab === 'exp' && !S.formOpen) ? '<button class="btn primary fab" data-a="open-form">＋ הוספת הוצאה</button>' : '';
  return head + editForm + ((S.tab === 'exp' && S.formOpen) ? '' : stats) + tabs + body + fab;
}

/* ----- טופס הוצאה (טיוטה בזיכרון, כך שעדכון ברקע לא מוחק מה שהוקלד) ----- */
function defaults(ev) {
  const t = todayStr();
  return { type: EXPENSE_TYPES[0], amt: '', date: (t >= ev.startDate && t <= addDays(ev.startDate, ev.days - 1)) ? t : ev.startDate, payer: null, note: '', dd: null, mode: 'days', sh: [] };
}
function fromExp(x) {
  return { type: x.type, amt: String(x.amountCents / 100), date: x.date, payer: x.payerId, note: x.note || '', dd: (x.dayList && x.dayList.length) ? x.dayList.slice() : null, mode: x.mode === 'equal' ? 'equal' : 'days', sh: (x.sharerIds || []).slice() };
}
function captureDraft(f) {
  const ev = curMeetup(); if (!ev) return;
  const q = s => f.querySelector(s);
  S.draft = {
    type: (q('input[name="xt"]:checked') || {}).value || EXPENSE_TYPES[0], amt: (q('#x-amt') || {}).value || '', date: (q('#x-date') || {}).value || '',
    payer: (q('#x-payer') || {}).value || '', note: (q('#x-note') || {}).value || '',
    dd: ev.days > 1 ? [...f.querySelectorAll('input[name="dd"]:checked')].map(i => Number(i.value)) : null,
    mode: (q('#x-mode') || {}).value || 'days', sh: [...f.querySelectorAll('input[name="sh"]:checked')].map(i => i.value)
  };
  const el = $('x-sum'); if (el) el.textContent = optSummary(ev, S.draft);
}
function optSummary(ev, v) {
  const p = [];
  if (ev.days > 1) {
    const dd = v.dd;
    if (dd === null || dd.length === ev.days) p.push('כל הימים');
    else if (!dd.length) p.push('לא נבחר יום');
    else p.push(dd.length === 1 ? 'יום ' + dd[0] : 'ימים ' + dd.join(', '));
  }
  p.push(v.sh.length ? v.sh.length + ' שותפים' : 'כל הנוכחים');
  if (ev.days > 1 && v.mode === 'equal') p.push('חלוקה שווה');
  return 'חלוקה: ' + p.join(' · ');
}
function expForm(ev) {
  const e = S.editExp ? S.expenses.find(x => x.id === S.editExp) : null;
  const v = S.draft || (e ? fromExp(e) : defaults(ev));
  const payer = v.payer == null ? (S.me ? S.me.id : '') : v.payer;
  const cov = v.dd === null ? dayRange(ev) : v.dd;
  const mem = sortedMembers();
  const custom = v.sh.length > 0 || (ev.days > 1 && (v.dd !== null && v.dd.length !== ev.days || v.mode === 'equal'));
  return '<form class="card" data-form="exp"><div class="bar"><h3>' + (e ? 'עריכת הוצאה' : 'הוצאה חדשה') + '</h3><button class="btn link" type="button" data-a="close-form">סגירה ✕</button></div>' +
    '<label>סכום (₪)<input class="amt-in" id="x-amt" type="number" inputmode="decimal" min="0.01" step="0.01" required value="' + esc(v.amt) + '" placeholder="0"></label>' +
    '<div class="pills" role="radiogroup" aria-label="סוג הוצאה">' + EXPENSE_TYPES.map(t => '<label class="pill"><input type="radio" name="xt" value="' + esc(t) + '"' + (t === v.type ? ' checked' : '') + '><span>' + esc(t) + '</span></label>').join('') + '</div>' +
    '<div class="two"><label>מי שילם<select id="x-payer"><option value="">בחר</option>' + mem.map(m => '<option value="' + esc(m.id) + '"' + (m.id === payer ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></label>' +
    '<label>תאריך<input id="x-date" type="date" required value="' + esc(v.date) + '"></label></div>' +
    '<label>הערה (לא חובה)<input id="x-note" maxlength="200" value="' + esc(v.note) + '" placeholder="למשל: בשר לארוחת שישי"></label>' +
    '<details class="opt" data-k="xopt"' + (opened('xopt', custom) ? ' open' : '') + '><summary id="x-sum">' + esc(optSummary(ev, { dd: v.dd, mode: v.mode, sh: v.sh })) + '</summary>' +
    (ev.days > 1 ? '<fieldset><legend>ההוצאה מכסה את הימים</legend><div class="row">' + dayRange(ev).map(dn => '<label class="ck"><input type="checkbox" name="dd" value="' + dn + '"' + (cov.indexOf(dn) !== -1 ? ' checked' : '') + '>יום ' + dn + '</label>').join('') + '</div>' +
      '<label>אופן החלוקה<select id="x-mode"><option value="days"' + (v.mode === 'days' ? ' selected' : '') + '>לפי ימי נוכחות בימים שנבחרו</option><option value="equal"' + (v.mode === 'equal' ? ' selected' : '') + '>שווה בין כל מי שנכח, בלי קשר למספר הימים</option></select></label>' +
      '<p class="muted small">בשר ליום אחד: מסמנים רק אותו יום. ירקות לכל המפגש: משאירים הכול. לינה או שכירות: חלוקה שווה.</p></fieldset>' : '') +
    '<p class="muted small">שותפים להוצאה: אם לא מסמנים אף אחד, היא מתחלקת בין כל הנוכחים בימים שנבחרו. סימון מצמצם רק למסומנים.</p>' +
    '<div class="share">' + mem.map(m => '<label><input type="checkbox" name="sh" value="' + esc(m.id) + '"' + (v.sh.indexOf(m.id) !== -1 ? ' checked' : '') + '>' + esc(m.name) + '</label>').join('') + '</div></details>' +
    '<div class="row"><button class="btn primary" type="submit">' + (e ? 'שמירת שינויים' : 'הוספה') + '</button>' + (e ? '' : '<button class="btn" type="submit" data-keep="1">הוספה והמשך</button>') + '</div></form>';
}
function expTab(ev, ex) {
  const items = ex.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const LIM = 6, shown = S.showAll ? items : items.slice(0, LIM), tot = ex.reduce((s, x) => s + x.amountCents, 0);
  const rows = shown.map(x => {
    const open = S.openExp === x.id;
    const det = open ? '<div class="xdet"><span>שילם: <b>' + esc(nameOf(x.payerId)) + '</b> · הוזן ע״י ' + esc(nameOf(x.addedById)) + ' · ' + heDate(x.date) + '</span>' +
      (ev.days > 1 ? '<span>' + (x.dayList && x.dayList.length ? 'ימים: ' + x.dayList.join(', ') : 'כל הימים') + (x.mode === 'equal' ? ' · חלוקה שווה' : '') + '</span>' : '') +
      '<span>' + ((x.sharerIds || []).length ? 'שותפים: ' + x.sharerIds.map(i => esc(nameOf(i))).join(', ') : 'חלוקה בין כל הנוכחים') + '</span>' +
      (canEdit() ? '<div class="acts"><button class="btn sm" data-a="edit-exp" data-id="' + esc(x.id) + '">עריכה</button><button class="btn sm danger' + (S.confirm === 'x' + x.id ? ' sure' : '') + '" data-a="del-exp" data-id="' + esc(x.id) + '">' + (S.confirm === 'x' + x.id ? 'בטוח? מחק' : 'מחיקה') + '</button></div>' : '') + '</div>' : '';
    return '<li class="xrow' + (open ? ' open' : '') + '"><button class="xmain" data-a="exp-toggle" data-id="' + esc(x.id) + '" aria-expanded="' + open + '"><span class="type t-' + esc(x.type) + '">' + esc(x.type) + '</span>' +
      '<span class="xt"><b>' + esc(x.note || x.type) + '</b><small>' + esc(nameOf(x.payerId)) + ' · ' + shortDate(x.date) + (ev.days > 1 && x.dayList && x.dayList.length ? ' · יום ' + x.dayList.join(',') : '') + '</small></span>' +
      '<span class="amt">' + fmt(x.amountCents) + '</span><span class="chev" aria-hidden="true">⌄</span></button>' + det + '</li>';
  }).join('');
  const more = items.length > LIM ? '<button class="btn" data-a="show-all">' + (S.showAll ? 'הצג פחות' : 'הצג את כל ' + items.length + ' ההוצאות') + '</button>' : '';
  const list = items.length ? '<ul class="xlist">' + rows + '</ul>' + more : '<p class="muted">עדיין לא הוזנו הוצאות למפגש הזה.</p>';
  return (S.formOpen ? expForm(ev) : '') + '<div class="card"><div class="bar"><h3>הוצאות המפגש</h3><span class="muted small">' + items.length + ' · ' + fmt(tot) + '</span></div>' + list + '</div>';
}

/* ----- נוכחות: בוחרים יום ומסמנים מי הגיע ----- */
function pplTab(ev) {
  const mem = sortedMembers();
  if (S.day < 1 || S.day > ev.days) S.day = 1;
  const d = S.day, here = idsOnDay(ev, d), set = new Set(here);
  const bar = ev.days > 1 ? '<div class="daybar" role="group" aria-label="בחירת יום">' + dayRange(ev).map(n => {
    const dt = addDays(ev.startDate, n - 1);
    return '<button class="daybtn" data-a="att-day" data-day="' + n + '" aria-pressed="' + (n === d) + '"><b>יום ' + n + '</b><small>' + weekday(dt) + ' ' + shortDate(dt) + '</small><small>' + idsOnDay(ev, n).length + '/' + mem.length + ' נוכחים</small></button>';
  }).join('') + '</div>' : '';
  const dt = addDays(ev.startDate, d - 1);
  const tools = canEdit() ? '<div class="row"><button class="btn sm" data-a="att-all">כולם הגיעו</button><button class="btn sm" data-a="att-none">אף אחד</button>' + (d > 1 ? '<button class="btn sm" data-a="att-copy">כמו יום ' + (d - 1) + '</button>' : '') + '</div>' : '';
  const grid = canEdit()
    ? '<div class="who-grid">' + mem.map(m => { const on = set.has(m.id); return '<button class="who' + (on ? ' on' : '') + '" data-a="att-toggle" data-id="' + esc(m.id) + '" aria-pressed="' + on + '"><span class="tick">✓</span>' + esc(m.name) + '</button>'; }).join('') + '</div>'
    : (here.length ? '<div class="who-grid">' + here.map(i => '<div class="who on"><span class="tick">✓</span>' + esc(nameOf(i)) + '</div>').join('') + '</div>' : '<p class="muted">עוד לא סומנו נוכחים ביום הזה.</p>') + '<p class="muted small">רק מנהל יכול לסמן נוכחות.</p>';
  const part = participants(ev);
  const sum = mem.filter(m => part[m.id]).map(m => '<div class="sumrow"><span>' + esc(m.name) + '</span><span class="muted">' + (ev.days > 1 ? (part[m.id].length === ev.days ? 'כל הימים' : 'ימים ' + part[m.id].join(', ')) : 'הגיע') + '</span></div>').join('') || '<p class="muted small">אין עדיין משתתפים.</p>';
  return bar + '<div class="card"><div class="bar"><h3>' + (ev.days > 1 ? 'יום ' + d + ' · ' + weekday(dt) + ' ' + shortDate(dt) : 'מי הגיע') + '</h3><span class="badge">' + here.length + ' מתוך ' + mem.length + '</span></div>' +
    tools + grid + (canEdit() ? '<p class="muted small">כל לחיצה נשמרת מיד.</p>' : '') + '</div>' +
    '<details class="card" data-k="attsum"' + (opened('attsum') ? ' open' : '') + '><summary>סיכום ימי נוכחות לכל משתתף</summary>' + sum + '</details>';
}
function markDay(add, remove) {
  const ev = curMeetup(); if (!ev || (!add.length && !remove.length)) return;
  fire(backend.setAttendance(ev.id, S.day, add, remove));
}

/* ----- התחשבנות ----- */
function setTab(ev, r) {
  if (!r.total) return '<div class="card"><p class="muted">אין הוצאות להתחשבנות עדיין.</p></div>';
  const warn = r.warnings.map(w => '<div class="warn">' + esc(w) + '</div>').join('');
  const types = Object.keys(r.byType).sort((a, b) => r.byType[b] - r.byType[a]).map(t => '<div class="stat"><span>' + esc(t) + '</span><strong>' + fmt(r.byType[t]) + '</strong></div>').join('');
  const table = '<div class="tablebox"><table><thead><tr><th>שם</th><th class="n">ימים</th><th class="n">שילם</th><th class="n">חלקו</th><th class="n">מאזן</th></tr></thead><tbody>' +
    r.rows.map(x => '<tr><td>' + esc(nameOf(x.id)) + '</td><td class="n">' + x.days + '</td><td class="n">' + fmt(x.paid) + '</td><td class="n">' + fmt(x.share) + '</td><td class="n ' + (x.balance > 0 ? 'pos' : x.balance < 0 ? 'neg' : '') + '">' + (x.balance > 0 ? '+' + fmt(x.balance) : x.balance < 0 ? '−' + fmt(-x.balance) : '0') + '</td></tr>').join('') + '</tbody></table></div>';
  const xf = r.transfers.length ? r.transfers.map(t => '<div class="xfer"><b>' + esc(nameOf(t.from)) + '</b><span class="arrow">מעביר ל</span><b>' + esc(nameOf(t.to)) + '</b><span class="amt" style="margin-inline-start:auto">' + fmt(t.cents) + '</span></div>').join('') : '<p class="muted">כולם מאוזנים, אין צורך בהעברות.</p>';
  const meId = S.me && S.me.id, mine = meId ? r.transfers.filter(t => t.from === meId || t.to === meId) : [];
  const meCard = meId ? '<div class="card" data-mine style="border-color:var(--accent)"><h3>אצלך, ' + esc(S.me.name) + '</h3>' + (mine.length ? mine.map(t => t.from === meId
    ? '<div class="xfer"><span>אתה מעביר ל</span><b>' + esc(nameOf(t.to)) + '</b><span class="amt" style="margin-inline-start:auto">' + fmt(t.cents) + '</span></div>'
    : '<div class="xfer"><b>' + esc(nameOf(t.from)) + '</b><span>מעביר לך</span><span class="amt pos" style="margin-inline-start:auto">' + fmt(t.cents) + '</span></div>').join('') : '<p class="muted">אין לך העברות. אתה מאוזן.</p>') + '</div>' : '';
  return warn + meCard + '<div class="card"><div class="bar"><h3>כל ההעברות</h3><button class="btn sm" data-a="copy-set">העתק לוואטסאפ</button></div>' + xf + '</div>' +
    '<details class="card" data-k="settbl"' + (opened('settbl') ? ' open' : '') + '><summary>פירוט לכל משתתף</summary>' + table +
    '<p class="muted small">החלק של כל אחד: סכום כל הוצאה מחולק לפי ימי הנוכחות של השותפים להוצאה. מאזן = מה ששילם פחות החלק שלו. פלוס (ירוק) מקבל החזר, מינוס (אדום) משלם.</p></details>' +
    '<details class="card" data-k="settypes"' + (opened('settypes') ? ' open' : '') + '><summary>לפי סוג הוצאה</summary><div class="types">' + types + '</div></details>';
}
function copyText(txt) {
  const done = () => toast('הסיכום הועתק, אפשר להדביק בוואטסאפ');
  const fb = () => { try { const t = document.createElement('textarea'); t.value = txt; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); done(); } catch (e) { toast('לא הצלחתי להעתיק', true); } };
  try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, fb); return; } } catch (e) {}
  fb();
}

/* ---------- צוות ---------- */
const memberUsed = id => S.expenses.some(e => e.payerId === id || e.addedById === id || (e.sharerIds || []).indexOf(id) !== -1) ||
  S.meetups.some(m => Object.keys(participants(m)).indexOf(id) !== -1);
const bday = s => s ? s.split('-').slice(-2).reverse().map(Number).join('.') : '';

function teamView() {
  const me = S.me, mem = sortedMembers();
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const profile = '<div class="card"><div class="mrow" style="border:0"><span class="avatar"' + avs(me.name) + '>' + esc(initial(me.name)) + '</span><span class="nm"><b>' + esc(me.name) + '</b><small dir="ltr" style="text-align:right">' + esc(S.authUser.email) + '</small></span><span class="badge">' + roleLabel(isOwner() ? 'admin' : me.role) + '</span></div>' +
    '<label>יום ההולדת שלי<input type="date" id="my-bday" value="' + esc(me.birthday || '') + '" data-a-change="my-bday"></label>' +
    '<div class="row">' + (S.installEvt && !standalone ? '<button class="btn" data-a="install">התקנת האפליקציה</button>' : '') + '<button class="btn" data-a="signout">התנתקות</button></div></div>';
  const addForm = !canEdit() ? '' : S.addMember ? '<form class="card" data-form="add-member"><h3>חבר צוות חדש</h3><div class="grid"><label>שם<input id="nm-name" required maxlength="60"></label><label>מייל Google<input id="nm-email" type="email" dir="ltr" placeholder="name@gmail.com"></label><label>יום הולדת (לא חובה)<input id="nm-bday" type="date"></label></div><div class="row"><button class="btn primary" type="submit">הוספה</button><button class="btn" type="button" data-a="add-member-toggle">ביטול</button></div></form>'
    : '<div><button class="btn primary" data-a="add-member-toggle">＋ חבר צוות</button></div>';
  const rows = mem.map(m => {
    if (S.editMember === m.id) return '<li><form class="card" data-form="edit-member"><div class="grid"><label>שם<input id="em-name" required maxlength="60" value="' + esc(m.name) + '"></label><label>מייל<input id="em-email" type="email" dir="ltr" value="' + esc(m.email || '') + '"></label><label>יום הולדת<input id="em-bday" type="date" value="' + esc(m.birthday || '') + '"></label>' +
      (isAdmin() ? '<label>תפקיד<select id="em-role">' + ['member', 'manager', 'admin'].map(r => '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + roleLabel(r) + '</option>').join('') + '</select></label>' : '') + '</div>' +
      '<div class="row"><button class="btn primary" type="submit">שמירה</button><button class="btn" type="button" data-a="em-cancel">ביטול</button>' + (isAdmin() ? '<button class="btn" type="button" data-a="unlink-member" data-id="' + esc(m.id) + '">ניתוק חשבון</button>' : '') + '<button class="btn danger' + (S.confirm === 'm' + m.id ? ' sure' : '') + '" type="button" data-a="rm-member" data-id="' + esc(m.id) + '">' + (S.confirm === 'm' + m.id ? 'בטוח? הסר' : 'הסרה') + '</button></div></form></li>';
    const sub = [m.email ? '<span dir="ltr">' + esc(m.email) + '</span>' : '<span>עדיין בלי מייל</span>', m.birthday ? '🎂 ' + bday(m.birthday) : ''].filter(Boolean).join(' · ');
    return '<li class="mrow"><span class="avatar"' + avs(m.name) + '>' + esc(initial(m.name)) + '</span><span class="nm"><b>' + esc(m.name) + (m.role !== 'member' ? ' <span class="badge">' + roleLabel(m.role) + '</span>' : '') + '</b><small>' + sub + '</small></span>' +
      (canEdit() && (m.role !== 'admin' || isAdmin()) ? '<button class="btn link" data-a="em-edit" data-id="' + esc(m.id) + '">עריכה</button>' : '<span></span>') + '</li>';
  }).join('');
  const joinCard = !isAdmin() ? '' : '<details class="card" data-k="join"' + (opened('join') ? ' open' : '') + '><summary>קוד הצטרפות לצוות</summary>' +
    '<p class="muted small">מי שנכנס עם Google ולא רשום לפי מייל מקליד את הקוד ובוחר את שמו. החלפת הקוד חוסמת הצטרפות חדשה עם הקוד הישן, והחברים המקושרים נשארים.</p>' +
    '<form data-form="join-set"><label>הקוד<input id="jc-set" dir="ltr" minlength="4" maxlength="40" required autocomplete="off" value="' + esc(S.joinCode || '') + '"></label>' +
    '<div class="row" style="margin-top:8px"><button class="btn primary" type="submit">שמירת קוד</button><button class="btn" type="button" data-a="join-gen">קוד אקראי</button>' +
    (S.joinCode ? '<button class="btn" type="button" data-a="join-copy">העתקת הודעה לצוות</button>' : '') + '</div></form></details>';
  const bulk = !canEdit() ? '' : '<details class="card" data-k="bulk"' + (opened('bulk') ? ' open' : '') + '><summary>הדבקת רשימת מיילים</summary><p class="muted small">שורה לכל אחד: שם, ואז מייל (מופרדים בפסיק, טאב או רווח). השם צריך להיות זהה לשם ברשימה.</p>' +
    '<form data-form="bulk"><textarea id="bulk-text" dir="auto" placeholder="גיל מזור, gil@gmail.com"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" type="submit">עדכון מיילים</button></div></form>' + (S.bulkResult ? '<p class="small" style="white-space:pre-wrap">' + esc(S.bulkResult) + '</p>' : '') + '</details>';
  const imp = !isAdmin() ? '' : '<details class="card" data-k="imp"' + (opened('imp') ? ' open' : '') + '><summary>ייבוא מהגיליון הישן</summary><p class="muted small">ב-Apps Script של הגרסה הקודמת מריצים את <b>exportForMigration</b>, מעתיקים את ה-JSON מהיומן, ומדביקים כאן. אפשר לייבא שוב בלי ליצור כפילויות.</p>' +
    '<form data-form="import"><textarea id="imp-text" dir="ltr" placeholder="{ &quot;members&quot;: [...], ... }"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" type="submit">ייבוא</button></div></form></details>';
  return profile + '<div class="card"><div class="bar"><h3>חברי הצוות (' + mem.length + ')</h3></div><ul class="list">' + rows + '</ul></div>' + addForm + joinCard + bulk + imp;
}

/* ---------- ייבוא מהגיליון הישן ---------- */
function hashId(prefix, s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return prefix + h.toString(36) + s.length.toString(36); }
export function buildImport(json, existingMembers) {
  const byName = new Map(existingMembers.map(m => [clean1(m.name), m.id]));
  const ops = []; let newMembers = 0;
  const idOf = name => {
    name = clean1(name); if (!name) return null;
    if (!byName.has(name)) {
      const id = hashId('mig-m-', name); byName.set(name, id); newMembers++;
      ops.push({ c: 'members', id, data: { name, email: '', role: (json.managers || []).indexOf(name) !== -1 ? 'manager' : 'member', birthday: '' } });
    }
    return byName.get(name);
  };
  (json.members || []).forEach(idOf);
  const meetupIds = {};
  (json.events || []).forEach(e => {
    const id = 'mig-e-' + e.id; meetupIds[e.id] = id; const att = {};
    Object.keys(e.participants || {}).forEach(n => { const mid = idOf(n); (e.participants[n] || []).forEach(d => { (att[d] = att[d] || []).push(mid); }); });
    ops.push({ c: 'meetups', id, data: { name: e.name, startDate: e.startDate, days: Number(e.days) || 1, attendance: att, createdAt: Date.parse(e.createdAt) || Date.now() } });
  });
  let exp = 0;
  (json.expenses || []).forEach(x => {
    if (!meetupIds[x.eventId]) return;
    exp++;
    ops.push({ c: 'expenses', id: 'mig-x-' + x.id, data: {
      meetupId: meetupIds[x.eventId], type: x.type, amountCents: Math.round(Number(x.amount) * 100), date: x.date, payerId: idOf(x.payer), note: x.note || '',
      sharerIds: (x.sharers || []).map(idOf).filter(Boolean), addedById: idOf(x.addedBy) || idOf(x.payer), dayList: x.dayList || [], mode: x.mode === 'equal' ? 'equal' : 'days',
      createdAt: Date.parse(x.createdAt) || Date.now() } });
  });
  return { ops, newMembers, meetups: (json.events || []).length, expenses: exp };
}

/* ---------- אירועי משתמש ---------- */
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  if (a === 'signin') { fire(backend.signIn()); }
  else if (a === 'signout') { await backend.signOut(); }
  else if (a === 'reload') { location.reload(); }
  else if (a === 'pick-me') {
    try { await backend.link(S.authUser.uid, id); S.linkId = id; startWatch(); } catch (e) { toast(friendly(e), true); }
  }
  else if (a === 'join-gen') { const c = 'gf-' + Math.random().toString(36).slice(2, 8); const i = $('jc-set'); if (i) i.value = c; }
  else if (a === 'join-copy') {
    const t = 'היי, האפליקציה של צוות גולדפרב מוכנה: ' + location.origin + '\nנכנסים עם Google, מקלידים את קוד ההצטרפות ' + S.joinCode + ' ובוחרים את השם שלכם. מומלץ גם להתקין למסך הבית.';
    try { await navigator.clipboard.writeText(t); toast('ההודעה הועתקה'); } catch (e) { toast('לא הצלחתי להעתיק', true); }
  }
  else if (a === 'unlink-member') {
    try { await backend.unlinkMember(id); toast('החשבון נותק. החבר יבחר שוב את שמו בכניסה הבאה'); } catch (e) { toast(friendly(e), true); }
  }
  else if (a === 'nav') { S.view = b.dataset.v; render(); window.scrollTo(0, 0); }
  else if (a === 'install') { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; render(); } }
  else if (a === 'install-hide') { store('thInstallDismissed', '1'); render(); }
  else if (a === 'open') { store('thLast', id); Object.assign(S, { meetupId: id, tab: 'exp', editExp: null, formOpen: false, draft: null, openExp: null, showAll: false, day: 1, confirm: '', editMeetup: false }); render(); window.scrollTo(0, 0); }
  else if (a === 'back') { S.meetupId = null; render(); }
  else if (a === 'tab') { S.tab = b.dataset.t; render(); }
  else if (a === 'new-toggle') { S.newMeetup = !S.newMeetup; render(); }
  else if (a === 'edit-meetup-toggle') { S.editMeetup = !S.editMeetup; S.confirm = ''; render(); }
  else if (a === 'del-meetup') {
    if (S.confirm !== 'del-meetup') { S.confirm = 'del-meetup'; render(); return; }
    const mid = S.meetupId; S.confirm = ''; S.meetupId = null; S.editMeetup = false; store('thLast', null);
    fire(backend.deleteMeetup(mid)); toast('המפגש נמחק'); render();
  }
  else if (a === 'open-form') { S.formOpen = true; S.editExp = null; S.draft = null; delete S.open.xopt; S.focusAmt = true; render(); }
  else if (a === 'close-form') { S.formOpen = false; S.editExp = null; S.draft = null; render(); }
  else if (a === 'exp-toggle') { S.openExp = S.openExp === id ? null : id; S.confirm = ''; render(); }
  else if (a === 'show-all') { S.showAll = !S.showAll; render(); }
  else if (a === 'edit-exp') {
    const x = S.expenses.find(e => e.id === id); S.formOpen = true; S.editExp = id; S.draft = fromExp(x);
    S.open.xopt = S.draft.sh.length > 0 || S.draft.dd !== null || S.draft.mode === 'equal'; S.focusAmt = true; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  else if (a === 'del-exp') {
    if (S.confirm !== 'x' + id) { S.confirm = 'x' + id; render(); return; }
    S.confirm = ''; if (S.openExp === id) S.openExp = null; fire(backend.deleteExpense(id)); toast('ההוצאה נמחקה'); render();
  }
  else if (a === 'att-day') { S.day = Number(b.dataset.day); render(); }
  else if (a === 'att-toggle') { const on = idsOnDay(curMeetup(), S.day).indexOf(id) !== -1; on ? markDay([], [id]) : markDay([id], []); }
  else if (a === 'att-all') { const here = idsOnDay(curMeetup(), S.day); markDay(S.members.map(m => m.id).filter(i => here.indexOf(i) === -1), []); }
  else if (a === 'att-none') { markDay([], idsOnDay(curMeetup(), S.day)); }
  else if (a === 'att-copy') {
    const e = curMeetup(), prev = idsOnDay(e, S.day - 1), cur = idsOnDay(e, S.day);
    markDay(prev.filter(i => cur.indexOf(i) === -1), cur.filter(i => prev.indexOf(i) === -1));
  }
  else if (a === 'copy-set') {
    const e = curMeetup(), r = settle(e, meetupExpenses(e.id), nameOf);
    copyText('התחשבנות ' + e.name + ' (' + range(e) + ')\nסה״כ הוצאות: ' + fmt(r.total) + '\n\n' + (r.transfers.length ? r.transfers.map(t => nameOf(t.from) + ' ← ' + fmt(t.cents) + ' ← ' + nameOf(t.to)).join('\n') : 'כולם מאוזנים'));
  }
  else if (a === 'add-member-toggle') { S.addMember = !S.addMember; render(); }
  else if (a === 'em-edit') { S.editMember = id; S.confirm = ''; render(); }
  else if (a === 'em-cancel') { S.editMember = null; S.confirm = ''; render(); }
  else if (a === 'rm-member') {
    if (memberUsed(id)) { toast('אי אפשר להסיר: השם מופיע בהוצאות או בנוכחות', true); return; }
    if (S.confirm !== 'm' + id) { S.confirm = 'm' + id; render(); return; }
    S.confirm = ''; S.editMember = null; fire(backend.deleteMember(id)); toast('השם הוסר'); render();
  }
});

document.addEventListener('input', e => { const f = e.target.closest && e.target.closest('form[data-form="exp"]'); if (f) captureDraft(f); });
document.addEventListener('change', e => {
  const t = e.target, f = t.closest && t.closest('form[data-form="exp"]'); if (f) captureDraft(f);
  if (t.id === 'my-bday' && S.me) { fire(backend.saveMember({ ...S.me, birthday: t.value || '' })); toast('נשמר'); }
});

document.addEventListener('submit', async ev => {
  const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault();
  const k = f.dataset.form, v = id => ($(id) || {}).value || '';
  if (k === 'join-code') {
    const code = v('jc-code').trim(); if (!code) return;
    try { await backend.submitCode(S.authUser.uid, code); S.roster = await backend.listRoster(); S.phase = 'pick'; render(); }
    catch (e) { toast(/permission/.test((e && (e.code || e.message)) || '') ? 'הקוד שגוי' : friendly(e), true); }
    return;
  }
  if (k === 'join-set') {
    const code = v('jc-set').trim(); if (code.length < 4) return;
    try { await backend.setJoinCode(code); S.joinCode = code; toast('הקוד נשמר'); scheduleRender(); } catch (e) { toast(friendly(e), true); }
    return;
  }
  if (k === 'bootstrap') {
    const name = clean1(v('bs-name')); if (!name) return;
    const id = backend.newId();
    try {
      await backend.saveMember({ id, name, email: S.authUser.email, role: 'admin', birthday: '' });
      await backend.link(S.authUser.uid, id); S.linkId = id; startWatch();
    } catch (e) { toast(friendly(e), true); }
  }
  else if (k === 'new-meetup') {
    const name = clean1(v('ne-name')), days = Math.round(Number(v('ne-days')));
    if (!name) { toast('חסר שם מפגש', true); return; }
    if (!(days >= 1 && days <= MAX_DAYS)) { toast('מספר הימים חייב להיות בין 1 ל-' + MAX_DAYS, true); return; }
    const m = { id: backend.newId(), name, startDate: v('ne-date'), days, attendance: {}, createdAt: Date.now() };
    fire(backend.saveMeetup(m));
    Object.assign(S, { newMeetup: false, meetupId: m.id, tab: 'ppl', day: 1, formOpen: false, draft: null, openExp: null, showAll: false });
    store('thLast', m.id); toast('המפגש נוצר. סמנו מי הגיע'); window.scrollTo(0, 0);
    // המפגש עוד לא הגיע מהמאזין: מציגים אותו מיד
    if (!S.meetups.some(x => x.id === m.id)) S.meetups.push(m);
    render();
  }
  else if (k === 'edit-meetup') {
    const e = curMeetup(), name = clean1(v('ee-name')), days = Math.round(Number(v('ee-days')));
    if (!name) { toast('חסר שם מפגש', true); return; }
    if (!(days >= 1 && days <= MAX_DAYS)) { toast('מספר הימים חייב להיות בין 1 ל-' + MAX_DAYS, true); return; }
    const patch = { name, startDate: v('ee-date'), days };
    for (let d = days + 1; d <= e.days; d++) patch['attendance.' + d] = null;      // קיצור מפגש מוחק נוכחות בימים שנחתכו
    fire(backend.patchMeetup(e.id, patch)); S.editMeetup = false; if (S.day > days) S.day = 1; toast('נשמר'); render();
  }
  else if (k === 'exp') {
    const e = curMeetup(); captureDraft(f); const d = S.draft;
    const cents = Math.round(Number(d.amt) * 100);
    if (!(cents > 0)) { toast('הזן סכום', true); return; }
    if (!d.payer) { toast('בחר מי שילם', true); return; }
    if (e.days > 1 && d.dd && !d.dd.length) { toast('בחר לפחות יום אחד להוצאה', true); return; }
    const keep = !!(ev.submitter && ev.submitter.dataset && ev.submitter.dataset.keep);
    const old = S.editExp ? S.expenses.find(x => x.id === S.editExp) : null;
    const x = {
      id: old ? old.id : backend.newId(), meetupId: e.id, type: d.type, amountCents: cents, date: d.date, payerId: d.payer, note: clean1(d.note),
      sharerIds: d.sh.filter(i => M(i)), addedById: old ? old.addedById : S.me.id, createdAt: old ? old.createdAt : Date.now(),
      dayList: (e.days > 1 && d.dd && d.dd.length !== e.days) ? d.dd.slice().sort((p, q) => p - q) : [], mode: (e.days > 1 && d.mode === 'equal') ? 'equal' : 'days'
    };
    fire(backend.saveExpense(x)); toast(old ? 'נשמר' : 'ההוצאה נוספה');
    if (old) { S.editExp = null; S.draft = null; S.formOpen = false; }
    else if (keep) { S.draft = { ...d, amt: '', note: '' }; S.focusAmt = true; }
    else { S.draft = null; S.formOpen = false; }
    render();
  }
  else if (k === 'add-member') {
    const name = clean1(v('nm-name')), email = v('nm-email').trim().toLowerCase();
    if (!name) { toast('חסר שם', true); return; }
    if (S.members.some(m => clean1(m.name) === name)) { toast('השם כבר קיים', true); return; }
    if (email && S.members.some(m => m.email === email)) { toast('המייל כבר רשום אצל חבר אחר', true); return; }
    fire(backend.saveMember({ id: backend.newId(), name, email, role: 'member', birthday: v('nm-bday') })); S.addMember = false; toast('נוסף'); render();
  }
  else if (k === 'edit-member') {
    const m = M(S.editMember), name = clean1(v('em-name')), email = v('em-email').trim().toLowerCase();
    if (!name) { toast('חסר שם', true); return; }
    if (S.members.some(o => o.id !== m.id && clean1(o.name) === name)) { toast('השם כבר קיים', true); return; }
    if (email && S.members.some(o => o.id !== m.id && o.email === email)) { toast('המייל כבר רשום אצל חבר אחר', true); return; }
    const role = isAdmin() && $('em-role') ? v('em-role') : m.role;
    fire(backend.saveMember({ ...m, name, email, birthday: v('em-bday'), role })); S.editMember = null; toast('נשמר'); render();
  }
  else if (k === 'bulk') {
    const lines = v('bulk-text').split(/\n+/).map(s => s.trim()).filter(Boolean);
    let ok = 0; const miss = [];
    lines.forEach(l => {
      const mm = l.match(/^(.*?)[\s,;\t]+([^\s,;]+@[^\s,;]+)\s*$/); const nm = mm && matchMember(S.members, mm[1]);
      if (!nm) { miss.push(l); return; }
      fire(backend.saveMember({ ...nm, email: mm[2].toLowerCase() })); ok++;
    });
    S.bulkResult = 'עודכנו ' + ok + ' מיילים.' + (miss.length ? '\nלא זוהו (בדוק את כתיב השם):\n' + miss.join('\n') : ''); render();
  }
  else if (k === 'import') {
    let json; try { json = JSON.parse(v('imp-text').replace(/^[^{]*/, '').replace(/[^}]*$/, '')); } catch (e) { toast('ה-JSON לא תקין. ודא שהעתקת את כל השורה', true); return; }
    if (!json || !Array.isArray(json.events)) { toast('הפורמט לא מוכר', true); return; }
    const r = buildImport(json, S.members);
    try { await backend.batchSet(r.ops); toast('יובאו ' + r.meetups + ' מפגשים, ' + r.expenses + ' הוצאות ו-' + r.newMembers + ' חברי צוות חדשים'); $('imp-text').value = ''; } catch (e) { toast(friendly(e), true); }
  }
});

document.addEventListener('toggle', e => { const t = e.target; if (t && t.dataset && t.dataset.k) S.open[t.dataset.k] = t.open; }, true);
window.addEventListener('online', () => { S.online = true; render(); });
window.addEventListener('offline', () => { S.online = false; render(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; if (S.phase === 'ready') render(); });
if ('serviceWorker' in navigator && !window.__USE_FAKE__) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
