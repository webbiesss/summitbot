'use strict';

/**
 * SummitBot staff log listener (discord.js v14)
 * -----------------------------------------------
 * Reads Guide logs, credits a log ONCE after an authorized approval reaction,
 * and writes to data/stafflogs.json + data/staffpayments.json.
 * S&R channel is intentionally inactive until its policy is finalized.
 *
 * No slash commands, scheduler, messages, or automated announcements.
 * Invoke: startStaffLogListener(client);
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_CONFIG = Object.freeze({
  guideChannelId: '795373221322686466',
  sarChannelId: '1539274200227909792',
  seniorRoleId: '1528783820097196083',
  approvalEmojis: ['1546161163304304771','🖊️','✅','👍', '852920746941612042','653206565146591232'], // Worldian_Tickmark custom emoji ID.
  allowAuthorToApproveOwnLog: false,
  timezone: 'America/Vancouver',
  guideHostPoints: 1,
  guideCoHostPoints: 0.5,
  guideHostBaseRobux: 5,
  guideCoHostBaseRobux: 3,
  // Historical import is intentionally statistics-only, never payable.
  // If a Guide name is not a Discord mention, add an exact name -> Discord user ID.
  // Example: { 'RobloxUsername': '123456789012345678' }
  nameToUserId: {},
  dataDir: process.env.SUMMITBOT_STAFF_DATA_DIR || path.join(__dirname, '..', 'data'),
});

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isoDate(y, m, d) {
  return validDate(y, m, d)
    ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null;
}

function parseEventDate(raw) {
  const s = String(raw || '').trim();
  let match = s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  // Existing World Expeditions logs use DAY/MONTH/YEAR, e.g. 8/11/2026.
  match = s.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  match = s.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(20\d{2})\b/i);
  if (match && months[match[2].toLowerCase()]) {
    return isoDate(Number(match[3]), months[match[2].toLowerCase()], Number(match[1]));
  }
  return null;
}

function field(content, expression) {
  const lines = String(content || '').replace(/\*\*/g, '').split(/\r?\n/);
  for (const original of lines) {
    const line = original.trim().replace(/^[-•]\s*/, '');
    const match = line.match(expression);
    if (match) return match[1].trim();
  }
  return '';
}

function parseGuideLog(content) {
  const guide = field(content, /^Guide\s*:\s*(.*)$/i);
  const coHosts = field(content, /^Co[\s-]*Hosts?\s*:\s*(.*)$/i);
  const dateTimeRaw = field(content, /^Date\s*(?:\/|&|and)\s*Time\s*:\s*(.*)$/i);
  const mountain = field(content, /^(?:Mountain\s*\/\s*Route|Mountain|Route)\s*:\s*(.*)$/i);
  const verifiedClimbers = field(content, /^Verified\s+(?:Climbers|Attendees)\s*:\s*(.*)$/i);
  const result = field(content, /^Expedition\s+Result\s*:\s*(.*)$/i);
  const date = parseEventDate(dateTimeRaw);
  const timeMatch = dateTimeRaw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : null;

  if (!guide && !coHosts && !dateTimeRaw && !mountain) return null;
  const issues = [];
  if (!guide || /^(?:n\/?a|none|-)$/i.test(guide)) issues.push('Missing Guide.');
  if (!date) issues.push('Missing or unrecognized Date / Time (DD/MM/YYYY or 5th November, 2026).');
  if (!mountain) issues.push('Missing Mountain / Route.');

  return { guideRaw: guide, coHostsRaw: coHosts, dateTimeRaw, date, time,
    mountain, result, verifiedClimbersRaw: verifiedClimbers, issues };
}

/**
 * Historical-only parser. Old logs do not need dates, mountains, attendance or
 * results to award ALL-TIME Guide/Co-Host counts. No live payouts use this.
 * Only messages with a Guide/Co-Host field are considered expedition logs.
 */
