'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fresh() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-test-'));
  fs.cpSync(path.resolve(__dirname, '../staff'), path.join(tmp, 'staff'), { recursive: true });
  const logic = require(path.join(tmp, 'staff/logic.js'));
  return { logic, tmp };
}
test('payouts: latest active department per week, signed corrections, monthly bonus', () => {
  const { logic, tmp } = fresh();
  const id = '123456789';
  try {
    logic.setMembership({ actor: 'admin', userId: id, department: 'guide', enabled: true });
    logic.setMembership({ actor: 'admin', userId: id, department: 'sar', enabled: true });
    let r = logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'host', count: 1, attendees: 4 });
    assert.equal(r.member.balanceHalf, 14); // (5 + 4*.5) = 7
    r = logic.recordActivity({ actor: 'admin', userId: id, department: 'sar', kind: 'heal', count: 2, validated: true, validatedBy: 'cohost' });
    assert.equal(r.member.balanceHalf, 12); // SAR active: 6
    r = logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'cohost', count: 1, attendees: 2 });
    assert.equal(r.member.balanceHalf, 22); // Guide active: 7+4=11
    r = logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'cohost', count: -1, attendees: 2 });
    assert.equal(r.member.balanceHalf, 12); // Reversed Guide cohost; the later S&R rescue becomes active
    assert.equal(r.member.quota.guideHalf, 2);
    logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'host', count: 1, attendees: 2 });
    logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'host', count: 1, attendees: 3 });
    r = logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'host', count: 1, attendees: 4 });
    assert.equal(r.member.balanceHalf, 49); // 7 + 6 + 6.5 + 5 = 24.5
    const archive = logic.wipe({ actor: 'admin', kind: 'guide' });
    assert.ok(fs.existsSync(path.join(tmp, 'data/staffArchives', archive.filename)));
    assert.equal(logic.readCurrent().users[id].quota.guideHalf, 0);
    assert.equal(logic.readCurrent().users[id].balanceHalf, 49); // quota wipe retains payout
    logic.wipe({ actor: 'admin', kind: 'payments' });
    assert.equal(logic.readCurrent().users[id].balanceHalf, 0);
    r = logic.recordActivity({ actor: 'admin', userId: id, department: 'guide', kind: 'host', count: 1, attendees: 9 });
    assert.equal(r.member.balanceHalf, 10); // bonus beyond three events; base 5 only
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('manual edits, notices, quota adjustments, weekly warning policy', () => {
  const { logic, tmp } = fresh();
  const id = '111', exemptId = '222';
  try {
    for (const member of [id, exemptId]) {
      logic.setMembership({ actor: 'admin', userId: member, department: 'guide', enabled: true });
      logic.setMembership({ actor: 'admin', userId: member, department: 'sar', enabled: true });
    }
    logic.adjustQuota({ actor: 'admin', userId: id, department: 'guide', deltaHalfPoints: -1, explanation: 'Correction' });
    assert.equal(logic.readCurrent().users[id].quota.guideHalf, -1);
    logic.editWarnings({ actor: 'admin', userId: id, department: 'guide', mode: 'set', value: 2, explanation: 'Prior strikes' });
    logic.editPayment({ actor: 'admin', userId: id, mode: 'set', amountHalf: 19, explanation: 'Carry over' });
    assert.equal(logic.readCurrent().users[id].balanceHalf, 19);
    const current = logic.weekOf();
    logic.addNotice({ actor: 'admin', userId: exemptId, start: current, end: logic.addDays(current, 6), reason: 'Vacation' });
    const state = logic.readCurrent();
    // Close a week directly to exercise the weekly warning evaluation path.
    const store = require(path.join(tmp, 'staff/store.js'));
    const completedWeek = logic.addDays(current, -7);
    state.activeWeek = completedWeek;
    for (const member of Object.values(state.users)) {
      for (const d of ['guide', 'sar']) member.memberships[d].enrolledWeek = completedWeek;
    }
    // Change notice to overlap completed week as well.
    state.notices[0].start = logic.addDays(completedWeek, 6);
    store.write(state);
    const closed = logic.rollover();
    assert.equal(closed.length, 1);
    assert.equal(logic.readCurrent().users[id].warnings.guide, 3);
    assert.equal(logic.readCurrent().users[id].warnings.sar, 1);
    assert.equal(logic.readCurrent().users[exemptId].warnings.guide, 0);
    assert.equal(logic.readCurrent().users[exemptId].warnings.sar, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('monthly department cap prevents exceeding 250 Guide / 150 S&R; guide warnings decay', () => {
  const { logic, tmp } = fresh();
  try {
    logic.setMembership({ actor: 'admin', userId: 'capGuide', department: 'guide', enabled: true });
    const guide = logic.recordActivity({ actor: 'admin', userId: 'capGuide', department: 'guide', kind: 'host', count: 60, attendees: 0 });
    assert.equal(guide.member.balanceHalf, 500); // 300 Robux before monthly cap
    logic.setMembership({ actor: 'admin', userId: 'capSar', department: 'sar', enabled: true });
    const sar = logic.recordActivity({ actor: 'admin', userId: 'capSar', department: 'sar', kind: 'lost', count: 20, validated: true, validatedBy: 'leadHost' });
    assert.equal(sar.member.balanceHalf, 300); // 200 Robux before monthly cap
    // Validate that weekly closure removes exactly one previous Guide warning when quota passes.
    const store = require(path.join(tmp, 'staff/store.js'));
    const state = logic.readCurrent();
    const lastWeek = logic.addDays(logic.weekOf(), -7);
    state.activeWeek = lastWeek;
    state.users.capGuide.memberships.guide.enrolledWeek = lastWeek;
    state.users.capGuide.warnings.guide = 2;
    state.users.capGuide.quota.guideHalf = 3;
    state.users.capSar.memberships.sar.enrolledWeek = lastWeek;
    state.users.capSar.quota.sarRescues = 1;
    store.write(state);
    logic.rollover();
    assert.equal(logic.readCurrent().users.capGuide.warnings.guide, 1);
    assert.equal(logic.readCurrent().users.capSar.warnings.sar, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});


