// Checks rate.mjs outside FourFold. Run: node .check/rate.check.mjs
import assert from 'node:assert/strict';
import {
  LIVE_RATE_MIN_MS, applyLiveResult, applyRead, createSession, endLive, parseGoal, rateAt, rateNow, startLive, statusOf,
  toGoal
} from '../rate.mjs';

const ms = minutes => Date.UTC(2026, 9, 4, 12, 0) + minutes * 60000;
const at = minutes => new Date(ms(minutes)).toISOString();
const read = (silver, minutes, isStale = false) => ({ silver, updatedAt: at(minutes), isStale });
const feed = (...reads) => {
  const session = createSession();
  for (const next of reads) applyRead(session, next);
  return session;
};
const rate = session => rateAt(session, session.lastAt);
const net = session => session.lastBalance - session.startBalance;

// One read alone gives no rate. Two reads a minute apart: 600 silver in 60 seconds is 36,000 an hour.
assert.equal(rate(feed(read(1000, 0))), null);
let session = feed(read(1000, 0), read(1600, 1));
assert.equal(session.earned, 600);
assert.equal(Math.round(rate(session)), 36000);

// Spending adds nothing to earned and never makes the rate negative. Net does go negative.
session = feed(read(5000, 0), read(2000, 1), read(2500, 2));
assert.equal(session.earned, 500);
assert.equal(net(session), -2500);
assert.equal(Math.round(rate(session)), 15000);

// A failed read, then a good one half an hour later with far more silver: no interval spans the gap, so the rate
// doesn't spike. Net is still the true change.
session = feed(read(1000, 0), read(1100, 1), read(1100, 1, true), read(9000, 30), read(9100, 31));
assert.equal(session.intervals.length, 2);
assert.equal(session.earned, 200);
assert.equal(net(session), 8100);
assert.equal(Math.round(rate(session)), 6000);

// The same read twice, or one stamped earlier than the last, changes nothing.
session = feed(read(1000, 0), read(1600, 1), read(1600, 1), read(99999, 0));
assert.equal(session.earned, 600);
assert.equal(session.intervals.length, 1);

// A read with no silver or no time counts as missed, like a stale one.
session = feed(read(1000, 0), { silver: null, updatedAt: null, isStale: false }, read(5000, 1), read(5100, 2));
assert.equal(session.earned, 100);

// The status never calls old numbers live. If the page stops giving silver while the read itself still succeeds,
// the account shows as stale until silver is back.
assert.equal(statusOf(createSession(), 0), 'No data yet');
assert.equal(statusOf(feed(read(1000, 0)), 0), 'Collecting baseline');
assert.equal(statusOf(feed(read(1000, 0), read(1600, 1)), 0), 'Tracking (polled)');
session = feed(read(1000, 0), read(1600, 1), { silver: null, updatedAt: at(2), isStale: false });
assert.equal(statusOf(session, 0), 'Stale; the last read failed');
applyRead(session, read(1700, 3));
assert.equal(statusOf(session, 0), 'Tracking (polled)');
assert.equal(statusOf(feed(read(1000, 0), read(1000, 0, true)), 0), 'Stale; the last read failed');

// Only the last hour counts. An interval that ended before it is dropped; one that straddles it counts in part.
session = feed(read(0, 0), read(60000, 1), read(60000, 90), read(60000, 91));
assert.equal(rate(session), 0);
assert.equal(session.earned, 60000);
assert.equal(Math.round(rate(feed(read(0, 0), read(1200, 120)))), 600);

// Live: each fight's silver counts once. A read while live only updates the balance, even when it shows the same
// fights' silver, so nothing is counted twice.
session = feed(read(1000, 0));
startLive(session, ms(1));
applyLiveResult(session, 300, ms(2));
applyRead(session, read(1300, 2.5));
applyLiveResult(session, 300, ms(3));
assert.equal(session.earned, 600);
assert.equal(session.lastBalance, 1300);
// A late fight adds nothing.
applyLiveResult(session, 300, ms(2));
assert.equal(session.earned, 600);
// 600 over the 2 watched minutes is 18,000 an hour; 4 more idle minutes bring it down to 6,000.
assert.equal(Math.round(rateNow(session, ms(3))), 18000);
assert.equal(Math.round(rateNow(session, ms(7))), 6000);
assert.equal(statusOf(session, ms(7)), 'Live');

// No live rate until a minute has been watched: the first fight can't read as millions an hour.
session = createSession();
startLive(session, ms(0));
applyLiveResult(session, 500, ms(0.25));
assert.equal(rateNow(session, ms(0) + LIVE_RATE_MIN_MS - 1), null);
assert.notEqual(rateNow(session, ms(0) + LIVE_RATE_MIN_MS), null);

// Two results with the same time are one batch of game data: both count, in the same interval.
session = createSession();
startLive(session, ms(0));
applyLiveResult(session, 300, ms(2));
applyLiveResult(session, 200, ms(2));
assert.equal(session.earned, 500);
assert.deepEqual(session.intervals.map(interval => interval.gain), [500]);

// A failed read while live is shown, not hidden behind "Live".
applyRead(session, read(1000, 2.5, true));
assert.equal(statusOf(session, ms(3)), 'Live; balance not updated');

// Back to reads after a live stretch: the first two reads are new baselines, because the profile can lag the last
// fight, so the second read may be the first to show its silver, which was already counted from the fights.
session = feed(read(1000, 0));
startLive(session, ms(0.5));
applyLiveResult(session, 500, ms(1));
endLive(session, ms(1.1));
applyRead(session, read(1000, 1.2)); // lags the fight
applyRead(session, read(1500, 2.2)); // the fight's silver at last
applyRead(session, read(1600, 3.2));
assert.equal(session.earned, 600);
assert.deepEqual(session.intervals.map(interval => interval.gain), [500, 0, 100]);
assert.equal(statusOf(session, ms(3.2)), 'Tracking (polled)');

// Leaving live keeps the idle time watched since the last fight, so the polled rate doesn't jump: 3,000 silver over
// 30 minutes of fights and 30 idle is about 3,000 an hour either side of the switch.
session = feed(read(0, 0));
startLive(session, ms(0));
for (let minute = 1; minute <= 30; minute++) applyLiveResult(session, 100, ms(minute));
assert.equal(Math.round(rateNow(session, ms(60))), 3000);
endLive(session, ms(60));
applyRead(session, read(3000, 60.5));
assert.ok(Math.abs(rateNow(session, ms(60.5)) - 3000) < 100);

// A goal is a whole number above zero, with commas or spaces as separators. Anything else is no goal.
assert.equal(parseGoal('1,000,000'), 1000000);
assert.equal(parseGoal(' 250 000 '), 250000);
for (const bad of ['', '0', '-5', '1.5', '1e9', 'abc', '9'.repeat(16)]) assert.equal(parseGoal(bad), null);

// Time to a goal needs a rate above zero. A reached goal has nothing left.
assert.deepEqual(toGoal(1000, 400, 300), { remaining: 600, progress: 0.4, hours: 2 });
assert.equal(toGoal(1000, 400, null).hours, null);
assert.equal(toGoal(1000, 400, 0).hours, null);
assert.deepEqual(toGoal(1000, 2500, 300), { remaining: 0, progress: 1, hours: null });

console.log('rate.mjs: all checks passed');
