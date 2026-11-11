'use strict';

// READ-ONLY. Another module will maintain the quota/payment JSON files.
const fs = require('node:fs');
const path = require('node:path');
const cfg = require('./profileconfig');

const dataDir = process.env.SUMMITBOT_STAFF_DATA_DIR || path.join(__dirname, '..', 'data');

function readJson(name, fallback) {
  const filepath = path.join(dataDir, name);
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Expected JSON object');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read data/${name}: ${error.message}`);
  }
}

function nonnegative(value) {
  // A negative correction is allowed upstream, but counters cannot display negative totals.
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function number(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function counts(raw) {
  return {
    week: nonnegative(raw?.week),
    month: nonnegative(raw?.month),
    allTime: nonnegative(raw?.allTime),
  };
}

function loadStaffProfileData(userId) {
  const logs = readJson('stafflogs.json', { staff: {} });
  const payments = readJson('staffpayments.json', { staff: {} });
  const log = logs.staff?.[userId] || {};
  const payment = payments.staff?.[userId] || {};

  const hosted = counts(log.guide?.hosted);
  const coHosted = counts(log.guide?.coHosted);
  const rescues = counts(log.sar?.rescues);

  return {
    guide: {
      hosted,
      coHosted,
      // Computed by your FUTURE /staffquota writer; this profile only reads it.
      weeklyPoints: number(log.guide?.weeklyPoints),
      quota: cfg.guideWeeklyQuota,
      warnings: nonnegative(log.guide?.warnings),
    },
    sar: {
      rescues,
      weeklyPoints: number(log.sar?.weeklyPoints),
      quota: cfg.sarWeeklyQuota,
      warnings: nonnegative(log.sar?.warnings),
    },
    payments: {
      // 'paid' must mean ACTUALLY paid, as recorded by a payment-management command.
      currentWeekDue: number(payment.currentWeekDue),
      robuxPaid: nonnegative(payment.robuxPaid),
    },
  };
}

function formatRobux(amount) {
  return `${number(amount).toLocaleString('en-CA', { maximumFractionDigits: 2 })} Robux`;
}

function roleOrHigher(member, roleId) {
  if (member.roles.cache.has(roleId)) return true;
  const requiredRole = member.guild.roles.cache.get(roleId);
  // Fail closed when the hierarchy role can't be found.
  return Boolean(requiredRole && member.roles.highest.position >= requiredRole.position);
}

function hasDepartmentRole(member, roleId) {
  // Department membership must be an EXACT role match, not a hierarchy comparison.
  return member.roles.cache.has(roleId);
}

function getLocalToday(timezone = cfg.timezone) {
  const fields = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => fields.find((p) => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

module.exports = {
  loadStaffProfileData, formatRobux, roleOrHigher, hasDepartmentRole,
  getLocalToday,
};