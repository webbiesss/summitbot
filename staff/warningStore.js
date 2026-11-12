'use strict';

// The ONLY warning-specific writer. Preserves other stafflogs.json keys and
// writes a permanent audit trail of human changes. No automated warning logic.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.SUMMITBOT_STAFF_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'stafflogs.json');
const MAX_WARNINGS = 999;

function loadDatabase() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db || typeof db !== 'object' || Array.isArray(db) ||
        (db.staff !== undefined && (!db.staff || typeof db.staff !== 'object' || Array.isArray(db.staff)))) {
      throw new Error('Expected a stafflogs object containing a staff object');
    }
    return db;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, staff: {} };
    throw new Error(`Cannot read stafflogs.json: ${error.message}`);
  }
}

function writeDatabase(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(db, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, DB_FILE);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function storedCount(raw) {
  if (raw === undefined || raw === null) return 0;
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new Error('Existing warning count is invalid; correct stafflogs.json before editing.');
  }
  return raw;
}

function parseCount(input, label) {
  const value = String(input ?? '').trim();
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${label} must be a whole number from 0 to ${MAX_WARNINGS}.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > MAX_WARNINGS) {
    throw new Error(`${label} must be a whole number from 0 to ${MAX_WARNINGS}.`);
  }
  return number;
}

function sanitizeReason(value) {
  const reason = String(value ?? '').trim();
  if (reason.length > 300) throw new Error('Reason must be 300 characters or fewer.');
  return reason;
}

function readSnapshotFrom(db, userId) {
  const person = db.staff?.[userId] || {};
  return {
    guide: storedCount(person.guide?.warnings),
    sar: storedCount(person.sar?.warnings),
    revision: Number.isSafeInteger(person.warningRevision) && person.warningRevision >= 0
      ? person.warningRevision : 0,
    history: Array.isArray(person.warningHistory) ? person.warningHistory : [],
  };
}

function getWarnings(userId) {
  return readSnapshotFrom(loadDatabase(), userId);
}

// Set the new TOTALS rather than adding a delta. Setting 0 removes warnings.
// expectedRevision AND old totals guard against concurrent/stale confirmation.
function setWarnings({ userId, actorId, guide, sar, reason = '', expectedRevision, expectedGuide, expectedSar }) {
  if (!/^\d{17,20}$/.test(String(userId)) || !/^\d{17,20}$/.test(String(actorId))) {
    throw new Error('Invalid staff or editor Discord user ID.');
  }
  const nextGuide = parseCount(guide, 'Guide warnings');
  const nextSar = parseCount(sar, 'S&R warnings');
  const cleanReason = sanitizeReason(reason);
  const db = loadDatabase();
  db.staff ||= {};
  const current = readSnapshotFrom(db, userId);
  if (current.revision !== expectedRevision ||
      current.guide !== expectedGuide || current.sar !== expectedSar) {
    throw new Error('Warnings changed since you opened the editor. Refresh and try again.');
  }
  if (current.guide === nextGuide && current.sar === nextSar) {
    throw new Error('No warning totals were changed.');
  }

  const changes = [];
  if (nextGuide !== current.guide) {
    changes.push({ department: 'guide', from: current.guide, to: nextGuide,
      delta: nextGuide - current.guide });
  }
  if (nextSar !== current.sar) {
    changes.push({ department: 'sar', from: current.sar, to: nextSar,
      delta: nextSar - current.sar });
  }
  const timestamp = new Date().toISOString();
  const person = db.staff[userId] ||= {};
  person.guide ||= {};
  person.sar ||= {};
  person.guide.warnings = nextGuide;
  person.sar.warnings = nextSar;
  person.warningRevision = current.revision + 1;
  person.warningHistory ||= [];
  person.warningHistory.push({
    id: crypto.randomUUID(), action: 'manual_adjustment',
    by: actorId, at: timestamp, reason: cleanReason, changes,
  });
  writeDatabase(db);
  return readSnapshotFrom(db, userId);
}

module.exports = { getWarnings, setWarnings, parseCount, MAX_WARNINGS };