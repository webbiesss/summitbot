'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  parseGuideLog, parseHistoricalGuideLog, parseEventDate, weekStart, startStaffLogListener,
} = require('../staff/staffLogListener');

const HOST = '100000000000000001';
const COHOST = '100000000000000002';
const MOD = '100000000000000003';
const MEMBER = '100000000000000004';
const SENIOR_ROLE = '1528783820097196083';

function read(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

function mockGuild() {
  const seniorRole = { id: SENIOR_ROLE, position: 25 };
  const member = (id, authorized, username = `user-${id}`) => ({
    id, user: { id, username }, displayName: username,
    roles: {
      cache: new Map(authorized ? [[SENIOR_ROLE, seniorRole]] : []),
      highest: { position: authorized ? 25 : 2 },
    },
  });
  const guild = {
    id: 'guild1',
    roles: { cache: new Map([[SENIOR_ROLE, seniorRole]]) },
    members: { cache: new Map(), async fetch(id) { return guild.members.cache.get(id); } },
  };
  for (const m of [
    member(HOST, false, 'GuideUser'), member(COHOST, false, 'CohostUser'),
    member(MOD, true, 'SeniorUser'), member(MEMBER, false, 'RandomUser'),
  ]) {
    m.guild = guild;
    guild.members.cache.set(m.id, m);
  }
  return guild;
}

function makeMessage(guild, id, content, author = HOST,
  channelId = '795373221322686466') {
  const message = {
    id, content, guild, guildId: guild.id, channelId,
    author: { id: author, bot: false },
    createdAt: new Date(),
    async fetch() { return this; },
  };
  return message;
}

function reaction(message, emoji = '✅') {
  return { message, emoji: { name: emoji, id: null }, partial: false };
}

test('matches the sample Guide log headings and parses day-first dates', () => {
  const raw = 'Guide: <@100000000000000001>\nCo-Host: N/A\n' +
    'Medic/S&R: <@100000000000000004>\n' +
    'Date / Time: 8/11/2026 — GMT-3. 18:40\n' +
    'Mountain / Route: Annapurna\nExpedition Result: Successful\n' +
    'Verified Climbers: GuideUser, CohostUser';
  const p = parseGuideLog(raw);
  assert.equal(p.date, '2026-11-08');
  assert.equal(p.time, '18:40');
  assert.equal(p.mountain, 'Annapurna');
  assert.equal(p.coHostsRaw, 'N/A');
  assert.equal(parseEventDate('5th November, 2026 — CET'), '2026-11-05');
  assert.equal(parseEventDate('31/02/2026'), null);
  assert.equal(weekStart('2026-11-08'), '2026-11-02');
});

test('only authorized verification counts; Guide + Co-Host each credited once', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-guide-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const client = new EventEmitter();
  const listener = startStaffLogListener(client, { dataDir: dir, approvalEmojis: ['✅'] });
  const guild = mockGuild();
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (name) => today.find((p) => p.type === name).value;
  const date = `${part('day')}/${part('month')}/${part('year')}`;
  const message = makeMessage(guild, '222222222222222222',
    `Guide: <@${HOST}>\nCo-Host: <@${COHOST}>\n` +
    `Date / Time: ${date} — CET. 18:40\nMountain / Route: Annapurna\n` +
    `Verified Climbers: <@${HOST}>, <@${COHOST}>, <@${MEMBER}>`);

  await listener.onMessageCreate(message);
  assert.equal(read(dir, 'stafflogs.json').guideExpeditions[message.id].status, 'pending');
  assert.equal(Object.keys(read(dir, 'staffpayments.json').staff).length, 0);

  await listener.onReactionAdd(reaction(message), { id: MEMBER, bot: false });
  await listener.onReactionAdd(reaction(message, '🔥'), { id: MOD, bot: false });
  await listener.onReactionAdd(reaction(message), { id: HOST, bot: false });
  assert.equal(read(dir, 'stafflogs.json').guideExpeditions[message.id].status, 'pending');

  await listener.onReactionAdd(reaction(message), { id: MOD, bot: false });
  const firstLogs = read(dir, 'stafflogs.json');
  const firstPayments = read(dir, 'staffpayments.json');
  assert.equal(firstLogs.guideExpeditions[message.id].status, 'approved');
  assert.equal(firstLogs.guideExpeditions[message.id].mountain, 'Annapurna');
  assert.equal(firstLogs.staff[HOST].guide.hosted.week, 1);
  assert.equal(firstLogs.staff[HOST].guide.weeklyPoints, 1);
  assert.equal(firstLogs.staff[COHOST].guide.coHosted.week, 1);
  assert.equal(firstLogs.staff[COHOST].guide.weeklyPoints, 0.5);
  assert.equal(firstPayments.staff[HOST].currentWeekDue, 5);
  assert.equal(firstPayments.staff[COHOST].currentWeekDue, 3);
  assert.equal(firstPayments.staff[HOST].robuxPaid, 0);
  assert.equal(firstPayments.staff[HOST].guideListener.attendeeBonus, 'not_calculated');

  // Duplicate reaction or restart must NOT double-pay.
  await listener.onReactionAdd(reaction(message), { id: MOD, bot: false });
  listener.refreshStatistics();
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 5);

  // Edits and deletion after approval are flagged, but don't silently reverse credits.
  message.content = message.content.replace('Annapurna', 'Everest');
  await listener.onMessageUpdate(null, message);
  await listener.onMessageDelete(message);
  const updated = read(dir, 'stafflogs.json').guideExpeditions[message.id];
  assert.equal(updated.editedAfterApproval, true);
  assert.equal(updated.deletedAfterApproval, true);
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 5);
});

