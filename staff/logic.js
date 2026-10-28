'use strict';
const crypto = require('node:crypto');
const config = require('./config');
const store = require('./store');
const DEPTS = ['guide', 'sar'];

function isoDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function addDays(day, count) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
function weekOf(day = isoDay()) {
  const d = new Date(`${day}T12:00:00Z`);
  const diff = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -diff);
}
function money(half) {
  return (half / 2).toFixed(half % 2 === 0 ? 0 : 1);
}
function halfFromInput(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw Error('Invalid Robux amount.');
  const half = Math.round(value * 2);
  if (Math.abs(value * 2 - half) > 1e-8) throw Error('Robux changes must be in increments of 0.5.');
  return half;
}
function newId() { return crypto.randomUUID(); }
function user(state, id) {
  if (!state.users[id]) state.users[id] = {
    memberships: { guide: null, sar: null },
    quota: { guideHalf: 0, sarRescues: 0 },
    warnings: { guide: 0, sar: 0 },
    balanceHalf: 0,
    creditedHalf: 0
  };
  return state.users[id];
}
function audit(state, action, actor, details) {
  state.audit.push({ id: newId(), at: new Date().toISOString(), action, actor, details });
}
function readCurrent() {
  return store.read(weekOf());
}
function enrolled(member, department, week) {
  return Boolean(member.memberships[department] && member.memberships[department].enrolledWeek <= week);
}
function checkDepartment(dept) {
  if (!DEPTS.includes(dept)) throw Error('Department must be guide or sar.');
}
function ensureCurrentWeek(state) {
  if (state.activeWeek !== weekOf()) throw Error('Weekly rollover is pending. Try again shortly.');
}
function recordActivity({ actor, userId, department, kind, count, attendees = 0, validated = false, validatedBy = null }) {
  checkDepartment(department);
  if (!Number.isInteger(count) || count === 0 || Math.abs(count) > 1000) {
    throw Error('Count must be a nonzero signed whole number from -1000 to 1000.');
  }
  if (department === 'guide') {
    if (!['host', 'cohost'].includes(kind)) throw Error('Unknown Guide activity.');
    if (!Number.isInteger(attendees) || attendees < 0 || attendees > 1000) throw Error('Attendees must be 0–1000, excluding host and co-host.');
  } else {
    if (!['heal', 'lost', 'supply'].includes(kind)) throw Error('Unknown S&R rescue type.');
    if (!validated || !validatedBy) throw Error('A host/co-host validator must be recorded for each rescue.');
  }
  const state = readCurrent();
  ensureCurrentWeek(state);
  const member = user(state, userId);
  if (!enrolled(member, department, state.activeWeek)) throw Error('Staff member is not enrolled in this department. Use /staffdepartment first.');
  const entry = {
    id: newId(), at: new Date().toISOString(), actor, userId, department, kind,
    count, attendees: department === 'guide' ? attendees : 0,
    week: state.activeWeek, month: isoDay().slice(0, 7),
    validated: department === 'sar' ? true : null,
    validatedBy: department === 'sar' ? validatedBy : null
  };
  state.activities.push(entry);
  if (department === 'guide') member.quota.guideHalf += count * (kind === 'host' ? 2 : 1);
  else member.quota.sarRescues += count;
  const changes = reconcile(state);
  audit(state, 'activity', actor, entry);
  store.write(state);
  return { member, entry, balanceChangeHalf: changes[userId] || 0, state };
}
function adjustQuota({ actor, userId, department, deltaHalfPoints, deltaRescues, explanation }) {
  checkDepartment(department);
  if (!explanation || !explanation.trim()) throw Error('An explanation is required.');
  const delta = department === 'guide' ? deltaHalfPoints : deltaRescues;
  if (!Number.isInteger(delta) || !delta || Math.abs(delta) > 1000) throw Error('Signed quota adjustment must be a nonzero whole number of half-points (Guide) or rescues (S&R).');
  const state = readCurrent();
  ensureCurrentWeek(state);
  const member = user(state, userId);
  if (!enrolled(member, department, state.activeWeek)) throw Error('Staff member is not enrolled in that department.');
  if (department === 'guide') member.quota.guideHalf += delta;
  else member.quota.sarRescues += delta;
  audit(state, 'quota_manual_adjustment', actor, { userId, department, delta, explanation });
  store.write(state);
  return member;
}
function setMembership({ actor, userId, department, enabled }) {
  checkDepartment(department);
  const state = readCurrent();
  ensureCurrentWeek(state);
  const member = user(state, userId);
  member.memberships[department] = enabled ? { enrolledWeek: state.activeWeek } : null;
  audit(state, 'membership', actor, { userId, department, enabled });
  store.write(state);
  return member;
}