function parseHistoricalGuideLog(content) {
  const guide = field(content, /^Guide\s*:\s*(.*)$/i);
  const coHosts = field(content, /^Co[\s-]*Hosts?\s*:\s*(.*)$/i);
  if (!guide && !coHosts) return null;
  const issues = [];
  if (!guide || /^(?:n\/?a|none|-)$/i.test(guide)) issues.push('Missing Guide.');
  return {
    guideRaw: guide,
    coHostsRaw: coHosts,
    // These fields exist for compatibility with the event ledger, but the
    // historical parser intentionally NEVER reads them from the message.
    dateTimeRaw: null, date: null, time: null, mountain: null,
    result: null, verifiedClimbersRaw: null, issues,
  };
}

function localDate(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const v = (type) => parts.find((p) => p.type === type).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

function weekStart(dateString) {
  const d = new Date(`${dateString}T12:00:00.000Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday-start weeks
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function emptyLogs() { return { schemaVersion: 1, staff: {}, guideExpeditions: {} }; }
function emptyPayments() { return { schemaVersion: 1, staff: {} }; }

function loadJson(filename, fallback, dataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Expected JSON object');
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return fallback();
    throw new Error(`${filename}: ${err.message}`);
  }
}

function saveJson(filename, data, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const target = path.join(dataDir, filename);
  const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || '')).digest('hex');
}

function messageLink(message) {
  return message.url ||
    `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}

function getSnowflake(raw) {
  const m = String(raw).trim().match(/^(?:<@!?([0-9]{17,20})>|([0-9]{17,20}))$/);
  return m ? (m[1] || m[2]) : null;
}

function namesFromRaw(value) {
  const raw = String(value || '').trim();
  if (!raw || /^(?:n\/?a|none|no|-)$/i.test(raw)) return [];
  return raw.split(/\s*,\s*|\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean);
}

async function resolveUser(raw, message, config) {
  const mentionId = getSnowflake(raw);
  if (mentionId) return { id: mentionId, source: 'mention' };
  const name = String(raw).trim().replace(/^@/, '').replace(/^[`*_]+|[`*_]+$/g, '');
  if (!name) return { id: null, error: 'Blank staff name.' };

  const alias = Object.entries(config.nameToUserId || {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (alias && /^[0-9]{17,20}$/.test(alias[1])) return { id: alias[1], source: 'alias' };

  // The guild member cache may contain matches for ordinary text names. Never
  // guess if more than one member matches. Discord mentions are preferred.
  const cache = message.guild?.members?.cache;
  const matches = cache ? [...cache.values()].filter((member) =>
    [member.user?.username, member.user?.globalName, member.displayName]
      .filter(Boolean).some((value) => value.toLowerCase() === name.toLowerCase())) : [];
  if (matches.length === 1) return { id: matches[0].id, source: 'exact-name' };
  if (matches.length > 1) return { id: null, error: `Ambiguous staff name: ${raw}` };
  return { id: null, error: `Cannot resolve ${raw}; use a real Discord @mention or nameToUserId.` };
}

async function resolveParticipants(parsed, message, config) {
  const issues = [...parsed.issues];
  const host = await resolveUser(parsed.guideRaw, message, config);
  if (!host.id) issues.push(host.error);
  const coHostIds = [];
  for (const raw of namesFromRaw(parsed.coHostsRaw)) {
    const coHost = await resolveUser(raw, message, config);
    if (!coHost.id) issues.push(coHost.error);
    else if (!coHostIds.includes(coHost.id)) coHostIds.push(coHost.id);
  }
  if (host.id && coHostIds.includes(host.id)) issues.push('Guide cannot also be a Co-Host.');
  return { hostId: host.id, coHostIds, issues };
}

function isSenior(member, requiredId) {
  if (!member?.roles?.cache) return false;
  if (member.roles.cache.has(requiredId)) return true;
  const senior = member.guild?.roles?.cache?.get(requiredId);
  return Boolean(senior && member.roles.highest?.position >= senior.position);
}

function ensureLogObject(db) {
  db.staff ||= {};
  db.guideExpeditions ||= {};
  return db;
}

// A permanent cutover boundary makes all older, newly discovered messages
// historical, even when somebody adds a verification reaction months later.
function initializeCutover(logs, now = new Date(), preservePending = false) {
  ensureLogObject(logs);
  logs.guideListener ||= {};
  if (!logs.guideListener.historicalCutoffAt) {
    logs.guideListener.historicalCutoffAt = now.toISOString();
    if (preservePending) {
      // Pending entries already seen by the PREVIOUS live listener are not
      // silently reclassified as historical during an upgrade.
      for (const entry of Object.values(logs.guideExpeditions)) {
        if (['pending', 'needs_review'].includes(entry?.status)) {
          entry.paymentEligibility ||= 'live';
        }
      }
    }
  }
  return logs.guideListener.historicalCutoffAt;
}

function classificationForMessage(message, logs) {
  const stored = logs.guideExpeditions[message.id];
  if (stored?.paymentEligibility) return stored.paymentEligibility;
  const cutoff = Date.parse(logs.guideListener?.historicalCutoffAt || '');
  const created = message.createdTimestamp || message.createdAt?.getTime?.() || 0;
  return created && Number.isFinite(cutoff) && created < cutoff ? 'historical' : 'live';
}

function identityKey(name, message, config) {
  const token = String(name || '').trim().replace(/^[`*_]+|[`*_]+$/g, '');
  const id = getSnowflake(token);
  if (id) return `id:${id}`;
  const lower = token.replace(/^@/, '').toLowerCase();
  const alias = Object.entries(config.nameToUserId || {})
    .find(([key]) => key.toLowerCase() === lower);
  if (alias) return `id:${alias[1]}`;
  const members = message.guild?.members?.cache;
  const matched = members ? [...members.values()].filter((member) =>
    [member.user?.username, member.user?.globalName, member.displayName]
      .some((v) => v && v.toLowerCase() === lower)) : [];
  if (matched.length === 1) return `id:${matched[0].id}`;
  return `name:${lower}`;
}

function parseAttendees(parsed, message, config, hostId, coHostIds) {
  const raw = String(parsed.verifiedClimbersRaw || '').trim();
  if (!raw || /^(?:n\/?a|none|unknown|see (?:attached|screenshot|image)|\[.*\])$/i.test(raw)) {
    return { verifiedClimberCount: null, eligibleAttendeeCount: null,
      eligibleAttendees: [], attendeeCountStatus: 'missing', attendeeCountNotes: 'No identifiable attendee roster.' };
  }
  if (/^\d+$/.test(raw)) {
    return { verifiedClimberCount: Number(raw), eligibleAttendeeCount: null,
      eligibleAttendees: [], attendeeCountStatus: 'needs_review',
      attendeeCountNotes: 'Only a total was given; host/co-host cannot reliably be excluded.' };
  }
  const names = namesFromRaw(raw).filter((n) => !/^(?:n\/?a|none|unknown)$/i.test(n));
  if (!names.length) {
    return { verifiedClimberCount: null, eligibleAttendeeCount: null,
      eligibleAttendees: [], attendeeCountStatus: 'missing', attendeeCountNotes: 'No readable attendee names.' };
  }
  const blocked = new Set([`id:${hostId}`, ...coHostIds.map((id) => `id:${id}`)]);
  const people = new Map();
  for (const rawName of names) {
    const key = identityKey(rawName, message, config);
    if (!people.has(key)) people.set(key, rawName);
  }
  const attendees = [...people.entries()].filter(([key]) => !blocked.has(key));
  // Names may be plain Roblox names and not resolvable to Discord IDs.
  // Keep the list auditable and do NOT award bonuses in this module.
  return { verifiedClimberCount: people.size, eligibleAttendeeCount: attendees.length,
    eligibleAttendees: attendees.map(([key, name]) => ({ key, name })),
    attendeeCountStatus: 'parsed_unverified',
    attendeeCountNotes: 'Extracted from reported roster; confirm before paying attendee bonuses.' };
}

function approvedEntry(message, parsed, participants, approvedBy, config, paymentEligibility, source) {
  const entry = makePending(message, parsed);
  const attendee = parseAttendees(parsed, message, config,
    participants.hostId, participants.coHostIds);
  Object.assign(entry, attendee);
  entry.status = 'approved';
  entry.guideId = participants.hostId;
  entry.coHostIds = participants.coHostIds;
  entry.approvedBy = approvedBy;
  entry.approvedAt = new Date().toISOString();
  entry.verificationSource = source;
  entry.paymentEligibility = paymentEligibility;
  entry.guideHostPoints = config.guideHostPoints;
  entry.guideCoHostPoints = config.guideCoHostPoints;
  entry.baseHostRobux = paymentEligibility === 'historical' ? 0 : config.guideHostBaseRobux;
  entry.baseCoHostRobux = paymentEligibility === 'historical' ? 0 : config.guideCoHostBaseRobux;
  entry.attendeeBonusStatus = paymentEligibility === 'historical' ? 'not_payable_historical' : 'not_calculated';
  // No payout entries (even with zero amounts) for historical imports.
  entry.basePayments = paymentEligibility === 'historical' ? [] : [
    { userId: entry.guideId, role: 'host', robux: config.guideHostBaseRobux, status: 'unpaid' },
    ...entry.coHostIds.map((id) => ({ userId: id, role: 'cohost',
      robux: config.guideCoHostBaseRobux, status: 'unpaid' })),
  ];
  return entry;
}

function updateCountersAndPayments(logs, payments, config, now = new Date()) {
  // Approved expedition ledger is the source of truth. Rebuilding is idempotent.
  ensureLogObject(logs);
  payments.staff ||= {};
  const today = localDate(now, config.timezone);
  const currentWeek = weekStart(today);
  const currentMonth = today.slice(0, 7);
  const stats = new Map();

  function person(id) {
    if (!stats.has(id)) stats.set(id, {
      hosted: { week: 0, month: 0, allTime: 0 },
      coHosted: { week: 0, month: 0, allTime: 0 },
      guideBaseByWeek: {}, guideBaseByMonth: {}, unpaidBaseByWeek: {}, allTimeBase: 0,
    });
    return stats.get(id);
  }

  for (const expedition of Object.values(logs.guideExpeditions)) {
    if (expedition.status !== 'approved' || !expedition.guideId) continue;
    const historical = expedition.paymentEligibility === 'historical' ||
      expedition.historicalImport === true;
    // A historical expedition can have NO event date. It still counts toward
    // all-time hosting/cohosting, but never weekly/monthly quota or payment.
    if (!historical && !expedition.date) continue;
    const w = historical ? null : weekStart(expedition.date);
    const m = historical ? null : expedition.date.slice(0, 7);
    const credit = (id, key, pointsRobux, payoutRole) => {
      const s = person(id);
      s[key].allTime += 1;
      if (historical) return; // No current-week/month credit or Robux for history.
      if (w === currentWeek) s[key].week += 1;
      if (m === currentMonth) s[key].month += 1;
      s.guideBaseByWeek[w] = (s.guideBaseByWeek[w] || 0) + pointsRobux;
      s.guideBaseByMonth[m] = (s.guideBaseByMonth[m] || 0) + pointsRobux;
      s.allTimeBase += pointsRobux;
      // A future /staffpayments command can mark entries "paid" or "cleared"
      // without deleting the source log; they will not be credited again.
      const payout = expedition.basePayments?.find((item) =>
        item.userId === id && item.role === payoutRole);
      if (pointsRobux > 0 && (!payout || payout.status === 'unpaid')) {
        s.unpaidBaseByWeek[w] = (s.unpaidBaseByWeek[w] || 0) + pointsRobux;
      }
    };
    credit(expedition.guideId, 'hosted',
      expedition.paymentEligibility === 'historical' ? 0 :
        (expedition.basePayments?.find((p) => p.userId === expedition.guideId && p.role === 'host')?.robux
          ?? config.guideHostBaseRobux), 'host');
    for (const id of expedition.coHostIds || []) {
      credit(id, 'coHosted', expedition.paymentEligibility === 'historical' ? 0 :
        (expedition.basePayments?.find((p) => p.userId === id && p.role === 'cohost')?.robux
          ?? config.guideCoHostBaseRobux), 'cohost');
    }
  }

  // Retain warnings and S&R fields. Only Guide summary fields are rebuilt.
  const updatedIds = new Set([
    ...stats.keys(),
    ...Object.entries(logs.staff).filter(([, v]) => v?.guide?.listenerManaged).map(([id]) => id),
  ]);
  for (const id of updatedIds) {
    const s = stats.get(id) || person(id);
    logs.staff[id] ||= {};
    const guide = logs.staff[id].guide ||= {};
    guide.hosted = s.hosted;
    guide.coHosted = s.coHosted;
    guide.weeklyPoints = Number((s.hosted.week * config.guideHostPoints +
      s.coHosted.week * config.guideCoHostPoints).toFixed(2));
    guide.warnings ??= 0;
    guide.listenerManaged = true;
    guide.period = { weekStart: currentWeek, month: currentMonth };

    payments.staff[id] ||= {};
    const payment = payments.staff[id];
    const oldContribution = Number(payment.guideListener?.currentWeekContribution || 0);
    const newContribution = s.unpaidBaseByWeek[currentWeek] || 0;
    // Subtract our LAST contribution before adding the newly rebuilt one.
    // This avoids duplicate credits on restarts and preserves other payout sources.
    payment.currentWeekDue = Number(((Number(payment.currentWeekDue) || 0) -
      oldContribution + newContribution).toFixed(2));
    payment.robuxPaid ??= 0; // Never mark money as paid here.
    payment.guideListener = {
      currentWeekContribution: newContribution,
      baseRobuxAllTime: s.allTimeBase,
      baseRobuxByWeek: s.guideBaseByWeek,
      baseRobuxByMonth: s.guideBaseByMonth,
      unpaidBaseRobuxByWeek: s.unpaidBaseByWeek,
      period: { weekStart: currentWeek, month: currentMonth },
      attendeeBonus: 'not_calculated',
      finalized: false,
    };
  }
}

function persistDerived(logs, config, now) {
  const payments = loadJson('staffpayments.json', emptyPayments, config.dataDir);
  updateCountersAndPayments(logs, payments, config, now);
  // These are two JSON files, not one atomic transaction. An interrupted write
  // can be repaired by calling refreshStatistics / restarting the bot.
  saveJson('stafflogs.json', logs, config.dataDir);
  saveJson('staffpayments.json', payments, config.dataDir);
}

function inChannelOrThread(message, channelId) {
  return message?.channelId === channelId || message?.channel?.parentId === channelId;
}

function makePending(message, parsed) {
  return {
    messageId: message.id,
    guildId: message.guildId,
    channelId: message.channelId,
    messageUrl: messageLink(message),
    postedBy: message.author?.id || null,
    postedAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
    status: parsed ? 'pending' : 'unrecognized',
    date: parsed?.date || null,
    time: parsed?.time || null,
    dateTimeRaw: parsed?.dateTimeRaw || null,
    mountain: parsed?.mountain || null,
    guideRaw: parsed?.guideRaw || null,
    coHostsRaw: parsed?.coHostsRaw || null,
    verifiedClimbersRaw: parsed?.verifiedClimbersRaw || null,
    result: parsed?.result || null,
    verifiedClimberCount: null,
    eligibleAttendeeCount: null,
    eligibleAttendees: [],
    attendeeCountStatus: 'not_parsed',
    parseIssues: parsed?.issues || [],
    contentHash: hashContent(message.content),
    guideId: null,
    coHostIds: [],
    approvedBy: null,
    approvedAt: null,
    editedAfterApproval: false,
    deletedAfterApproval: false,
  };
}

function startStaffLogListener(client, options = {}) {
  if (!client || typeof client.on !== 'function') throw Error('Pass a discord.js Client.');
  const config = { ...DEFAULT_CONFIG, ...options };
  config.approvalEmojis = [...config.approvalEmojis].map(String);
  fs.mkdirSync(config.dataDir, { recursive: true });
  // Create files if missing. Never overwrite existing records at startup.
  for (const [file, fallback] of [['stafflogs.json', emptyLogs], ['staffpayments.json', emptyPayments]]) {
    if (!fs.existsSync(path.join(config.dataDir, file))) {
      saveJson(file, fallback(), config.dataDir);
    }
  }

  function refreshStatistics(now = new Date()) {
    const logs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
    persistDerived(logs, config, now);
  }
  // Freeze the historical/live boundary on the first startup. Never move it
  // forward during subsequent restarts. No messages will be sent.
  const initialLogs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
  initializeCutover(initialLogs, new Date(), true);
  persistDerived(initialLogs, config);


  async function onMessageCreate(message) {
    if (!message?.guildId || message.author?.bot) return;
    if (inChannelOrThread(message, config.sarChannelId)) return; // S&R inactive.
    if (!inChannelOrThread(message, config.guideChannelId)) return;
    const parsed = parseGuideLog(message.content);
    if (!parsed) return;
    const logs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
    const existing = logs.guideExpeditions[message.id];
    if (existing?.status === 'approved') return;
    const pending = makePending(message, parsed);
    pending.paymentEligibility = classificationForMessage(message, logs);
    logs.guideExpeditions[message.id] = pending;
    saveJson('stafflogs.json', logs, config.dataDir);
  }

  async function onReactionAdd(reaction, user) {
    if (user?.bot) return;
    const emoji = String(reaction?.emoji?.id || reaction?.emoji?.name || '');
    if (!config.approvalEmojis.includes(emoji)) return;
    if (reaction.partial) {
      try { await reaction.fetch(); } catch (err) {
        console.error('[staffLogListener] Could not fetch reaction:', err);
        return;
      }
    }
    const candidate = reaction.message;
    if (!candidate || !inChannelOrThread(candidate, config.guideChannelId)) return;
    let message;
    try { message = typeof candidate.fetch === 'function' ? await candidate.fetch() : candidate; }
    catch (err) {
      console.error('[staffLogListener] Could not fetch Guide log:', err);
      return;
    }
    if (!inChannelOrThread(message, config.guideChannelId)) return;
    if (!message.guild || !message.guildId || message.author?.bot) return;
    if (!config.allowAuthorToApproveOwnLog && message.author?.id === user.id) return;

    let reviewer;
    try { reviewer = await message.guild.members.fetch(user.id); }
    catch (_) { return; }
    if (!isSenior(reviewer, config.seniorRoleId)) return;

    const logs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
    if (logs.guideExpeditions[message.id]?.status === 'approved') return;
    const eligibility = classificationForMessage(message, logs);
    const parsed = eligibility === 'historical'
      ? parseHistoricalGuideLog(message.content) : parseGuideLog(message.content);
    if (!parsed) return;
    const participants = await resolveParticipants(parsed, message, config);
    const entry = makePending(message, parsed);
    entry.parseIssues = participants.issues;
    if (participants.issues.length) {
      entry.status = 'needs_review';
      entry.paymentEligibility = eligibility;
      logs.guideExpeditions[message.id] = entry;
      saveJson('stafflogs.json', logs, config.dataDir);
      console.warn(`[staffLogListener] Log ${message.id} needs review: ${participants.issues.join(' ')}`);
      return;
    }

    const approved = approvedEntry(message, parsed, participants, user.id, config,
      eligibility, 'live_reaction');
    logs.guideExpeditions[message.id] = approved;
    persistDerived(logs, config);
  }

  async function onMessageUpdate(_oldMessage, newMessage) {
    if (!inChannelOrThread(newMessage, config.guideChannelId)) return;
    let message = newMessage;
    if (message.partial) {
      try { message = await message.fetch(); } catch (_) { return; }
    }
    const logs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
    const previous = logs.guideExpeditions[message.id];
    if (!previous) return;
    if (previous.status === 'approved') {
      if (hashContent(message.content) !== previous.contentHash) {
        previous.editedAfterApproval = true;
        previous.lastEditedAt = new Date().toISOString();
      } else return;
    } else {
      const eligibility = previous.paymentEligibility || classificationForMessage(message, logs);
      const parsed = eligibility === 'historical'
        ? parseHistoricalGuideLog(message.content) : parseGuideLog(message.content);
      if (parsed) {
        const pending = makePending(message, parsed);
        pending.paymentEligibility = eligibility;
        pending.historicalImport = previous.historicalImport || false;
        logs.guideExpeditions[message.id] = pending;
      }
      else logs.guideExpeditions[message.id] = { ...previous, status: 'unrecognized' };
    }
    saveJson('stafflogs.json', logs, config.dataDir);
  }

  async function onMessageDelete(message) {
    if (!inChannelOrThread(message, config.guideChannelId)) return;
    const logs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
    const entry = logs.guideExpeditions[message.id];
    if (!entry) return;
    if (entry.status === 'approved') entry.deletedAfterApproval = true;
    else entry.status = 'deleted';
    entry.deletedAt = new Date().toISOString();
    saveJson('stafflogs.json', logs, config.dataDir);
  }

  function safe(handler) {
    return (...args) => Promise.resolve().then(() => handler(...args)).catch((err) =>
      console.error('[staffLogListener]', err));
  }
  let pendingOperation = Promise.resolve();
  const serial = (handler) => (...args) => {
    const operation = pendingOperation.then(() => handler(...args));
    pendingOperation = operation.catch(() => {});
    return operation;
  };
  const handlers = {
    onMessageCreate: serial(onMessageCreate),
    onReactionAdd: serial(onReactionAdd),
    onMessageUpdate: serial(onMessageUpdate),
    onMessageDelete: serial(onMessageDelete),
  };
  client.on('messageCreate', safe(handlers.onMessageCreate));
  client.on('messageReactionAdd', safe(handlers.onReactionAdd));
  client.on('messageUpdate', safe(handlers.onMessageUpdate));
  client.on('messageDelete', safe(handlers.onMessageDelete));

  return { ...handlers, refreshStatistics, config };
}


// Read reaction users from Discord, not from an incomplete cache. A historical
// log only qualifies if the configured emoji was added by an authorized senior.
async function historicalVerifier(message, config) {
  for (const reaction of message.reactions?.cache?.values?.() || []) {
    const emoji = String(reaction.emoji?.id || reaction.emoji?.name || '');
    if (!config.approvalEmojis.includes(emoji)) continue;
    let after;
    while (true) {
      const users = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) });
      if (!users.size) break;
      for (const user of users.values()) {
        if (user.bot || (!config.allowAuthorToApproveOwnLog && user.id === message.author?.id)) continue;
        let member;
        try { member = await message.guild.members.fetch(user.id); } catch (_) { continue; }
        if (isSenior(member, config.seniorRoleId)) return user.id;
      }
      if (users.size < 100) break;
      after = [...users.keys()].at(-1);
    }
  }
  return null;
}

async function* historyMessages(channel) {
  if (!channel.messages?.fetch) throw new Error(`Cannot read messages in ${channel.id}`);
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
    if (!page.size) break;
    for (const msg of page.values()) yield msg;
    // Discord returns newest first; use the oldest ID as cursor.
    before = [...page.keys()].reduce((smallest, id) =>
      BigInt(id) < BigInt(smallest) ? id : smallest);
    if (page.size < 100) break;
  }
}

