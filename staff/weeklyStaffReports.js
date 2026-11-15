'use strict';

/**
 * Weekly verified-log reports for World Expeditions Manager (discord.js v14).
 * Install as staff/weeklyStaffReports.js.
 *Ee
 * Saturday 09:00 America/Vancouver, for the preceding Saturday–Friday.
 * No historical S&R scrape. Historical Guide imports have no quota/payment effect.
 * Requires startStaffLogListener(client) and its revokeLog method.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const inactivityStore = require('./inactivityStore');
const warningStore = require('./warningStore');

const SETTINGS = Object.freeze({
  timezone: 'America/Vancouver',
  guideChannelId: '1564900722930221157',
  sarChannelId: '1564902081071153302',
  paymentChannelId: '1562504428026732554',
  seniorRoleId: '1528783820097196083',
  guideRoleId: '1539257790445395988',
  sarRoleId: '1539258148026851419',
  guideQuota: 1.5,
  sarQuota: 1,
  pageSize: 10,
  pollMs: 60_000,
  // If a staff member appears in both rosters, check both quotas separately.
  // Only the On-Duty S&R member receives S&R payouts.
  dataDir: process.env.SUMMITBOT_STAFF_DATA_DIR || path.join(__dirname, '..', 'data'),
});
const PREFIX = 'weeklyreport';
const escapeText = s => String(s ?? '').replace(/[`*_~|>]/g, '\\$&');
const money = n => `${Number(n || 0).toLocaleString('en-CA', { maximumFractionDigits: 2 })} R$`;
const points = n => Number(n || 0).toLocaleString('en-CA', { maximumFractionDigits: 2 });
const isId = s => /^\d{17,20}$/.test(String(s));

function readObject(name, fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(SETTINGS.dataDir, name), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Expected a JSON object');
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return fallback();
    throw new Error(`Cannot read ${name}: ${e.message}`);
  }
}
function saveObject(name, data) {
  fs.mkdirSync(SETTINGS.dataDir, { recursive: true });
  const dest = path.join(SETTINGS.dataDir, name);
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, dest);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function readState() {
  return readObject('weeklyStaffReports.json', () => ({ schemaVersion: 1, nextPublishDate: null, weeks: {} }));
}
function saveState(s) { saveObject('weeklyStaffReports.json', s); }
function isoDay(d, timezone = SETTINGS.timezone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const v = k => f.find(x => x.type === k).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
function hourNow(d, timezone = SETTINGS.timezone) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: timezone,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return Number(f.find(x => x.type === 'hour').value) * 60 +
    Number(f.find(x => x.type === 'minute').value);
}
function addDays(iso, number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + number);
  return date.toISOString().slice(0, 10);
}
function weekday(iso) { return new Date(`${iso}T12:00:00Z`).getUTCDay(); }
function nextSaturday(date, now) {
  const delta = (6 - weekday(date) + 7) % 7;
  let next = addDays(date, delta);
  return next;
}
function dueFor(publishDate, now) {
  const today = isoDay(now);
  return publishDate < today || (publishDate === today && hourNow(now) >= 9 * 60);
}
function reportingPeriod(publishDate) {
  return { start: addDays(publishDate, -7), end: addDays(publishDate, -1), publishDate };
}
function isWithin(entry, period) {
  return typeof entry.date === 'string' && entry.date >= period.start && entry.date <= period.end;
}
function isLiveGuide(entry) {
  return entry.paymentEligibility === 'live' && entry.historicalImport !== true;
}
function weeklyLogs(logs, department, period) {
  const entries = department === 'guide' ? logs.guideExpeditions : logs.sarRescues;
  return Object.values(entries || {}).filter(e => e && isWithin(e, period) &&
    ['approved', 'removed'].includes(e.status) &&
    (department !== 'guide' || isLiveGuide(e)))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') ||
      (a.postedAt || '').localeCompare(b.postedAt || '') ||
      String(a.messageId).localeCompare(String(b.messageId)));
}
function paymentItems(entry, department) {
  if (department === 'sar') {
    return isId(entry.onDutyId) ? [{ id: entry.onDutyId, amount: Number(entry.totalRobux || 0),
      unpaid: entry.paymentStatus === 'unpaid' ? Number(entry.totalRobux || 0) : 0 }] : [];
  }
  return (entry.basePayments || []).filter(p => isId(p.userId)).map(p => ({
    id: p.userId, amount: Number(p.robux || 0),
    unpaid: p.status === 'unpaid' ? Number(p.robux || 0) : 0,
  }));
}
function buildWeek(logs, week) {
  const period = week.period;
  const notices = inactivityStore.load().notices;
  const byDept = {};
  const earned = new Map();
  for (const dept of ['guide', 'sar']) {
    const entries = weeklyLogs(logs, dept, period);
    const scores = new Map();
    const activity = new Map();
    for (const entry of entries) {
      if (entry.status !== 'approved') continue;
      if (dept === 'guide') {
        if (isId(entry.guideId)) {
          scores.set(entry.guideId, (scores.get(entry.guideId) || 0) + 1);
          activity.set(entry.guideId, (activity.get(entry.guideId) || 0) + 1);
        }
        for (const id of entry.coHostIds || []) {
          if (!isId(id)) continue;
          scores.set(id, (scores.get(id) || 0) + 0.5);
        }
      } else if (isId(entry.onDutyId)) {
        const rescued = Array.isArray(entry.recipients) ? entry.recipients.length : 0;
        scores.set(entry.onDutyId, (scores.get(entry.onDutyId) || 0) + rescued);
        activity.set(entry.onDutyId, (activity.get(entry.onDutyId) || 0) + rescued);
      }
      for (const item of paymentItems(entry, dept)) {
        if (!earned.has(item.id)) earned.set(item.id, { guide: 0, sar: 0, guideUnpaid: 0, sarUnpaid: 0 });
        const row = earned.get(item.id);
        row[dept] += item.amount;
        row[`${dept}Unpaid`] += item.unpaid;
      }
    }
    const target = dept === 'guide' ? SETTINGS.guideQuota : SETTINGS.sarQuota;
    const roster = week.roster?.[dept] || [];
    const people = roster.map(u => {
      const score = scores.get(u.id) || 0;
      const excused = notices.some(n => n.userId === u.id && !n.removedAt &&
        n.startDate <= period.end && n.endDate >= period.start);
      return { ...u, score, quota: target, excused, needsWarning: score < target && !excused,
        hostedOrRescued: activity.get(u.id) || 0 };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const uniqueScores = [...new Set(people.map(x => x.score).filter(n => n > 0))].sort((a, b) => b - a);
    const best = uniqueScores[0] ?? null;
    const second = uniqueScores[1] ?? null;
    for (const person of people) {
      person.award = best !== null && person.score === best ? '🏅' :
        second !== null && person.score === second ? '🎗️' :
          person.excused ? '🛡️' : person.score >= target ? '🪙' : '❌';
    }
    byDept[dept] = { entries, people, target,
      topIds: people.filter(p => best !== null && p.score === best).map(p => p.id),
      secondIds: people.filter(p => second !== null && p.score === second).map(p => p.id),
      totalOperations: entries.filter(e => e.status === 'approved').length,
      totalUnits: [...activity.values()].reduce((s, n) => s + n, 0) };
  }
  const allIds = new Set([...(week.roster?.guide || []).map(u => u.id),
    ...(week.roster?.sar || []).map(u => u.id), ...earned.keys()]);
  const payments = [...allIds].filter(isId).map(id => {
    const amounts = earned.get(id) || { guide: 0, sar: 0, guideUnpaid: 0, sarUnpaid: 0 };
    return { id, ...amounts, total: amounts.guide + amounts.sar,
      unpaid: amounts.guideUnpaid + amounts.sarUnpaid };
  }).sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  return { byDept, payments, period };
}
function warningKey(dept, period) { return `WEEKLY-REPORT:${period.start}:${dept}`; }
function syncWarnings(week, result, state) {
  week.warningApplied ||= { guide: {}, sar: {} };
  for (const dept of ['guide', 'sar']) {
    week.warningApplied[dept] ||= {};
    for (const person of result.byDept[dept].people) {
      const marker = warningKey(dept, result.period);
      const snapshot = warningStore.getWarnings(person.id);
      const history = snapshot.history || [];
      // In case the process failed between warningStore's write and our own state write.
      let applied = week.warningApplied[dept][person.id];
      if (applied === undefined) {
        const prior = history.filter(h => String(h.reason || '').startsWith(marker));
        applied = prior.length ? prior.at(-1).reason === `${marker}:applied` : false;
      }
      if (applied === person.needsWarning) {
        week.warningApplied[dept][person.id] = applied;
        continue;
      }
      const delta = person.needsWarning ? 1 : -1;
      const next = Math.max(0, snapshot[dept] + delta);
      if (next !== snapshot[dept]) {
        warningStore.setWarnings({
          userId: person.id, actorId: state.botUserId,
          guide: dept === 'guide' ? next : snapshot.guide,
          sar: dept === 'sar' ? next : snapshot.sar,
          reason: `${marker}:${person.needsWarning ? 'applied' : 'reversed'}`,
          expectedRevision: snapshot.revision,
          expectedGuide: snapshot.guide, expectedSar: snapshot.sar,
        });
      }
      week.warningApplied[dept][person.id] = person.needsWarning;
      saveState(state);
    }
  }
}
function mention(id) { return isId(id) ? `<@${id}>` : '(unknown)'; }
function makeLink(entry) {
  if ([entry.guildId, entry.channelId, entry.messageId].every(isId)) {
    return `https://discord.com/channels/${entry.guildId}/${entry.channelId}/${entry.messageId}`;
  }
  return null;
}
function summaryLines(dept, result, week) {
  const data = result.byDept[dept];
  const header = [
    `**Period:** ${result.period.start} – ${result.period.end}`,
    `**Quota:** ${points(data.target)} ${dept === 'guide' ? 'expedition points' : 'rescued attendees'}`,
    '**Key:** 🏅 First · 🎗️ Second · 🪙 Met quota · ❌ Warning · 🛡️ Excused',
    `**${dept === 'guide' ? 'Guide(s)' : 'S&R staff'} of the Week:** ${data.topIds.length ? data.topIds.map(mention).join(', ') : 'None'}`,
    `**Runner-up:** ${data.secondIds.length ? data.secondIds.map(mention).join(', ') : 'None'}`,
    '', '**Staff quota results**',
  ];
  const lines = data.people.length ? data.people.map(p =>
    `${p.award}${p.needsWarning && p.award !== '❌' ? ' ❌' : ''} ${mention(p.id)} — **${points(p.score)} / ${points(data.target)}**${p.excused ? ' (excused)' : ''}`) :
    ['No active department staff found.'];
  const warnings = data.people.filter(p => p.needsWarning).map(p => mention(p.id));
  const final = [
    '', `**${dept === 'guide' ? 'Expeditions hosted' : 'S&R operations'}:** ${data.totalOperations}`,
    ...(dept === 'sar' ? [`**Rescued attendees:** ${data.totalUnits}`] : []),
    `**Warnings for this period:** ${warnings.length ? warnings.slice(0, 12).join(', ') + (warnings.length > 12 ? `, and ${warnings.length - 12} others (see export)` : '') : 'None'}`,
    `**Next report:** ${addDays(result.period.publishDate, 7)} at 9:00 AM Pacific`,
  ];
  const full = [...header, ...lines, ...final];
  const visible = [...header];
  let hidden = 0;
  for (let i = 0; i < lines.length; i++) {
    if (([...visible, lines[i], ...final].join('\n')).length > 2650) {
      hidden = lines.length - i;
      break;
    }
    visible.push(lines[i]);
  }
  if (hidden) visible.push(`*${hidden} additional staff listed in the attached roster export.*`);
  visible.push(...final);
  return { shown: visible.join('\n').slice(0, 2800), full: full.join('\n') };
}
function formatLog(e, number, dept) {
  const link = makeLink(e);
  const url = link ? `[Open log](${link})` : 'Link unavailable';
  const removed = e.status === 'removed';
  if (dept === 'guide') {
    const coHosts = (e.coHostIds || []).map(mention).join(', ') || 'N/A';
    return `**#${number}** ${removed ? '🚫 REMOVED' : '✅'} ${e.date} · ${url}\n` +
      `Guide: ${mention(e.guideId)} · Co-Host: ${coHosts} · ${escapeText(e.mountain || 'No route').slice(0, 120)}`;
  }
  const kind = e.byType || {};
  return `**#${number}** ${removed ? '🚫 REMOVED' : '✅'} ${e.date} · ${url}\n` +
    `S&R: ${mention(e.onDutyId)} · ${escapeText(e.place || 'Unspecified location').slice(0, 60)} · Heal ${kind.heal?.length || 0} / Guide ${kind.guide?.length || 0} / Supply ${kind.supply?.length || 0}` +
    ` · ${money(e.totalRobux)}`;
}
function makeButtons(weekKey, dept, page, pages) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:page:${weekKey}:${dept}:-1`)
      .setLabel('← Previous').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}:page:${weekKey}:${dept}:1`)
      .setLabel('Next →').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
  if (dept !== 'payments') {
    row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:manage:${weekKey}:${dept}`)
      .setLabel('Manage log').setStyle(ButtonStyle.Secondary));
  }
  return [row];
}
function render(dept, result, week, page = 0) {
  const isPayment = dept === 'payments';
  const data = isPayment ? result.payments : result.byDept[dept].entries;
  const pages = Math.max(1, Math.ceil(data.length / SETTINGS.pageSize));
  page = Math.min(Math.max(0, page), pages - 1);
  let embeds;
  let attachment = null;
  if (isPayment) {
    const gross = data.reduce((n, p) => n + p.total, 0);
    const due = data.reduce((n, p) => n + p.unpaid, 0);
    const list = data.slice(page * SETTINGS.pageSize, (page + 1) * SETTINGS.pageSize)
      .map(p => `${mention(p.id)} — **${money(p.total)}** (Guide ${money(p.guide)}, S&R ${money(p.sar)}; unpaid from these logs: ${money(p.unpaid)})`);
    embeds = [new EmbedBuilder().setColor(0x3498db).setTitle('💰 Staff weekly payment report')
      .setDescription(`**Period:** ${result.period.start} – ${result.period.end}\n` +
        `**Earned from approved logs:** ${money(gross)}\n` +
        `**Still unpaid from these logs:** ${money(due)}\n` +
        '*Only verified-log base payouts are shown. Manual adjustments and Guide attendee bonuses not calculated are of right now. WIP*')
      .setFooter({ text: 'No automatic payout is performed.' }),
    new EmbedBuilder().setColor(0x3498db).setTitle(`Staff payments · Page ${page + 1}/${pages}`)
      .setDescription(list.join('\n') || 'No staff to display.')];
    attachment = `STAFF PAYMENTS ${result.period.start} – ${result.period.end}\n` +
      data.map(p => `${p.id} | Guide ${p.guide} | S&R ${p.sar} | Total ${p.total} | Unpaid log-derived ${p.unpaid}`).join('\n');
  } else {
    const title = dept === 'guide' ? '🧭 Guide weekly quota report' : '⛑️ S&R weekly quota report';
    const summary = summaryLines(dept, result, week);
    const logs = data.slice(page * SETTINGS.pageSize, (page + 1) * SETTINGS.pageSize)
      .map((e, index) => formatLog(e, page * SETTINGS.pageSize + index + 1, dept));
    embeds = [new EmbedBuilder().setColor(0x20a461).setTitle(title)
      .setDescription(summary.shown),
    new EmbedBuilder().setColor(0x3498db).setTitle(`Verified logs · Page ${page + 1}/${pages}`)
      .setDescription(logs.join('\n\n').slice(0, 2900) || 'No approved logs recorded for this week.')
      .setFooter({ text: `#1–#${data.length} · Numbering remains stable after removals.` })];
    attachment = `${summary.full}\n\nALL LOGS\n` + data.map((e, index) =>
      `#${index + 1} | ${e.messageId} | ${e.date} | ${e.status} | ${makeLink(e) || ''}`).join('\n');
  }
  return { page, payload: {
    embeds, components: makeButtons(week.period.start, dept, page, pages),
    allowedMentions: { parse: [] },
  }, attachment };
}
function reportChannel(dept) {
  return dept === 'guide' ? SETTINGS.guideChannelId :
    dept === 'sar' ? SETTINGS.sarChannelId : SETTINGS.paymentChannelId;
}
function cleanReason(s) {
  const value = String(s || '').trim();
  if (!value || value.length > 300) throw Error('A reason of 1–300 characters is required.');
  return value;
}

function startWeeklyStaffReports(client, { listener, pollMs = SETTINGS.pollMs, now = () => new Date() } = {}) {
  if (!client || typeof client.on !== 'function') throw Error('Pass a discord.js Client.');
  if (!listener || typeof listener.revokeLog !== 'function') {
    throw Error('Use updated startStaffLogListener(client) and pass its result as { listener }.');
  }
  if (client.__weeklyStaffReportsStarted) return client.__weeklyStaffReportsStarted;
  const pending = new Map();
  let busy = Promise.resolve();
  const serial = action => {
    const job = busy.then(action);
    busy = job.catch(() => {});
    return job;
  };
  function getState() {
    const state = readState();
    state.weeks ||= {};
    return state;
  }
  async function getGuild() {
    const channel = await client.channels.fetch(SETTINGS.guideChannelId);
    if (!channel || !channel.guild) throw Error('Guide report channel not found in a guild.');
    return channel.guild;
  }
  async function newRoster(guild) {
    // Exact department roles, like /staffprofile. GuildMembers intent is required.
    const members = await guild.members.fetch();
    if (!members || typeof members.values !== 'function') throw Error('Could not enumerate guild members.');
    const toList = role => [...members.values()]
      .filter(m => !m.user?.bot && m.roles?.cache?.has(role))
      .map(m => ({ id: m.id, name: String(m.displayName || m.user.username).slice(0, 80) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { guide: toList(SETTINGS.guideRoleId), sar: toList(SETTINGS.sarRoleId) };
  }
  function getWeek(state, period) {
    return state.weeks[period.start] ||= {
      period, roster: null, warningApplied: { guide: {}, sar: {} }, posts: {},
    };
  }
  async function publishForDate(publishDate) {
    const state = getState();
    const period = reportingPeriod(publishDate);
    const week = getWeek(state, period);
    const guild = await getGuild();
    state.botUserId = client.user?.id;
    if (!isId(state.botUserId)) throw Error('Client user is not ready.');
    if (!week.roster) {
      week.roster = await newRoster(guild);
      saveState(state);
    }
    const logs = readObject('stafflogs.json', () => ({ staff: {}, guideExpeditions: {}, sarRescues: {} }));
    const result = buildWeek(logs, week);
    // Apply exactly one warning per missed department quota, unless any
    // non-removed inactivity notice overlaps the reporting week.
    syncWarnings(week, result, state);
    for (const dept of ['guide', 'sar', 'payments']) {
      const channel = await client.channels.fetch(reportChannel(dept));
      if (!channel || typeof channel.send !== 'function') throw Error(`Report channel unavailable: ${dept}`);
      const old = week.posts[dept];
      const rendered = render(dept, result, week, old?.page || 0);
      const payload = rendered.payload;
      if (old?.messageId) {
        try {
          const msg = await channel.messages.fetch(old.messageId);
          await msg.edit({ ...payload, attachments: [], files: [
            new AttachmentBuilder(Buffer.from(rendered.attachment + '\n', 'utf8'),
              { name: `${dept}_report_${period.start}.txt` })
          ] });
          continue;
        } catch (err) {
          // Do not create duplicates merely because a channel temporarily denies edits.
          if (err.code !== 10008) throw err; // 10008 = Unknown Message
        }
      }
      const filename = `${dept}_report_${period.start}.txt`;
      const msg = await channel.send({ ...payload,
        files: [new AttachmentBuilder(Buffer.from(rendered.attachment + '\n', 'utf8'), { name: filename })],
      });
      week.posts[dept] = { channelId: channel.id, messageId: msg.id, page: rendered.page };
      saveState(state);
    }
    week.needsRefresh = false;
    saveState(state);
    return { week, result };
  }
  async function check() {
    const state = getState();
    if (!state.nextPublishDate) {
      state.nextPublishDate = nextSaturday(isoDay(now()), now());
      saveState(state);
    }
    let iterations = 0;
    while (dueFor(state.nextPublishDate, now()) && iterations++ < 12) {
      const date = state.nextPublishDate;
      await publishForDate(date);
      // Re-read to retain freshly saved report IDs, warnings and roster.
      const latest = getState();
      latest.nextPublishDate = addDays(date, 7);
      saveState(latest);
      state.nextPublishDate = latest.nextPublishDate;
    }
    // Retry report edits interrupted after a senior removed an invalid log.
    const latest = getState();
    for (const week of Object.values(latest.weeks)) {
      if (week.needsRefresh) await publishForDate(week.period.publishDate);
    }
  }
  async function authorized(interaction) {
    if (!interaction.inGuild?.()) return false;
    const guild = interaction.guild;
    if (!guild) return false;
    const member = await guild.members.fetch(interaction.user.id);
    const required = await guild.roles.fetch(SETTINGS.seniorRoleId);
    if (!required) return false;
    return member.roles.cache.has(required.id) || member.roles.highest.position >= required.position;
  }
  function parseCustomId(id) {
    const x = String(id || '').split(':');
    if (x[0] !== PREFIX) return null;
    return x;
  }
  function findReport(state, weekKey, dept, messageId) {
    const week = state.weeks?.[weekKey];
    if (!week || !['guide', 'sar', 'payments'].includes(dept)) return null;
    const post = week.posts?.[dept];
    if (!post || post.messageId !== messageId) return null;
    return { week, post };
  }
  async function onInteraction(interaction) {
    const x = parseCustomId(interaction.customId);
    if (!x) return;
    try {
      if (interaction.isButton() && x[1] === 'page') {
        const [, , weekKey, dept, direction] = x;
        const state = getState();
        const match = findReport(state, weekKey, dept, interaction.message?.id);
        if (!match) return interaction.reply({ content: 'This is an outdated report.', flags: MessageFlags.Ephemeral });
        const logs = readObject('stafflogs.json', () => ({ staff: {}, guideExpeditions: {}, sarRescues: {} }));
        const result = buildWeek(logs, match.week);
        const visible = render(dept, result, match.week, (match.post.page || 0) + Number(direction));
        match.post.page = visible.page;
        await interaction.update(visible.payload);
        saveState(state);
        return;
      }
      if (interaction.isButton() && x[1] === 'manage') {
        const [, , weekKey, dept] = x;
        const state = getState();
        if (!findReport(state, weekKey, dept, interaction.message?.id)) {
          return interaction.reply({ content: 'This report is no longer available.', flags: MessageFlags.Ephemeral });
        }
        if (!(await authorized(interaction))) {
          return interaction.reply({ content: 'Only Senior staff or higher may remove logs.', flags: MessageFlags.Ephemeral });
        }
        const modal = new ModalBuilder().setCustomId(`${PREFIX}:form:${weekKey}:${dept}`)
          .setTitle('Remove verified log');
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('number').setLabel('Log number (from report)')
            .setPlaceholder('e.g. 12').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6)),
          new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('reason').setLabel('Removal reason')
            .setPlaceholder('Why was this log invalid?').setStyle(TextInputStyle.Paragraph)
            .setRequired(true).setMaxLength(300)),
        );
        return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && x[1] === 'form') {
        const [, , weekKey, dept] = x;
        if (!(await authorized(interaction))) {
          return interaction.reply({ content: 'Permission denied.', flags: MessageFlags.Ephemeral });
        }
        const numberRaw = interaction.fields.getTextInputValue('number').trim();
        if (!/^[1-9]\d{0,5}$/.test(numberRaw)) {
          return interaction.reply({ content: 'Enter a positive log number.', flags: MessageFlags.Ephemeral });
        }
        const reason = cleanReason(interaction.fields.getTextInputValue('reason'));
        const week = getState().weeks?.[weekKey];
        if (!week || !['guide', 'sar'].includes(dept)) {
          return interaction.reply({ content: 'Weekly report not found.', flags: MessageFlags.Ephemeral });
        }
        const logs = readObject('stafflogs.json', () => ({ staff: {}, guideExpeditions: {}, sarRescues: {} }));
        const entry = weeklyLogs(logs, dept, week.period)[Number(numberRaw) - 1];
        if (!entry || entry.status !== 'approved') {
          return interaction.reply({ content: 'That log does not exist or is already removed.', flags: MessageFlags.Ephemeral });
        }
        const token = crypto.randomBytes(9).toString('hex');
        pending.set(token, { weekKey, dept, messageId: entry.messageId,
          number: Number(numberRaw), reason, by: interaction.user.id, expires: Date.now() + 120_000 });
        const confirmation = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${PREFIX}:confirm:${token}`).setLabel('Confirm removal')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${PREFIX}:cancel:${token}`).setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({
          content: `**Remove ${dept.toUpperCase()} log #${numberRaw}?**\n${makeLink(entry) || entry.messageId}\n` +
            `Reason: ${escapeText(reason)}\n\nThis will recalculate affected quotas and unpaid payouts.`,
          components: [confirmation], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
        });
      }
      if (interaction.isButton() && ['confirm', 'cancel'].includes(x[1])) {
        const token = x[2], action = x[1];
        const task = pending.get(token);
        if (!task || task.expires < Date.now() || task.by !== interaction.user.id) {
          return interaction.reply({ content: 'This confirmation expired or belongs to another staff member.', flags: MessageFlags.Ephemeral });
        }
        pending.delete(token);
        if (action === 'cancel') return interaction.update({ content: 'Removal cancelled.', components: [] });
        if (!(await authorized(interaction))) {
          return interaction.update({ content: 'Permission denied. Nothing was removed.', components: [] });
        }
        await interaction.deferUpdate();
        await serial(async () => {
          // Recheck current report and record at confirmation, not only modal creation.
          const state = getState();
          const week = state.weeks?.[task.weekKey];
          if (!week) throw Error('Report was removed.');
          const current = readObject('stafflogs.json', () => ({ staff: {}, guideExpeditions: {}, sarRescues: {} }));
          const entry = weeklyLogs(current, task.dept, week.period).find(e => e.messageId === task.messageId);
          if (!entry || entry.status !== 'approved') throw Error('Log is already removed or no longer valid.');
          await listener.revokeLog({ department: task.dept, messageId: task.messageId,
            actorId: interaction.user.id, reason: task.reason });
          const refreshedState = getState();
          refreshedState.weeks[task.weekKey].needsRefresh = true;
          saveState(refreshedState);
          try {
            await publishForDate(week.period.publishDate);
          } catch (refreshError) {
            throw new Error('Log was removed and payout totals recalculated, but the report message ' +
              'could not be refreshed. The scheduler will retry. Cause: ' + refreshError.message);
          }
        });
        return interaction.editReply({ content: `✅ Removed ${task.dept.toUpperCase()} log #${task.number}. ` +
          'Weekly quota, warnings and payment reports were recalculated.', components: [] });
      }
    } catch (error) {
      console.error('[weeklyReports] Interaction failed:', error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `Operation failed: ${String(error.message).slice(0, 300)}`, components: [] }).catch(() => {});
      } else {
        await interaction.reply({ content: `Operation failed: ${String(error.message).slice(0, 300)}`,
          flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }
  client.on('interactionCreate', onInteraction);
  const tick = () => serial(check).catch(err => console.error('[weeklyReports] Weekly publish failed:', err));
  void tick();
  const timer = setInterval(tick, pollMs);
  const result = { check: tick, publishForDate: date => serial(() => publishForDate(date)),
    stop: () => { clearInterval(timer); client.off('interactionCreate', onInteraction); } };
  client.__weeklyStaffReportsStarted = result;
  return result;
}
module.exports = { startWeeklyStaffReports, buildWeek, reportingPeriod, nextSaturday };
