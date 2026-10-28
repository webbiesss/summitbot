'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'staffSystem.json');
const ARCHIVES = path.join(DATA_DIR, 'staffArchives');

function initialState(week) {
  return {
    version: 1,
    activeWeek: week,
    users: {},
    // All activity remains here after a weekly quota wipe for financial auditing.
    activities: [],
    notices: [],
    closedWeeks: [],
    ledger: [],
    audit: []
  };
}
function read(week) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    const state = initialState(week);
    write(state);
    return state;
  }
  const state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (state.version !== 1) throw new Error('Unexpected staffSystem.json schema version. Restore backup.');
  return state;
}
function write(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, FILE); // atomic rename on the same filesystem
}
function archive(type, snapshot) {
  fs.mkdirSync(ARCHIVES, { recursive: true });
  const safeType = type.replace(/[^a-zA-Z0-9_-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${safeType}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
  const target = path.join(ARCHIVES, name);
  fs.writeFileSync(target, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return name;
}
module.exports = { read, write, archive, FILE, ARCHIVES };
