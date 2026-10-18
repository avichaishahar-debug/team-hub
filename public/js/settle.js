// חישוב התחשבנות. פונקציות טהורות (בלי DOM ובלי רשת), כך שאפשר לבדוק אותן ב-Node.
// כל הסכומים באגורות (מספרים שלמים). המפתחות הם מזהי חברי צוות.

export function allocate(totalCents, weights, nameOf = k => k) {
  const keys = Object.keys(weights);
  let W = 0; keys.forEach(k => { W += weights[k]; });
  const out = {};
  if (!W) return out;
  const parts = keys.map(k => { const ex = totalCents * weights[k]; return { k, base: Math.floor(ex / W), rem: ex % W }; });
  let left = totalCents - parts.reduce((s, p) => s + p.base, 0);
  parts.slice().sort((a, b) => b.rem - a.rem || String(nameOf(a.k)).localeCompare(String(nameOf(b.k)), 'he'))
    .forEach(p => { if (left > 0) { p.base++; left--; } });
  parts.forEach(p => { out[p.k] = p.base; });
  return out;
}

export const dayRange = ev => Array.from({ length: ev.days }, (_, i) => i + 1);

/** attendance: { "1": [memberId...], "2": [...] }  ->  { memberId: [1,2] } */
export function participants(ev) {
  const out = {};
  const att = ev.attendance || {};
  for (let d = 1; d <= ev.days; d++) {
    (att[String(d)] || []).forEach(id => { (out[id] = out[id] || []).push(d); });
  }
  return out;
}

export function idsOnDay(ev, d) { return ((ev.attendance || {})[String(d)] || []).slice(); }

export function settle(ev, expenses, nameOf = k => k) {
  const warnings = [];
  const att = participants(ev);
  const attendees = Object.keys(att);
  const all = dayRange(ev);
  const paid = {}, share = {}, byType = {};
  let total = 0;
  expenses.forEach(e => {
    const c = e.amountCents;
    total += c;
    paid[e.payerId] = (paid[e.payerId] || 0) + c;
    byType[e.type] = (byType[e.type] || 0) + c;
    const cov = (e.dayList && e.dayList.length) ? e.dayList : all;
    const pool = (e.sharerIds && e.sharerIds.length) ? e.sharerIds.slice() : attendees.slice();
    const w = {};
    pool.forEach(id => {
      const k = (att[id] || []).filter(d => cov.indexOf(d) !== -1).length;
      if (k > 0) w[id] = (e.mode === 'equal') ? 1 : k;
    });
    if (!Object.keys(w).length && pool.length) {
      warnings.push('בחלק מההוצאות אף אחד מהשותפים לא נכח בימים שלהן, והן חולקו שווה בין השותפים.');
      pool.forEach(id => { w[id] = 1; });
    }
    if (!Object.keys(w).length) { warnings.push('יש הוצאות שאי אפשר לחלק כי לא הוגדרו משתתפים.'); return; }
    const a = allocate(c, w, nameOf);
    Object.keys(a).forEach(id => { share[id] = (share[id] || 0) + a[id]; });
  });
  const ids = [...new Set([...attendees, ...Object.keys(paid), ...Object.keys(share)])];
  const byName = (a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), 'he');
  const rows = ids.map(id => ({ id, days: (att[id] || []).length, paid: paid[id] || 0, share: share[id] || 0, balance: (paid[id] || 0) - (share[id] || 0) }))
    .filter(r => r.days > 0 || r.paid || r.share)
    .sort((a, b) => b.balance - a.balance || byName(a.id, b.id));
  const debt = rows.filter(r => r.balance < 0).map(r => ({ id: r.id, v: -r.balance })).sort((a, b) => b.v - a.v || byName(a.id, b.id));
  const cred = rows.filter(r => r.balance > 0).map(r => ({ id: r.id, v: r.balance })).sort((a, b) => b.v - a.v || byName(a.id, b.id));
  const transfers = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const m = Math.min(debt[i].v, cred[j].v);
    if (m > 0) transfers.push({ from: debt[i].id, to: cred[j].id, cents: m });
    debt[i].v -= m; cred[j].v -= m;
    if (!debt[i].v) i++;
    if (!cred[j].v) j++;
  }
  const personDays = attendees.reduce((s, id) => s + att[id].length, 0);
  return { total, byType, rows, transfers, personDays, attendees: attendees.length, warnings: [...new Set(warnings)] };
}