test('unresolved staff names do not create Guide credit; S&R disabled', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-guide-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  const guild = mockGuild();
  const broken = makeMessage(guild, '333333333333333333',
    'Guide: @UnmappedRobloxUser\nCo-Host: N/A\n' +
    'Date / Time: 5th November, 2026 — CET\nMountain / Route: Antarctica');
  await listener.onMessageCreate(broken);
  await listener.onReactionAdd(reaction(broken), { id: MOD, bot: false });
  const record = read(dir, 'stafflogs.json').guideExpeditions[broken.id];
  assert.equal(record.status, 'needs_review');
  assert.equal(record.guideId, null);
  assert.equal(Object.keys(read(dir, 'staffpayments.json').staff).length, 0);

  const sar = makeMessage(guild, '444444444444444444',
    'On-Duty S&R: <@100000000000000004>\nVerified Rescued Attendees: 4',
    HOST, '1539274200227909792');
  await listener.onMessageCreate(sar);
  await listener.onReactionAdd(reaction(sar), { id: MOD, bot: false });
  assert.equal(read(dir, 'stafflogs.json').guideExpeditions[sar.id], undefined);
});

test('retains warnings, paid balances, S&R fields and other non-listener dues', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-guide-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'stafflogs.json'), JSON.stringify({ schemaVersion: 1,
    staff: { [HOST]: { sar: { warnings: 2 }, guide: { warnings: 3 } } }, guideExpeditions: {} }));
  fs.writeFileSync(path.join(dir, 'staffpayments.json'), JSON.stringify({ schemaVersion: 1,
    staff: { [HOST]: { currentWeekDue: 12, robuxPaid: 90 } } }));
  const listener = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  const guild = mockGuild();
  const message = makeMessage(guild, '555555555555555555',
    `Guide: <@${HOST}>\nCo-Host: N/A\n` +
    `Date / Time: 11/11/2026\nMountain / Route: Everest`);
  await listener.onMessageCreate(message);
  await listener.onReactionAdd(reaction(message), { id: MOD, bot: false });
  const logs = read(dir, 'stafflogs.json');
  const payments = read(dir, 'staffpayments.json');
  assert.equal(logs.staff[HOST].guide.warnings, 3);
  assert.equal(logs.staff[HOST].sar.warnings, 2);
  assert.equal(payments.staff[HOST].robuxPaid, 90);
  assert.equal(payments.staff[HOST].currentWeekDue, 17);
});

test('future payout settlement cannot be resurrected from approved Guide log', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-guide-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  const guild = mockGuild();
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const p = (type) => parts.find((part) => part.type === type).value;
  const message = makeMessage(guild, '666666666666666666',
    `Guide: <@${HOST}>\nCo-Host: N/A\nDate / Time: ${p('day')}/${p('month')}/${p('year')}\n` +
    'Mountain / Route: Everest');
  await listener.onMessageCreate(message);
  await listener.onReactionAdd(reaction(message), { id: MOD, bot: false });
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 5);

  const logs = read(dir, 'stafflogs.json');
  logs.guideExpeditions[message.id].basePayments[0].status = 'paid';
  fs.writeFileSync(path.join(dir, 'stafflogs.json'), JSON.stringify(logs));
  const payments = read(dir, 'staffpayments.json');
  payments.staff[HOST].robuxPaid = 5; // Future payments module records real payment.
  fs.writeFileSync(path.join(dir, 'staffpayments.json'), JSON.stringify(payments));

  listener.refreshStatistics();
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 0);
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].robuxPaid, 5);
  assert.equal(read(dir, 'stafflogs.json').staff[HOST].guide.hosted.week, 1);
});

