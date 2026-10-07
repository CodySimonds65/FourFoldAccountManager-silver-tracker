// Session, rate and goal maths for the Silver tracker. Nothing here touches the page or window.fourfold, so
// .check/rate.check.mjs can run it with Node.

const HOUR_MS = 3600000;
// A live rate needs this much watched time first, so the first fight after a login doesn't read as millions an hour.
export const LIVE_RATE_MIN_MS = 60000;

// One account's session: what has been seen since tracking started. Times are milliseconds since the epoch. `live` is
// null while silver comes from profile reads, and { lastMark } while it comes from the live game feed's fights.
export function createSession() {
  return {
    startBalance: null, lastBalance: null, lastAt: null, intervals: [], earned: 0, missed: false, live: null,
    rebase: 0
  };
}

// Takes one answer from fourfold.profile.get.
export function applyRead(session, read) {
  const at = typeof read.updatedAt === 'string' ? Date.parse(read.updatedAt) : NaN;
  if (read.isStale || !Number.isFinite(read.silver) || Number.isNaN(at)) {
    session.missed = true;
    return;
  }
  // The same read again: xp.onUpdated also fires for changes that aren't a new read.
  if (session.lastAt !== null && at <= session.lastAt) return;
  if (session.live) {
    // The fights already count the silver earned; a read only brings the balance up to date.
    session.startBalance ??= read.silver;
    session.missed = false;
  } else if (session.lastAt === null || session.missed || session.rebase > 0) {
    // Nothing trustworthy to measure from. FourFold's XP tracker starts over after a missed read too. After a live
    // stretch, the silver between the last read and now was already counted from the fights.
    session.startBalance ??= read.silver;
    session.missed = false;
    session.rebase = Math.max(0, session.rebase - 1);
  } else {
    // Silver earned only: a drop is spending, and adds nothing.
    const gain = Math.max(0, read.silver - session.lastBalance);
    session.intervals.push({ from: session.lastAt, to: at, gain });
    session.earned += gain;
  }
  session.lastBalance = read.silver;
  session.lastAt = at;
  session.intervals = session.intervals.filter(interval => interval.to > at - HOUR_MS);
}

// The live game feed is watching the account from `at` on: from now, silver comes from its fights.
export function startLive(session, at) {
  if (!session.live) session.live = { lastMark: at };
}

// One fight's reward from battle.onResult. It counts from the last mark (the watch start or the previous fight) to
// this fight, so the time between fights is in the rate too. A result with the same time as the last one came in the
// same batch of game data, so it joins that fight's interval.
export function applyLiveResult(session, silver, at) {
  if (!session.live || !Number.isFinite(at) || at < session.live.lastMark) return;
  const gain = Number.isFinite(silver) ? Math.max(0, silver) : 0;
  if (at === session.live.lastMark) {
    const last = session.intervals.at(-1);
    if (last?.to === at) last.gain += gain;
    session.earned += gain;
    return;
  }
  session.intervals.push({ from: session.live.lastMark, to: at, gain });
  session.earned += gain;
  session.live.lastMark = at;
  session.intervals = session.intervals.filter(interval => interval.to > at - HOUR_MS);
}

// The feed stopped watching at `at` (a disconnect, or the feed switched off). The time since the last fight was
// watched and earned nothing, so it stays in the rate. The next two reads start a new baseline: their silver since the
// last read was already counted from the fights, and the profile can lag the last fight by a read.
export function endLive(session, at) {
  if (!session.live) return;
  if (at > session.live.lastMark) session.intervals.push({ from: session.live.lastMark, to: at, gain: 0 });
  session.live = null;
  session.rebase = 2;
}

// Silver per hour over the hour ending at `now`, or null when nothing in that hour was measured. The same sum as
// FourFold's XpRateWindow: each interval counts for the part of it inside the hour.
export function rateAt(session, now) {
  const start = now - HOUR_MS;
  let gain = 0;
  let covered = 0;
  for (const interval of session.intervals) {
    const overlap = Math.min(interval.to, now) - Math.max(interval.from, start);
    if (overlap <= 0) continue;
    gain += interval.gain * overlap / (interval.to - interval.from);
    covered += overlap;
  }
  return covered > 0 ? gain / covered * HOUR_MS : null;
}

// The rate to show at `now`. While live, the time since the last fight counts as earning nothing, so the rate falls
// while the account is idle instead of holding its last value; it waits for a minute of watched time first.
// Otherwise it is the rate at the last read, as before.
export function rateNow(session, now) {
  if (!session.live) return session.lastAt === null ? null : rateAt(session, session.lastAt);
  const open = now > session.live.lastMark ? [{ from: session.live.lastMark, to: now, gain: 0 }] : [];
  const watched = { intervals: [...session.intervals, ...open] };
  const covered = watched.intervals.reduce(
    (total, interval) => total + Math.max(0, Math.min(interval.to, now) - Math.max(interval.from, now - HOUR_MS)), 0);
  return covered < LIVE_RATE_MIN_MS ? null : rateAt(watched, now);
}

// The account's status line. A missed read shows as stale whatever the reason, so old numbers never pass as live.
export function statusOf(session, now) {
  if (session.live && session.missed) return 'Live; balance not updated';
  if (session.live) return rateNow(session, now) === null ? 'Live; collecting a minute first' : 'Live';
  if (session.lastAt === null) return 'No data yet';
  if (session.missed) return 'Stale; the last read failed';
  return rateAt(session, session.lastAt) === null ? 'Collecting baseline' : 'Tracking (polled)';
}

// A goal as the user typed it: digits, with commas or spaces as thousands separators. Null when it isn't a whole
// number above zero. A dot is refused, not read as a separator: "1.5" must not become 15.
export function parseGoal(text) {
  const digits = String(text).replace(/[\s,]/g, '');
  if (!/^\d{1,15}$/.test(digits)) return null;
  const goal = Number(digits);
  return goal > 0 ? goal : null;
}

// What is left to a goal and how long it takes at this rate. hours is null without a rate above zero.
export function toGoal(goal, balance, rate) {
  const remaining = Math.max(0, goal - balance);
  return {
    remaining,
    progress: Math.min(1, Math.max(0, balance / goal)),
    hours: remaining > 0 && rate > 0 ? remaining / rate : null
  };
}
