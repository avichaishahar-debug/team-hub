// שכבת הנתונים מעל Firebase (Auth + Firestore). הממשק זהה ל-backend-fake.js.
// Firestore שומר מטמון מקומי: כתיבה מופיעה מיד על המסך, והסנכרון מתבצע ברקע (גם אחרי חזרת הקליטה).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithRedirect, signInWithPopup, getRedirectResult, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager, collection, doc, onSnapshot, setDoc, updateDoc,
  deleteDoc, getDocs, query, where, writeBatch, arrayUnion, arrayRemove, serverTimestamp, getDoc, deleteField
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// IndexedDB לא זמין בחלון פרטי של Firefox ובהגנת טביעת-אצבע: אז עובדים עם מטמון בזיכרון במקום להיתקע.
const idbOk = () => new Promise(res => {
  try {
    const r = indexedDB.open('__th_probe');
    r.onsuccess = () => { try { r.result.close(); indexedDB.deleteDatabase('__th_probe'); } catch (e) {} res(true); };
    r.onerror = () => res(false); r.onblocked = () => res(false);
    setTimeout(() => res(false), 1500);
  } catch (e) { res(false); }
});
const persist = await idbOk();
const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  localCache: persist ? persistentLocalCache({ tabManager: persistentMultipleTabManager() }) : memoryLocalCache()
}, 'default');   // שם מסד הנתונים בפרויקט הזה הוא default (בלי סוגריים), לא (default)

const col = n => collection(db, n);
const stamp = v => (v && v.toMillis) ? v.toMillis() : (typeof v === 'number' ? v : Date.now());
const clean = o => JSON.parse(JSON.stringify(o));   // Firestore מסרב ל-undefined