// Recompute earned payouts entirely from the immutable activity log. Credit ONLY
// changes from prior calculations; manual edits / cleared balances remain intact.
// This makes corrections reversible without double-crediting older entries.
function calculateEarnings(state) {
  const raw = new Map(); // key = userId\tweek\tmonth\tdepartment
  const byMonth = new Map();
  const latestAny = new Map();
  const latestPositive = new Map();
  const sorted = state.activities.slice().sort((a, b) => a.at.localeCompare(b.at));
  function rawAdd(a, half) {
    const key = `${a.userId}\t${a.week}\t${a.month}\t${a.department}`;
    raw.set(key, (raw.get(key) || 0) + half);
  }
  for (const a of sorted) {
    const wk = `${a.userId}\t${a.week}`;
    latestAny.set(wk, a);
    const rate = a.department === 'guide'
      ? (a.kind === 'host' ? config.pay.guideHostHalf : config.pay.guideCohostHalf)
      : ({ heal: config.pay.sarHealHalf, lost: config.pay.sarLostHalf,
        supply: config.pay.sarSupplyHalf }[a.kind]);
    rawAdd(a, rate * a.count);
    const group = `${a.userId}\t${a.month}\t${a.department}`;
    if (!byMonth.has(group)) byMonth.set(group, []);
    byMonth.get(group).push(a);
  }
  // Reverse the most recently entered *matching* units when count is negative.
  // Only still-valid positive work can decide the latest active department.
  for (const [group, activities] of byMonth) {
    const dept = group.split('\t')[2];
    const units = [];
    for (const a of activities) {
      if (a.count > 0) {
        for (let n = 0; n < a.count; n++) units.push({ a, removed: false });
      } else {
        let toRemove = -a.count;
        for (let n = units.length - 1; n >= 0 && toRemove > 0; n--) {
          if (!units[n].removed && units[n].a.kind === a.kind) {
            units[n].removed = true;
            toRemove--;
          }
        }
      }
    }
    const valid = units.filter(unit => !unit.removed);
    for (const { a } of valid) {
      const wk = `${a.userId}\t${a.week}`;
      if (!latestPositive.has(wk) || latestPositive.get(wk).at <= a.at) latestPositive.set(wk, a);
    }
    if (dept === 'guide') {
      for (const { a } of valid.slice(0, config.pay.guideAttendeeBonusExpeditionsPerMonth)) {
        rawAdd(a, a.attendees * config.pay.guideAttendeeHalf);
      }
    }
  }
  const selected = new Map();
  for (const [key, a] of latestAny) selected.set(key, (latestPositive.get(key) || a).department);
  const eligible = new Map(); // per-user, per-month, per-department, per-week totals
  for (const [key, amount] of raw) {
    const [uid, week, month, department] = key.split('\t');
    if (selected.get(`${uid}\t${week}`) !== department) continue;
    const group = `${uid}\t${month}\t${department}`;
    if (!eligible.has(group)) eligible.set(group, new Map());
    eligible.get(group).set(week, (eligible.get(group).get(week) || 0) + amount);
  }
  const totals = {};
  const weekly = {};
  for (const [group, byWeek] of eligible) {
    const [uid, , dept] = group.split('\t');
    let running = 0;
    let previousCapped = 0;
    const cap = config.pay.applyMonthlyCaps ?
      (dept === 'guide' ? config.pay.guideMonthlyCapHalf : config.pay.sarMonthlyCapHalf) : Infinity;
    for (const [week, rawHalf] of [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      running += rawHalf;
      const capped = Math.max(0, Math.min(cap, running));
      const gained = capped - previousCapped;
      previousCapped = capped;
      totals[uid] = (totals[uid] || 0) + gained;
      if (!weekly[week]) weekly[week] = {};
      if (!weekly[week][uid]) weekly[week][uid] = { department: dept, earnedHalf: 0, grossHalf: 0 };
      weekly[week][uid].earnedHalf += gained;
      weekly[week][uid].grossHalf += rawHalf;
    }
  }
  return { totals, weekly, selected };
}
function reconcile(state) {
  const { totals } = calculateEarnings(state);
  const changes = {};
  for (const id of new Set([...Object.keys(state.users), ...Object.keys(totals)])) {
    const member = user(state, id);
    const earned = totals[id] || 0;
    const delta = earned - member.creditedHalf;
    if (delta) {
      member.balanceHalf += delta;
      state.ledger.push({ id: newId(), at: new Date().toISOString(), userId: id, kind: 'earned_reconciliation', deltaHalf: delta });
      changes[id] = delta;
    }
    member.creditedHalf = earned;
  }
  return changes;
}
function editPayment({ actor, userId, mode, amountHalf, explanation }) {
  if (!['add', 'set'].includes(mode)) throw Error('Payment mode must be add or set.');
  if (!Number.isInteger(amountHalf)) throw Error('Amount must be in 0.5 Robux increments.');
  if (!explanation?.trim()) throw Error('A reason is required.');
  const state = readCurrent();
  const member = user(state, userId);
  const fromHalf = member.balanceHalf;
  member.balanceHalf = mode === 'set' ? amountHalf : member.balanceHalf + amountHalf;
  state.ledger.push({ id: newId(), at: new Date().toISOString(), userId, actor, kind: 'manual_payment_edit', fromHalf, toHalf: member.balanceHalf, explanation });
  audit(state, 'payment_edit', actor, { userId, mode, amountHalf, explanation, fromHalf, toHalf: member.balanceHalf });
  store.write(state);
  return member;
}
function editWarnings({ actor, userId, department, mode, value, explanation }) {
  checkDepartment(department);
  if (!['add', 'set'].includes(mode) || !Number.isInteger(value) || Math.abs(value) > 1000) throw Error('Invalid warnings edit.');
  if (!explanation?.trim()) throw Error('A reason is required.');
  const state = readCurrent();
  const member = user(state, userId);
  const before = member.warnings[department];
  member.warnings[department] = Math.max(0, mode === 'set' ? value : before + value);
  audit(state, 'warnings_edit', actor, { userId, department, mode, value, before, after: member.warnings[department], explanation });
  store.write(state);
  return member;
}
function validDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day) {
    throw Error('Enter a real date as YYYY-MM-DD.');
  }
}
function addNotice({ actor, userId, start, end, reason }) {
  validDay(start); validDay(end);
  if (end < start) throw Error('End date must be on or after start date.');
  if (end < isoDay()) throw Error('Cannot add an already expired notice.');
  if (!reason?.trim()) throw Error('Inactivity reason is required.');
  const state = readCurrent();
  user(state, userId);
  const notice = { id: newId().slice(0, 8), userId, start, end, reason, actor, createdAt: new Date().toISOString(), removedAt: null };
  state.notices.push(notice);
  audit(state, 'inactivity_add', actor, notice);
  store.write(state);
  return notice;
}
function removeNotice({ actor, id }) {
  const state = readCurrent();
  const n = state.notices.find(x => x.id === id && !x.removedAt && x.end >= isoDay());
  if (!n) throw Error('No active notice with that ID.');
  n.removedAt = new Date().toISOString();
  audit(state, 'inactivity_remove', actor, { id, userId: n.userId });
  store.write(state);
  return n;
}
function noticeCoversWeek(n, week) {
  // End is inclusive. A single day of overlapping inactivity exempts the week.
  return n.start < addDays(week, 7) && n.end >= week &&
    (!n.removedAt || isoDay(new Date(n.removedAt)) > week);
}
function activeNotices(state, id = null) {
  return state.notices.filter(n => (!id || n.userId === id) && !n.removedAt && n.start <= isoDay() && n.end >= isoDay());
}
function futureNotices(state, id = null) {
  return state.notices.filter(n => (!id || n.userId === id) && !n.removedAt && n.start > isoDay());
}
function quotaRows(state, dept) {
  checkDepartment(dept);
  return Object.entries(state.users)
    .filter(([, m]) => enrolled(m, dept, state.activeWeek))
    .map(([id, m]) => ({ id, quota: dept === 'guide' ? m.quota.guideHalf / 2 : m.quota.sarRescues,
      warnings: m.warnings[dept], exempt: state.notices.some(n => n.userId === id && noticeCoversWeek(n, state.activeWeek)) }))
    .sort((a, b) => b.quota - a.quota || a.id.localeCompare(b.id));
}
function payoutRows(state) {
  return Object.entries(state.users)
    .filter(([, m]) => m.balanceHalf !== 0 || m.creditedHalf !== 0 || m.memberships.guide || m.memberships.sar)
    .map(([id, m]) => ({ id, balanceHalf: m.balanceHalf }))
    .sort((a, b) => b.balanceHalf - a.balanceHalf || a.id.localeCompare(b.id));
}
function closeWeek(state, week) {
  const { weekly } = calculateEarnings(state);
  const rows = [];
  for (const [id, member] of Object.entries(state.users)) {
    for (const dept of DEPTS) {
      if (!enrolled(member, dept, week)) continue;
      // quota values only belong to activeWeek. Missed weeks have zero quota.
      const score = week === state.activeWeek ? (dept === 'guide' ? member.quota.guideHalf : member.quota.sarRescues) : 0;
      const target = dept === 'guide' ? config.quota.guideHalfPoints : config.quota.sarRescues;
      const exempt = state.notices.some(n => n.userId === id && noticeCoversWeek(n, week));
      const before = member.warnings[dept];
      let result;
      if (exempt) result = 'EXEMPT';
      else if (score < target) { member.warnings[dept]++; result = 'WARNING +1'; }
      else if (dept === 'guide' && member.warnings.guide > 0) {
        member.warnings.guide--;
        result = 'GUIDE WARNING -1';
      } else result = 'PASSED';
      rows.push({ id, dept, score: dept === 'guide' ? score / 2 : score,
        target: dept === 'guide' ? target / 2 : target, exempt, result,
        warningsBefore: before, warningsAfter: member.warnings[dept],
        paidThisWeekHalf: (weekly[week]?.[id]?.department === dept ? weekly[week][id].earnedHalf : 0) });
    }
  }
  const snapshot = { week, closedAt: new Date().toISOString(), rows,
    balances: payoutRows(state), activeNotices: state.notices.filter(n => noticeCoversWeek(n, week)) };
  const filename = store.archive('week_' + week, snapshot);
  state.closedWeeks.push({ week, closedAt: snapshot.closedAt, filename, rows });
  audit(state, 'weekly_close', 'SYSTEM', { week, filename, staffReviewed: rows.length });
  for (const member of Object.values(state.users)) {
    member.quota.guideHalf = 0;
    member.quota.sarRescues = 0;
  }
  state.activeWeek = addDays(week, 7);
  store.write(state);
  return { ...snapshot, filename };
}
function rollover() {
  const state = readCurrent();
  const current = weekOf();
  if (state.activeWeek > current) throw Error('Staff data week is in the future; check timezone/config.');
  const results = [];
  while (state.activeWeek < current) {
    // Limit catch-up to avoid an accidental unbounded batch if a bad date is stored.
    if (results.length >= 520) throw Error('More than ten years of missing weeks: manual intervention required.');
    results.push(closeWeek(state, state.activeWeek));
  }
  return results;
}
function wipe({ actor, kind }) {
  const allowed = ['guide', 'sar', 'payments'];
  if (!allowed.includes(kind)) throw Error('Unknown wipe.');
  const state = readCurrent();
  ensureCurrentWeek(state);
  const paymentsBefore = payoutRows(state);
  const quotasBefore = kind === 'payments' ? null : quotaRows(state, kind);
  const snapshot = {
    at: new Date().toISOString(), actor, kind, week: state.activeWeek,
    paymentsBefore, quotasBefore,
    balancesHalf: Object.fromEntries(Object.entries(state.users).map(([id, m]) => [id, m.balanceHalf]))
  };
  const filename = store.archive('wipe_' + kind, snapshot); // archive FIRST
  if (kind === 'payments') {
    for (const member of Object.values(state.users)) member.balanceHalf = 0;
    state.ledger.push({ id: newId(), at: snapshot.at, actor, kind: 'payments_wipe', filename, paymentsBefore });
  } else {
    for (const member of Object.values(state.users)) {
      if (kind === 'guide') member.quota.guideHalf = 0;
      else member.quota.sarRescues = 0;
    }
  }
  audit(state, 'wipe_' + kind, actor, { filename, week: state.activeWeek });
  store.write(state);
  return { filename, snapshot };
}
module.exports = {
  isoDay, addDays, weekOf, money, halfFromInput, user, readCurrent, enrolled,
  recordActivity, adjustQuota, setMembership, calculateEarnings, reconcile,
  editPayment, editWarnings, addNotice, removeNotice, noticeCoversWeek,
  activeNotices, futureNotices, quotaRows, payoutRows, rollover, wipe
};