test('a Guide log in a thread under the configured channel is recognized', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-guide-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  const guild = mockGuild();
  const message = makeMessage(guild, '777777777777777777',
    `**Guide:** <@${HOST}>\n**Co-Host:** N/A\n` +
    '**Date / Time:** 7th November, 2026 — CET\n' +
    '**Mountain / Route:** Everest');
  message.channelId = '888888888888888888';
  message.channel = { parentId: '795373221322686466' };
  await listener.onMessageCreate(message);
  await listener.onReactionAdd(reaction(message), { id: MOD, bot: false });
  assert.equal(read(dir, 'stafflogs.json').guideExpeditions[message.id].status, 'approved');
  assert.equal(read(dir, 'stafflogs.json').guideExpeditions[message.id].date, '2026-11-07');
});

test('attendee list is deduplicated, excludes Guide and co-host, preserves evidence', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-attendance-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const listener = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  const guild = mockGuild();
  const m = makeMessage(guild, '777777777777777777',
    `Guide: <@${HOST}>\nCo-Host: <@${COHOST}>\n` +
    'Date / Time: 11/11/2026\nMountain / Route: Annapurna\n' +
    `Verified Climbers: <@${HOST}>, <@${COHOST}>, <@${MEMBER}>, <@${MEMBER}>, SomeoneUnknown`);
  await listener.onMessageCreate(m);
  await listener.onReactionAdd(reaction(m), { id: MOD, bot: false });
  const entry = read(dir, 'stafflogs.json').guideExpeditions[m.id];
  assert.equal(entry.verifiedClimberCount, 4);
  assert.equal(entry.eligibleAttendeeCount, 2);
  assert.equal(entry.eligibleAttendees.length, 2);
  assert.equal(entry.attendeeCountStatus, 'parsed_unverified');
  assert.equal(entry.attendeeBonusStatus, 'not_calculated');
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 5);
});

test('historical backfill imports approved logs into counters but never credits money', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guild = mockGuild();
  const { backfillGuideHistory } = require('../staff/staffLogListener');
  const hist = makeMessage(guild, '888888888888888888',
    `Guide: <@${HOST}>\nCo-Host: <@${COHOST}>\nDate / Time: 5/11/2026\n` +
    `Mountain / Route: Everest\nVerified Climbers: <@${HOST}>, <@${MEMBER}>`);
  hist.createdAt = new Date('2026-11-05T12:00:00Z');
  hist.reactions = { cache: new Map([['✅', {
    emoji: { name: '✅', id: null },
    users: { async fetch() { return new Map([[MOD, { id: MOD, bot: false }]]); } },
  }]]) };
  const pending = makeMessage(guild, '999999999999999999',
    `Guide: <@${HOST}>\nCo-Host: N/A\nDate / Time: 6/11/2026\nMountain / Route: Denali`);
  pending.createdAt = new Date('2026-11-06T12:00:00Z');
  pending.reactions = { cache: new Map() };
  const messages = new Map([[pending.id, pending], [hist.id, hist]]);
  const channel = { id: '795373221322686466',
    messages: { async fetch({ before }) { return before ? new Map() : messages; } } };
  const client = { channels: { async fetch() { return channel; } } };

  const preview = await backfillGuideHistory(client, { dataDir: dir, dryRun: true, approvalEmojis: ['✅'] });
  assert.equal(preview.approved, 1);
  assert.equal(preview.pending, 1);
  assert.equal(fs.existsSync(path.join(dir, 'stafflogs.json')), false);
  const summary = await backfillGuideHistory(client, { dataDir: dir, dryRun: false, approvalEmojis: ['✅'] });
  assert.equal(summary.approved, 1);
  assert.equal(summary.pending, 1);
  let logs = read(dir, 'stafflogs.json');
  let payments = read(dir, 'staffpayments.json');
  assert.equal(logs.staff[HOST].guide.hosted.allTime, 1);
  assert.equal(logs.staff[COHOST].guide.coHosted.allTime, 1);
  assert.equal(logs.guideExpeditions[hist.id].paymentEligibility, 'historical');
  assert.deepEqual(logs.guideExpeditions[hist.id].basePayments, []);
  assert.equal(payments.staff[HOST].currentWeekDue, 0);
  assert.equal(payments.staff[COHOST].currentWeekDue, 0);
  assert.equal(payments.staff[HOST].guideListener.baseRobuxAllTime, 0);

  const again = await backfillGuideHistory(client, { dataDir: dir, dryRun: false, approvalEmojis: ['✅'] });
  assert.equal(again.alreadyPresent, 2);
  assert.equal(read(dir, 'stafflogs.json').staff[HOST].guide.hosted.allTime, 1);

  // A senior reacts to an unapproved historical log AFTER the import.
  const live = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  await live.onReactionAdd(reaction(pending), { id: MOD, bot: false });
  logs = read(dir, 'stafflogs.json');
  payments = read(dir, 'staffpayments.json');
  assert.equal(logs.staff[HOST].guide.hosted.allTime, 2);
  assert.equal(logs.guideExpeditions[pending.id].paymentEligibility, 'historical');
  assert.equal(payments.staff[HOST].currentWeekDue, 0);
});

