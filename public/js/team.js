// פונקציות טהורות לימי הולדת ולתאריכים (נבדקות ב-tests/team.test.js).
const pad = n => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());   // התאריך לפי שעון המכשיר
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dayNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };

/** מחזיר {m, d} מתאריך YYYY-MM-DD (השנה לא חשובה), או null אם אין תאריך תקין. */
export function parseBirthday(s) {
  const p = String(s || '').split('-').map(Number);
  if (p.length < 3 || p.some(x => !Number.isFinite(x))) return null;
  const [, m, d] = p;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { m, d };
}

/** יום ההולדת הבא (או היום) יחסית לתאריך today. 29 בפברואר חל ב-28 בשנה לא מעוברת. */
export function nextBirthday(s, today) {
  const b = parseBirthday(s); if (!b) return null;
  const y = Number(today.slice(0, 4));
  const at = yr => (b.m === 2 && b.d === 29 && !leap(yr)) ? yr + '-02-28' : yr + '-' + pad(b.m) + '-' + pad(b.d);
  let date = at(y), days = dayNum(date) - dayNum(today);
  if (days < 0) { date = at(y + 1); days = dayNum(date) - dayNum(today); }
  return { date, days };
}

/** חברים עם יום הולדת, מהקרוב לרחוק. כל פריט: {member, date, days}. */
export function upcomingBirthdays(members, today) {
  return members.map(m => ({ member: m, nb: nextBirthday(m.birthday, today) })).filter(x => x.nb)
    .map(x => ({ member: x.member, date: x.nb.date, days: x.nb.days }))
    .sort((a, b) => a.days - b.days || String(a.member.name).localeCompare(String(b.member.name), 'he'));
}

export const missingBirthday = members => members.filter(m => !parseBirthday(m.birthday));

export function daysLabel(days) {
  if (days === 0) return 'היום';
  if (days === 1) return 'מחר';
  if (days === 2) return 'מחרתיים';
  return 'בעוד ' + days + ' ימים';
}
