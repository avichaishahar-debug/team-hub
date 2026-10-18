import assert from 'node:assert/strict';
import { parseBirthday, nextBirthday, upcomingBirthdays, missingBirthday, daysLabel, isoDate } from '../public/js/team.js';

assert.deepEqual(parseBirthday('1982-03-05'), { m: 3, d: 5 });
assert.equal(parseBirthday(''), null);
assert.equal(parseBirthday(undefined), null);
assert.equal(parseBirthday('1982-13-05'), null);

assert.deepEqual(nextBirthday('1982-10-18', '2026-10-18'), { date: '2026-10-18', days: 0 });      // היום
assert.deepEqual(nextBirthday('1982-10-19', '2026-10-18'), { date: '2026-10-19', days: 1 });      // מחר
assert.deepEqual(nextBirthday('1982-10-17', '2026-10-18'), { date: '2027-10-17', days: 364 });    // עבר השנה
assert.deepEqual(nextBirthday('1990-01-02', '2026-12-30'), { date: '2027-01-02', days: 3 });      // חוצה שנה
assert.deepEqual(nextBirthday('1992-02-29', '2027-02-01'), { date: '2027-02-28', days: 27 });     // 29.2 בשנה לא מעוברת
assert.deepEqual(nextBirthday('1992-02-29', '2028-02-01'), { date: '2028-02-29', days: 28 });     // שנה מעוברת
assert.equal(nextBirthday('', '2026-10-18'), null);

const ms = [{ name: 'ב', birthday: '1980-12-01' }, { name: 'א', birthday: '1980-10-20' }, { name: 'ג', birthday: '' }, { name: 'ד', birthday: '1970-10-18' }];
const up = upcomingBirthdays(ms, '2026-10-18');
assert.deepEqual(up.map(x => x.member.name + ':' + x.days), ['ד:0', 'א:2', 'ב:44']);
assert.deepEqual(missingBirthday(ms).map(m => m.name), ['ג']);
assert.equal(daysLabel(0), 'היום'); assert.equal(daysLabel(1), 'מחר'); assert.equal(daysLabel(9), 'בעוד 9 ימים');
assert.match(isoDate(new Date(2026, 0, 5)), /^2026-01-05$/);
console.log('team ok');