test('historical import repairs an existing pending record without back-paying it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-history-pending-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guild = mockGuild();
  const { backfillGuideHistory } = require('../staff/staffLogListener');
  const msg = makeMessage(guild, '181818181818181818',
    `Guide: <@${HOST}>\nCo-Host: N/A\nDate / Time: 4/11/2026\nMountain / Route: Fuji`);
  msg.createdAt = new Date('2026-11-04T12:00:00Z');
  msg.reactions = { cache: new Map([['✅', { emoji: { name: '✅' },
    users: { async fetch() { return new Map([[MOD, { id: MOD, bot: false }]]); } } }]]) };
  fs.writeFileSync(path.join(dir, 'stafflogs.json'), JSON.stringify({ schemaVersion: 1,
    staff: {}, guideExpeditions: { [msg.id]: { status: 'pending', messageId: msg.id } } }));
  const channel = { id: '795373221322686466', messages: {
    async fetch({ before }) { return before ? new Map() : new Map([[msg.id, msg]]); },
  } };
  const summary = await backfillGuideHistory({ channels: { async fetch() { return channel; } } },
    { dataDir: dir, dryRun: false, approvalEmojis: ['✅'] });
  assert.equal(summary.approved, 1);
  assert.equal(read(dir, 'stafflogs.json').staff[HOST].guide.hosted.allTime, 1);
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 0);
});

test('historical import reads active and archived Guide-channel threads', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-thread-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guild = mockGuild();
  const { backfillGuideHistory } = require('../staff/staffLogListener');
  const message = makeMessage(guild, '171717171717171717',
    `Guide: <@${HOST}>\nCo-Host: N/A\nDate / Time: 2/11/2026\nMountain / Route: Makalu`,
    HOST, '171717171717171710');
  message.createdAt = new Date('2026-11-02T12:00:00Z');
  message.reactions = { cache: new Map([['✅', { emoji: { name: '✅' },
    users: { async fetch() { return new Map([[MOD, { id: MOD, bot: false }]]); } } }]]) };
  const archivedThread = { id: '171717171717171710', archiveTimestamp: Date.now() - 10000,
    messages: { async fetch({ before }) {
      return before ? new Map() : new Map([[message.id, message]]);
    } } };
  const channel = { id: '795373221322686466',
    messages: { async fetch() { return new Map(); } },
    threads: {
      async fetchActive() { return { threads: new Map() }; },
      async fetchArchived() { return { threads: new Map([[archivedThread.id, archivedThread]]), hasMore: false }; },
    },
  };
  const result = await backfillGuideHistory({ channels: { async fetch() { return channel; } } },
    { dataDir: dir, dryRun: false, approvalEmojis: ['✅'] });
  assert.equal(result.channels, 2);
  assert.equal(result.approved, 1);
  assert.equal(read(dir, 'stafflogs.json').staff[HOST].guide.hosted.allTime, 1);
  assert.equal(read(dir, 'staffpayments.json').staff[HOST].currentWeekDue, 0);
});

test('historical parser ignores bad dates and absent mountains, but live parser remains strict', () => {
  const raw = `Guide: <@${HOST}>\nCo-Host: <@${COHOST}>\n` +
    'Date / Time: sometime last winter\n' +
    'Expedition Result: Successful\nVerified Climbers: whoever';
  const historical = parseHistoricalGuideLog(raw);
  assert.equal(historical.guideRaw, `<@${HOST}>`);
  assert.equal(historical.coHostsRaw, `<@${COHOST}>`);
  assert.deepEqual(historical.issues, []);
  assert.equal(historical.date, null);
  assert.equal(historical.mountain, null);
  assert.ok(parseGuideLog(raw).issues.some(e => e.includes('Date / Time')));
  assert.ok(parseGuideLog(raw).issues.some(e => e.includes('Mountain')));
  assert.equal(parseHistoricalGuideLog('Random Discord chat with no Guide fields'), null);
});

