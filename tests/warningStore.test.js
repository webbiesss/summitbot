'use strict';

// Tests are isolated from real SummitBot data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-warning-test-'));
process.env.SUMMITBOT_STAFF_DATA_DIR = dir;
const store = require('../staff/warningStore');
const staffId = '123456789012345678';
const seniorId = '876543210987654321';
const file = path.join(dir, 'stafflogs.json');

function write(data) { fs.writeFileSync(file, JSON.stringify(data)); }
function read() { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function adjust(guide, sar, reason = '') {
  const old = store.getWarnings(staffId);
  return store.setWarnings({ userId: staffId, actorId: seniorId,
    guide, sar, reason, expectedGuide: old.guide, expectedSar: old.sar,
    expectedRevision: old.revision });
}

test('add and remove warnings without disturbing other staff records', () => {
  write({ schemaVersion: 1, staff: { [staffId]: {
    guide: { warnings: 2, hosted: { week: 1, month: 3, allTime: 10 }, weeklyPoints: 1 },
    sar: { warnings: 1, rescues: { week: 1, month: 1, allTime: 4 } },
    otherField: { keep: true },
  } }, guideExpeditions: { abc: { status: 'approved', guideId: staffId } } });
  let snapshot = adjust(3, 0, 'Guide missed weekly quota; S&R appeal accepted');
  assert.equal(snapshot.guide, 3);
  assert.equal(snapshot.sar, 0);
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.history[0].by, seniorId);
  assert.equal(snapshot.history[0].changes[0].delta, 1);
  assert.equal(snapshot.history[0].changes[1].delta, -1);
  let db = read();
  assert.equal(db.staff[staffId].guide.hosted.allTime, 10);
  assert.equal(db.staff[staffId].sar.rescues.allTime, 4);
  assert.deepEqual(db.staff[staffId].otherField, { keep: true });
  assert.ok(db.guideExpeditions.abc);
  snapshot = adjust(0, 0, 'Warning appeal accepted');
  assert.equal(snapshot.guide, 0);
  assert.equal(snapshot.history.length, 2);
  assert.equal(snapshot.history[1].changes[0].delta, -3);
  db = read();
  assert.equal(db.staff[staffId].guide.warnings, 0);
  assert.equal(db.staff[staffId].sar.warnings, 0);
});

test('invalid counts or stale confirmations never change JSON', () => {
  const before = fs.readFileSync(file, 'utf8');
  for (const invalid of ['-1', '1.5', '', '1e2', '1000', 'NaN']) {
    assert.throws(() => store.parseCount(invalid, 'Guide warnings'));
  }
  assert.throws(() => store.setWarnings({ userId: staffId, actorId: seniorId,
    guide: 1, sar: 0, expectedRevision: 0, expectedGuide: 0, expectedSar: 0 }), /changed/);
  assert.throws(() => adjust(0, 0), /No warning totals/);
  assert.equal(before, fs.readFileSync(file, 'utf8'));
});

test('new staff records can be edited, including S&R-only totals', () => {
  const other = '234567890123456789';
  const old = store.getWarnings(other);
  assert.equal(old.guide, 0);
  assert.equal(old.sar, 0);
  const changed = store.setWarnings({ userId: other, actorId: seniorId,
    guide: 0, sar: 2, expectedRevision: 0, expectedGuide: 0, expectedSar: 0 });
  assert.equal(changed.sar, 2);
  assert.equal(read().staff[other].sar.warnings, 2);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
