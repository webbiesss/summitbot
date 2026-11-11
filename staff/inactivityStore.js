'use strict';

// The only component in this package that WRITES JSON is this inactivity store.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dataDir = process.env.SUMMITBOT_STAFF_DATA_DIR || path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'staffinactivitynotices.json');

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    if (!db || !Array.isArray(db.notices)) {
      throw new Error('Expected an object with a notices array');
    }
    return db;
  } catch (err) {
    if (err.code === 'ENOENT') return { schemaVersion: 1, notices: [] };
    throw new Error(`Cannot load staffinactivitynotices.json: ${err.message}`);
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(tmp, dbFile);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function checkDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function durationDays(startDate, endDate) {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) -
    Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
}

function validateForm(startDate, endDate, reason) {
  const start = String(startDate || '').trim();
  const end = String(endDate || '').trim();
  const cleanReason = String(reason || '').trim();
  if (!checkDate(start) || !checkDate(end)) {
    throw new Error('Enter both dates as YYYY-MM-DD (for example 2026-12-21).');
  }
  if (end < start) throw new Error('The end date must be on or after the start date.');
  if (!cleanReason || cleanReason.length > 500) {
    throw new Error('A reason between 1 and 500 characters is required.');
  }
  return { startDate: start, endDate: end, reason: cleanReason };
}

function listForUser(userId) {
  return load().notices.filter((item) => item.userId === userId);
}

function noticeStatus(item, today) {
  if (item.endDate < today) return 'expired';
  if (item.removedAt) return item.startDate > today ? 'removed-future' : 'removed-current';
  return item.startDate > today ? 'future' : 'current';
}

function createNotice(userId, actorId, data) {
  const form = validateForm(data.startDate, data.endDate, data.reason);
  const db = load();
  const timestamp = new Date().toISOString();
  const notice = {
    id: crypto.randomUUID(), userId, ...form,
    createdBy: actorId, createdAt: timestamp,
    editedBy: null, editedAt: null,
    removedBy: null, removedAt: null,
    revision: 1,
    history: [{ action: 'created', by: actorId, at: timestamp }],
  };
  db.notices.push(notice);
  save(db);
  return notice;
}

function updateNotice(userId, noticeId, actorId, data, expectedRevision) {
  const form = validateForm(data.startDate, data.endDate, data.reason);
  const db = load();
  const notice = db.notices.find((n) => n.id === noticeId && n.userId === userId);
  if (!notice) throw new Error('The inactivity notice no longer exists.');
  if (notice.removedAt) throw new Error('A removed inactivity notice cannot be edited.');
  if (notice.revision !== expectedRevision) {
    throw new Error('This notice changed while you were editing it. Reopen it and try again.');
  }
  const old = { startDate: notice.startDate, endDate: notice.endDate, reason: notice.reason };
  const timestamp = new Date().toISOString();
  Object.assign(notice, form, {
    editedBy: actorId, editedAt: timestamp,
    revision: notice.revision + 1,
  });
  if (!Array.isArray(notice.history)) notice.history = [];
  notice.history.push({ action: 'edited', by: actorId, at: timestamp, previous: old });
  save(db);
  return notice;
}

function removeNotice(userId, noticeId, actorId) {
  const db = load();
  const notice = db.notices.find((n) => n.id === noticeId && n.userId === userId);
  if (!notice) throw new Error('The inactivity notice no longer exists.');
  if (notice.removedAt) throw new Error('This notice was already removed.');
  const timestamp = new Date().toISOString();
  notice.removedBy = actorId;
  notice.removedAt = timestamp;
  notice.revision += 1;
  if (!Array.isArray(notice.history)) notice.history = [];
  notice.history.push({ action: 'removed', by: actorId, at: timestamp });
  save(db);
  return notice;
}

// For the future weekly warnings module. Overlap with ANY day exempts the ENTIRE week.
// This function DOES NOT add/remove warnings or perform any weekly processing.
function isExemptFromWeeklyWarning(userId, weekStart, weekEnd) {
  if (!checkDate(weekStart) || !checkDate(weekEnd) || weekStart > weekEnd) {
    throw new Error('Invalid ISO week date range.');
  }
  return listForUser(userId).some((n) => !n.removedAt &&
    n.startDate <= weekEnd && n.endDate >= weekStart);
}

module.exports = {
  load, listForUser, noticeStatus, durationDays, validateForm,
  createNotice, updateNotice, removeNotice, isExemptFromWeeklyWarning,
};