test('date-free historical Guide and Co-Host count ALL-TIME only and never generate payout', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-v3-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const guild = mockGuild();
  const { backfillGuideHistory } = require('../staff/staffLogListener');
  const approved = makeMessage(guild, '272727272727272727',
    `Guide: <@${HOST}>\nCo-Host: <@${COHOST}>\nDate / Time: ?? weird ??\n`);
  approved.reactions = { cache: new Map([['✅', { emoji: { name: '✅' }, users: {
    async fetch() { return new Map([[MOD, { id: MOD, bot: false }]]); },
  } }]]) };
  const pending = makeMessage(guild, '282828282828282828',
    `Guide: <@${HOST}>\nCo-Host: N/A\nNo date or mountain at all`);
  pending.reactions = { cache: new Map() };
  const channel = { id: '795373221322686466', messages: {
    async fetch({ before }) { return before ? new Map() : new Map([[approved.id, approved], [pending.id, pending]]); },
  } };
  const client = { channels: { async fetch() { return channel; } } };
  const opts = { dataDir: dir, approvalEmojis: ['✅'] };
  const preview = await backfillGuideHistory(client, { ...opts, dryRun: true });
  assert.equal(preview.approved, 1);
  assert.equal(preview.pending, 1);
  assert.equal(fs.existsSync(path.join(dir, 'stafflogs.json')), false);
  await backfillGuideHistory(client, { ...opts, dryRun: false });
  let logs = read(dir, 'stafflogs.json');
  let payments = read(dir, 'staffpayments.json');
  assert.equal(logs.staff[HOST].guide.hosted.allTime, 1);
  assert.equal(logs.staff[HOST].guide.hosted.week, 0);
  assert.equal(logs.staff[HOST].guide.hosted.month, 0);
  assert.equal(logs.staff[HOST].guide.weeklyPoints, 0);
  assert.equal(logs.staff[COHOST].guide.coHosted.allTime, 1);
  assert.equal(logs.staff[COHOST].guide.coHosted.week, 0);
  assert.equal(logs.staff[COHOST].guide.coHosted.month, 0);
  assert.equal(logs.guideExpeditions[approved.id].status, 'approved');
  assert.equal(logs.guideExpeditions[approved.id].date, null);
  assert.equal(logs.guideExpeditions[approved.id].mountain, null);
  assert.deepEqual(logs.guideExpeditions[approved.id].basePayments, []);
  assert.equal(payments.staff[HOST].currentWeekDue, 0);
  assert.equal(payments.staff[COHOST].currentWeekDue, 0);
  assert.equal(logs.guideExpeditions[pending.id].status, 'pending');

  // A senior verifies the old pending entry after the initial import.
  const listener = startStaffLogListener(new EventEmitter(), opts);
  await listener.onReactionAdd(reaction(pending), { id: MOD, bot: false });
  logs = read(dir, 'stafflogs.json');
  payments = read(dir, 'staffpayments.json');
  assert.equal(logs.guideExpeditions[pending.id].status, 'approved');
  assert.equal(logs.staff[HOST].guide.hosted.allTime, 2);
  assert.equal(logs.staff[HOST].guide.hosted.week, 0);
  assert.equal(payments.staff[HOST].currentWeekDue, 0);
  assert.equal(logs.guideExpeditions[pending.id].paymentEligibility, 'historical');

  const rerun = await backfillGuideHistory(client, { ...opts, dryRun: false });
  assert.equal(rerun.alreadyPresent, 2);
  assert.equal(read(dir, 'stafflogs.json').staff[HOST].guide.hosted.allTime, 2);
});

test('previously imported approved date-free historical ledger survives statistics refresh', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-v3-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'stafflogs.json'), JSON.stringify({
    schemaVersion: 1, staff: {}, guideExpeditions: {
      '383838383838383838': { status: 'approved', guideId: HOST, coHostIds: [COHOST],
        paymentEligibility: 'historical', historicalImport: true, date: null,
        basePayments: [] },
    },
  }));
  const listener = startStaffLogListener(new EventEmitter(), { dataDir: dir, approvalEmojis: ['✅'] });
  listener.refreshStatistics();
  const logs = read(dir, 'stafflogs.json');
  const payments = read(dir, 'staffpayments.json');
  assert.equal(logs.staff[HOST].guide.hosted.allTime, 1);
  assert.equal(logs.staff[COHOST].guide.coHosted.allTime, 1);
  assert.equal(logs.staff[HOST].guide.hosted.week, 0);
  assert.equal(payments.staff[HOST].currentWeekDue, 0);
});