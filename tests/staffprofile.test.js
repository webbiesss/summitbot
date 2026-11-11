'use strict';

// Run with: node --test tests/staffprofile.test.js
// Uses an isolated temporary directory, NEVER edits live staff data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-staff-test-'));
process.env.SUMMITBOT_STAFF_DATA_DIR = tmp;
const inactivity = require('../staff/inactivityStore');
const profile = require('../staff/profileData');
const userId = '123456789012345678';
const senior = '987654321098765432';

function write(name, object) {
  fs.writeFileSync(path.join(tmp, name), JSON.stringify(object));
}

test('Guide and S&R saved point totals are read without recalculation', () => {
  const file = {
    staff: { [userId]: {
      guide: {
        hosted: { week: 2, month: 5, allTime: 42 },
        coHosted: { week: 3, month: 8, allTime: 19 }, warnings: 1,
        weeklyPoints: 3.5,
      },
      sar: { rescues: { week: 2, month: 3, allTime: 11 }, weeklyPoints: 2, warnings: 2 },
    } },
  };
  write('stafflogs.json', file);
  write('staffpayments.json', { staff: { [userId]: { currentWeekDue: 8.5, robuxPaid: 50 } } });
  const before = fs.readFileSync(path.join(tmp, 'stafflogs.json'), 'utf8');
  const result = profile.loadStaffProfileData(userId);
  assert.equal(result.guide.weeklyPoints, 3.5);
  assert.equal(result.sar.weeklyPoints, 2);
  assert.equal(result.guide.quota, 1.5);
  assert.equal(result.sar.quota, 1);
  assert.equal(result.payments.currentWeekDue, 8.5);
  assert.equal(result.payments.robuxPaid, 50);
  assert.equal(before, fs.readFileSync(path.join(tmp, 'stafflogs.json'), 'utf8'));
});

test('Notice creation, senior audit, editing and soft-removal', () => {
  const created = inactivity.createNotice(userId, userId, {
    startDate: '2026-12-21', endDate: '2026-12-24', reason: 'Travel',
  });
  assert.equal(inactivity.durationDays(created.startDate, created.endDate), 4);
  assert.equal(inactivity.noticeStatus(created, '2026-12-20'), 'future');
  assert.equal(inactivity.noticeStatus(created, '2026-12-21'), 'current');
  assert.equal(inactivity.noticeStatus(created, '2026-12-25'), 'expired');
  assert.equal(inactivity.isExemptFromWeeklyWarning(userId, '2026-12-14', '2026-12-20'), false);
  assert.equal(inactivity.isExemptFromWeeklyWarning(userId, '2026-12-20', '2026-12-26'), true);
  const edited = inactivity.updateNotice(userId, created.id, senior, {
    startDate: '2026-12-22', endDate: '2026-12-24', reason: 'Approved leave',
  }, created.revision);
  assert.equal(edited.editedBy, senior);
  assert.throws(() => inactivity.updateNotice(userId, created.id, senior,
    { startDate: '2026-12-22', endDate: '2026-12-24', reason: 'Bad edit' }, created.revision), /changed/);
  const removed = inactivity.removeNotice(userId, created.id, senior);
  assert.equal(removed.removedBy, senior);
  assert.equal(inactivity.isExemptFromWeeklyWarning(userId, '2026-12-22', '2026-12-24'), false);
  assert.equal(inactivity.listForUser(userId).length, 1); // still in audit database
  assert.throws(() => inactivity.removeNotice(userId, created.id, senior), /already removed/);
});

test('Overlapping notices work, invalid dates and missing reasons are rejected', () => {
  inactivity.createNotice(userId, userId, {
    startDate: '2027-01-01', endDate: '2027-01-10', reason: 'Travel',
  });
  inactivity.createNotice(userId, senior, {
    startDate: '2027-01-05', endDate: '2027-01-15', reason: 'Personal',
  });
  assert.equal(inactivity.isExemptFromWeeklyWarning(userId, '2027-01-14', '2027-01-20'), true);
  assert.throws(() => inactivity.validateForm('2027-02-30', '2027-03-05', 'Test'), /dates/);
  assert.throws(() => inactivity.validateForm('2027-01-10', '2027-01-01', 'Test'), /end date/);
  assert.throws(() => inactivity.validateForm('2027-01-01', '2027-01-10', ''), /reason/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
