import assert from 'node:assert/strict';
import { allocate, settle, participants } from '../public/js/settle.js';

// allocation never loses a cent
for (const [t, w] of [[10000, { a: 1, b: 1, c: 1 }], [1, { a: 1, b: 1 }], [99999, { a: 3, b: 2, c: 1, d: 1 }]]) {
  const o = allocate(t, w); assert.equal(Object.values(o).reduce((s, x) => s + x, 0), t);
}

const ev = { id: 'e', days: 3, attendance: { '1': ['a', 'b', 'c'], '2': ['a', 'b'], '3': ['a', 'b'] } };
assert.deepEqual(participants(ev), { a: [1, 2, 3], b: [1, 2, 3], c: [1] });

// weighted by days attended: a,b = 3 days, c = 1 day (total weight 7)
let r = settle(ev, [{ amountCents: 70000, payerId: 'a', type: 'מזון', sharerIds: [], dayList: [], mode: 'days' }]);
const sh = Object.fromEntries(r.rows.map(x => [x.id, x.share]));
assert.deepEqual(sh, { a: 30000, b: 30000, c: 10000 });
assert.equal(r.rows.reduce((s, x) => s + x.balance, 0), 0);
assert.deepEqual(r.transfers.map(t => [t.from, t.cents]).sort(), [['b', 30000], ['c', 10000]]);

// meat bought for day 1 only: all three present that day, equal thirds
r = settle(ev, [{ amountCents: 3000, payerId: 'c', type: 'מזון', sharerIds: [], dayList: [1], mode: 'days' }]);
assert.deepEqual(Object.fromEntries(r.rows.map(x => [x.id, x.share])), { a: 1000, b: 1000, c: 1000 });
// day 2 only: c did not attend -> only a and b pay
r = settle(ev, [{ amountCents: 3000, payerId: 'a', type: 'מזון', sharerIds: [], dayList: [2], mode: 'days' }]);
assert.deepEqual(Object.fromEntries(r.rows.filter(x => x.share).map(x => [x.id, x.share])), { a: 1500, b: 1500 });   // c was absent
// equal mode ignores number of days
r = settle(ev, [{ amountCents: 3000, payerId: 'a', type: 'לינה', sharerIds: [], dayList: [], mode: 'equal' }]);
assert.deepEqual(Object.fromEntries(r.rows.map(x => [x.id, x.share])), { a: 1000, b: 1000, c: 1000 });
// chosen sharers only
r = settle(ev, [{ amountCents: 3000, payerId: 'a', type: 'אלכוהול', sharerIds: ['a', 'c'], dayList: [], mode: 'days' }]);
assert.deepEqual(Object.fromEntries(r.rows.filter(x => x.share).map(x => [x.id, x.share])), { a: 2250, c: 750 });   // 3 days vs 1 day
// nobody present on the covered days: warning + equal fallback among sharers
r = settle({ ...ev, attendance: { '1': ['a'] } }, [{ amountCents: 1000, payerId: 'a', type: 'מזון', sharerIds: ['a'], dayList: [3], mode: 'days' }]);
assert.equal(r.warnings.length, 1); assert.equal(r.rows[0].share, 1000);
// no attendees at all
r = settle({ id: 'x', days: 2, attendance: {} }, [{ amountCents: 1000, payerId: 'a', type: 'מזון', sharerIds: [], dayList: [], mode: 'days' }]);
assert.equal(r.warnings.length, 1);
// a payer who is not an attendee is refunded
r = settle(ev, [{ amountCents: 600, payerId: 'z', type: 'אחר', sharerIds: [], dayList: [], mode: 'equal' }]);
assert.ok(r.rows.find(x => x.id === 'z').balance === 600);
assert.equal(r.transfers.reduce((s, t) => s + t.cents, 0), 600);
console.log('settle ok');