export const backend = {
  kind: 'firebase',
  newId: () => doc(col('_ids')).id,

  /** מאזין למצב ההתחברות. cb מקבל {uid,email,name} או null. */
  onAuth(cb) {
    getRedirectResult(auth).catch(() => {});
    return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || '', verified: !!u.emailVerified } : null));
  },
  async signIn() {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    // חלון קופץ קודם: בדפדפנים מודרניים (Safari/Chrome) redirect חוזר למסך ההתחברות
    // כשהאתר (web.app) ודומיין ההתחברות (firebaseapp.com) שונים, בגלל חלוקת האחסון.
    try { await signInWithPopup(auth, p); }
    catch (e) {
      const c = e && e.code;
      if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment' || c === 'auth/web-storage-unsupported') {
        await signInWithRedirect(auth, p);
      } else if (c !== 'auth/popup-closed-by-user' && c !== 'auth/cancelled-popup-request') {
        throw e;
      }
    }
  },
  signOut: () => fbSignOut(auth),

  /** לפני הקישור: מחפש את חבר הצוות לפי המייל. */
  async findMemberByEmail(email) {
    const s = await getDocs(query(col('members'), where('email', '==', email)));
    const d = s.docs[0];
    return d ? { id: d.id, ...d.data() } : null;
  },
  async getLink(uid) {
    const d = await getDoc(doc(db, 'users', uid));
    return d.exists() ? d.data().memberId : null;
  },
  link: (uid, memberId) => setDoc(doc(db, 'users', uid), { memberId }),
  unlink: uid => deleteDoc(doc(db, 'users', uid)),

  /** קוד הצטרפות: שליחת הקוד (השרת מאמת מול הקוד הנוכחי) ואז קריאת רשימת השמות. */
  submitCode: (uid, code) => setDoc(doc(db, 'joins', uid), { code }),
  async listRoster() {
    const s = await getDocs(col('members'));
    return s.docs.map(d => ({ id: d.id, name: d.data().name, role: d.data().role }));
  },
  async getJoinCode() { const d = await getDoc(doc(db, 'config', 'join')); return d.exists() ? d.data().code : ''; },
  setJoinCode: code => setDoc(doc(db, 'config', 'join'), { code }),
  /** מנהל-על: מנתק את כל החשבונות המקושרים לחבר צוות, כדי שיבחר מחדש. */
  async unlinkMember(memberId) {
    const s = await getDocs(query(col('users'), where('memberId', '==', memberId)));
    await Promise.all(s.docs.map(d => deleteDoc(d.ref)));
  },

  /** האזנה חיה לכל הנתונים. cb מקבל (kind, rows, pending). */
  watch(cb) {
    const subs = [
      ['members', r => ({ id: r.id, ...r.data() })],
      ['meetups', r => { const x = r.data(); return { id: r.id, ...x, createdAt: stamp(x.createdAt) }; }],
      ['expenses', r => { const x = r.data(); return { id: r.id, ...x, createdAt: stamp(x.createdAt) }; }]
    ].map(([name, map]) => onSnapshot(col(name), { includeMetadataChanges: true },
      s => cb(name, s.docs.map(map), s.metadata.hasPendingWrites, s.metadata.fromCache),
      err => cb(name, null, false, false, err)));
    return () => subs.forEach(u => u());
  },

  saveMember(m) { const { id, ...d } = m; return setDoc(doc(db, 'members', id), clean(d), { merge: false }); },
  deleteMember: id => deleteDoc(doc(db, 'members', id)),

  saveMeetup(m) {
    const { id, createdAt, ...d } = m;
    return setDoc(doc(db, 'meetups', id), clean({ ...d, createdAt: createdAt ? new Date(createdAt) : serverTimestamp() }));
  },
  async deleteMeetup(id) {
    const s = await getDocs(query(col('expenses'), where('meetupId', '==', id)));
    const b = writeBatch(db);
    s.docs.forEach(d => b.delete(d.ref));
    b.delete(doc(db, 'meetups', id));
    return b.commit();
  },
  /** עדכון חלקי של מפגש (שם, תאריך, ימים). ערך null מוחק שדה, למשל attendance.3 כשמקצרים מפגש. */
  patchMeetup(id, patch) {
    const p = {};
    Object.keys(patch).forEach(k => { p[k] = patch[k] === null ? deleteField() : patch[k]; });
    return updateDoc(doc(db, 'meetups', id), p);
  },
  /** נוכחות ליום: דלתא אטומית, כך ששני מנהלים במקביל לא דורסים זה את זה. */
  setAttendance(meetupId, day, add, remove) {
    const f = 'attendance.' + day;
    const patch = {};
    if (add.length && remove.length) {
      // arrayUnion ו-arrayRemove על אותו שדה לא יכולים לרוץ באותה פעולה
      const b = writeBatch(db);
      b.update(doc(db, 'meetups', meetupId), { [f]: arrayRemove(...remove) });
      b.update(doc(db, 'meetups', meetupId), { [f]: arrayUnion(...add) });
      return b.commit();
    }
    patch[f] = add.length ? arrayUnion(...add) : arrayRemove(...remove);
    return updateDoc(doc(db, 'meetups', meetupId), patch);
  },

  saveExpense(x) {
    const { id, createdAt, ...d } = x;
    return setDoc(doc(db, 'expenses', id), clean({ ...d, createdAt: createdAt ? new Date(createdAt) : serverTimestamp() }));
  },
  deleteExpense: id => deleteDoc(doc(db, 'expenses', id)),

  /** כתיבה בצרור (ייבוא). ops: [{c:'members'|'meetups'|'expenses', id, data}] */
  async batchSet(ops) {
    // חברים ← מפגשים ← הוצאות, כל שלב בצרור נפרד שמסתיים לפני הבא:
    // כלל האבטחה של הוצאה בודק שהמפגש כבר קיים, ובתוך אותו צרור הוא עדיין לא נחשב קיים.
    for (const c of ['members', 'meetups', 'expenses']) {
      const part = ops.filter(o => o.c === c);
      for (let i = 0; i < part.length; i += 400) {
        const b = writeBatch(db);
        part.slice(i, i + 400).forEach(o => b.set(doc(db, o.c, o.id), clean({ ...o.data, createdAt: o.data.createdAt ? new Date(o.data.createdAt) : serverTimestamp() })));
        await b.commit();
      }
    }
  }
};