async function guideHistoryChannels(channel, { includePrivateThreads = false } = {}) {
  const found = new Map([[channel.id, channel]]);
  if (!channel.threads) return [...found.values()];
  const active = await channel.threads.fetchActive();
  for (const thread of active.threads.values()) found.set(thread.id, thread);
  for (const type of includePrivateThreads ? ['public', 'private'] : ['public']) {
    let before;
    while (true) {
      const page = await channel.threads.fetchArchived({ type, limit: 100,
        ...(before ? { before } : {}) });
      for (const thread of page.threads.values()) found.set(thread.id, thread);
      if (!page.hasMore || !page.threads.size) break;
      const stamps = [...page.threads.values()].map((thread) => thread.archiveTimestamp).filter(Number.isFinite);
      if (!stamps.length) throw new Error('Archived thread cursor unavailable; cannot guarantee full scan.');
      const oldest = Math.min(...stamps);
      if (before && oldest >= before.getTime()) throw new Error('Archived thread pagination stalled.');
      before = new Date(oldest);
    }
  }
  return [...found.values()];
}

/**
 * Explicit ONE-TIME import; never invoked by the listener or startup.
 * dryRun: true - reads Discord, does not change local data.
 * dryRun: false - writes expedition ledger, quota counters; NEVER Robux.
 * Pending logs without recognized senior approval are imported as pending,
 * not credited. Errors stop import; rerunning is safe (message ID dedupe).
 */
