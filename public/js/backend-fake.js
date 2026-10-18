// backend מדומה בזיכרון, לבדיקות ולפיתוח בלי Firebase. אותו ממשק כמו backend-firebase.js.
// מדמה גם השהיית שרת: האזנות מקבלות עדכון מקומי מיד, וההבטחה מסתיימת אחרי ההשהיה.
export function makeFake({ delay = 0, user = null, rulesRole = null } = {}) {
  const data = { members: [], meetups: [], expenses: [] };
  const links = {};
  let watchers = [], authCb = null, curUser = user, n = 0, pendingCount = 0;
  const clone = o => JSON.parse(JSON.stringify(o));
  const emit = () => watchers.forEach(cb => ['members', 'meetups', 'expenses'].forEach(k => cb(k, clone(data[k]), pendingCount > 0, false)));
  const later = fn => new Promise((res, rej) => {
    pendingCount++; emit();
    setTimeout(() => { try { res(fn ? fn() : undefined); } catch (e) { rej(e); } finally { pendingCount--; emit(); } }, delay);
  });
  const upsert = (c, o) => { const i = data[c].findIndex(x => x.id === o.id); if (i === -1) data[c].push(clone(o)); else data[c][i] = clone(o); };
  const api = {
    kind: 'fake', data, links, calls: [],
    newId: () => 'id' + (++n) + Math.random().toString(36).slice(2, 8),
    onAuth(cb) { authCb = cb; setTimeout(() => cb(curUser), 0); return () => {}; },
    async signIn() { curUser = api.__nextUser || curUser; authCb && authCb(curUser); },
    async signOut() { curUser = null; authCb && authCb(null); },
    async findMemberByEmail(email) { const m = data.members.find(x => x.email === email); return m ? clone(m) : null; },
    async getLink(uid) { return links[uid] || null; },
    async link(uid, memberId) { links[uid] = memberId; },
    async unlink(uid) { delete links[uid]; },
    watch(cb) { watchers.push(cb); setTimeout(emit, 0); return () => { watchers = watchers.filter(w => w !== cb); }; },
    saveMember(m) { api.calls.push('saveMember'); upsert('members', m); return later(); },
    deleteMember(id) { api.calls.push('deleteMember'); data.members = data.members.filter(m => m.id !== id); return later(); },
    saveMeetup(m) { api.calls.push('saveMeetup'); upsert('meetups', { attendance: {}, ...m, createdAt: m.createdAt || Date.now() }); return later(); },
    deleteMeetup(id) { api.calls.push('deleteMeetup'); data.meetups = data.meetups.filter(m => m.id !== id); data.expenses = data.expenses.filter(x => x.meetupId !== id); return later(); },
    patchMeetup(id, patch) {
      api.calls.push('patchMeetup');
      const m = data.meetups.find(x => x.id === id); if (!m) return Promise.reject(new Error('missing'));
      Object.keys(patch).forEach(k => {
        if (k.startsWith('attendance.')) { const d = k.slice(11); if (patch[k] === null) delete m.attendance[d]; else m.attendance[d] = patch[k]; }
        else if (patch[k] === null) delete m[k]; else m[k] = patch[k];
      });
      return later();
    },
    setAttendance(id, day, add, remove) {
      api.calls.push('setAttendance');
      const m = data.meetups.find(x => x.id === id); if (!m) return Promise.reject(new Error('missing'));
      m.attendance = m.attendance || {};
      let a = (m.attendance[day] || []).filter(x => remove.indexOf(x) === -1);
      add.forEach(x => { if (a.indexOf(x) === -1) a.push(x); });
      m.attendance[day] = a;
      return later();
    },
    saveExpense(x) { api.calls.push('saveExpense'); upsert('expenses', { ...x, createdAt: x.createdAt || Date.now() }); return later(); },
    deleteExpense(id) { api.calls.push('deleteExpense'); data.expenses = data.expenses.filter(x => x.id !== id); return later(); },
    batchSet(ops) { api.calls.push('batchSet'); ops.forEach(o => upsert(o.c, { ...o.data, id: o.id, createdAt: o.data.createdAt || Date.now() })); return later(); }
  };
  return api;
}