async function backfillGuideHistory(client, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const dryRun = options.dryRun !== false;
  const channel = await client.channels.fetch(config.guideChannelId);
  if (!channel) throw new Error(`Guide channel ${config.guideChannelId} unavailable.`);
  const logs = ensureLogObject(loadJson('stafflogs.json', emptyLogs, config.dataDir));
  const result = { scanned: 0, recognized: 0, imported: 0, updated: 0, alreadyPresent: 0,
    approved: 0, needsReview: 0, pending: 0, channels: 0, dryRun };
  // During dry-run, use the same tentative cutoff but never save it.
  initializeCutover(logs, new Date(), false);
  const channels = await guideHistoryChannels(channel, options);
  result.channels = channels.length;
  for (const source of channels) {
    for await (const message of historyMessages(source)) {
      result.scanned++;
      if (message.author?.bot || !message.guildId) continue;
      const parsed = parseHistoricalGuideLog(message.content);
      if (!parsed) continue;
      result.recognized++;
      const existing = logs.guideExpeditions[message.id];
      if (existing) {
        result.alreadyPresent++;
        if (['approved', 'deleted'].includes(existing.status)) continue;
      }
      const entry = makePending(message, parsed);
      entry.paymentEligibility = 'historical';
      entry.historicalImport = true;
      const verifier = await historicalVerifier(message, config);
      if (verifier) {
        const participants = await resolveParticipants(parsed, message, config);
        if (participants.issues.length) {
          entry.status = 'needs_review';
          entry.parseIssues = participants.issues;
          result.needsReview++;
        } else {
          Object.assign(entry, approvedEntry(message, parsed, participants, verifier,
            config, 'historical', 'historical_reaction'));
          entry.historicalImport = true;
          result.approved++;
        }
      } else {
        entry.status = parsed.issues.length ? 'needs_review' : 'pending';
        if (entry.status === 'needs_review') result.needsReview++;
        else result.pending++;
      }
      logs.guideExpeditions[message.id] = entry;
      if (existing) result.updated++;
      else result.imported++;
      // Incrementally checkpoint actual imports. A failed scan can be resumed
      // without duplicates. No payout JSON file is created or credited here.
      if (!dryRun && (result.imported + result.updated) % 100 === 0) saveJson('stafflogs.json', logs, config.dataDir);
    }
  }
  if (!dryRun) persistDerived(logs, config);
  return result;
}

module.exports = {
  startStaffLogListener,
  parseGuideLog,
  parseHistoricalGuideLog,
  parseEventDate,
  weekStart,
  updateCountersAndPayments,
  backfillGuideHistory,
  parseAttendees,
};