'use strict';
const {
  SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder,
  MessageFlags, AttachmentBuilder, PermissionFlagsBits
} = require('discord.js');
const crypto = require('node:crypto');
const config = require('./config');
const logic = require('./logic');

function pick(deptOption) {
  return deptOption.addChoices(
    { name: 'Guide', value: 'guide' },
    { name: 'Search & Rescue', value: 'sar' }
  );
}
function addMember(builder, required = true) {
  return builder.addUserOption(o => o.setName('member').setDescription('Discord staff member')
    .setRequired(required));
}
function addDept(builder) {
  return builder.addStringOption(o => pick(o.setName('department').setDescription('Department').setRequired(true)));
}
function addReason(builder) {
  return builder.addStringOption(o => o.setName('reason').setDescription('Reason for audit log')
    .setRequired(true).setMaxLength(300));
}
function choices(option, name, desc, list) {
  return option.addStringOption(o => o.setName(name).setDescription(desc).setRequired(true)
    .addChoices(...list.map(([label, value]) => ({ name: label, value }))));
}
const specs = {
  guidequota: {
    description: 'Record hosted/co-hosted expeditions and calculate Robux',
    build(b) {
      addMember(b);
      choices(b, 'role', 'Expedition role', [['Hosted', 'host'], ['Co-hosted', 'cohost']]);
      b.addIntegerOption(o => o.setName('count').setDescription('Signed expeditions (+ or -)').setRequired(true).setMinValue(-1000).setMaxValue(1000));
      b.addIntegerOption(o => o.setName('attendees').setDescription('Attendees per expedition; exclude host/cohost').setRequired(true).setMinValue(0).setMaxValue(1000));
    }, permission: 'quota'
  },
  sarquota: {
    description: 'Record validated S&R rescues and calculate Robux',
    build(b) {
      addMember(b);
      choices(b, 'rescue', 'Rescue assistance type', [['Heal', 'heal'], ['Guide lost attendees', 'lost'], ['Supply', 'supply']]);
      b.addIntegerOption(o => o.setName('count').setDescription('Signed number of attendees helped (+ or -)').setRequired(true).setMinValue(-1000).setMaxValue(1000));
      b.addBooleanOption(o => o.setName('validated').setDescription('Confirmed by an expedition host/co-host?').setRequired(true));
      b.addUserOption(o => o.setName('validator').setDescription('Host or co-host who validated the rescue').setRequired(true));
    }, permission: 'quota'
  },
  staffquotaadjust: {
    description: 'Manually change quota points without changing payments',
    build(b) { addMember(b); addDept(b); b.addNumberOption(o => o.setName('delta').setDescription('Signed points; Guide allows halves, S&R whole rescues').setRequired(true).setMinValue(-1000).setMaxValue(1000)); addReason(b); },
    permission: 'quota'
  },
  staffdepartment: {
    description: 'Enroll or remove a staff member from a department',
    build(b) { addMember(b); addDept(b); b.addBooleanOption(o => o.setName('enabled').setDescription('True: enrolled; False: removed').setRequired(true)); },
    permission: 'quota'
  },
  guidequotas: { description: 'View full Guide department quota list', permission: 'viewer' },
  sarquotalist: { description: 'View full S&R department quota list', permission: 'viewer' },
  staffpayouts: { description: 'View full unpaid Robux balances list', permission: 'payments' },
  wipeguidequotas: { description: 'Archive and clear Guide weekly quotas (confirmation)', permission: 'quotaAndPayments' },
  wipesarquota: { description: 'Archive and clear S&R weekly quotas (confirmation)', permission: 'quotaAndPayments' },
  wipesarquotas: { description: 'Archive and clear S&R weekly quotas (confirmation)', permission: 'quotaAndPayments' },
  wipestaffpayments: { description: 'Archive and clear all unpaid Robux (confirmation)', permission: 'payments' },
  staffprofile: { description: 'View private staff profile, quotas, warnings and Robux',
    build(b) { addMember(b, false); }, permission: 'profile' },
  staffpaymentedit: { description: 'Add to or set a staff member’s Robux balance',
    build(b) {
      addMember(b);
      choices(b, 'mode', 'Choose adjustment type', [['Add signed amount', 'add'], ['Set exact balance', 'set']]);
      b.addNumberOption(o => o.setName('amount').setDescription('Robux amount, in 0.5 increments; negatives allowed').setRequired(true).setMinValue(-1000000).setMaxValue(1000000));
      addReason(b);
    }, permission: 'payments' },
  staffwarnings: { description: 'View current warnings for Guide or S&R',
    build(b) { addDept(b); }, permission: 'viewer' },
  staffwarningedit: { description: 'Add to or set a member’s Guide/S&R warnings',
    build(b) {
      addMember(b); addDept(b);
      choices(b, 'mode', 'Choose adjustment type', [['Add signed warnings', 'add'], ['Set exact warning total', 'set']]);
      b.addIntegerOption(o => o.setName('count').setDescription('Signed integer warnings').setRequired(true).setMinValue(-1000).setMaxValue(1000));
      addReason(b);
    }, permission: 'quota' },
  inactivityadd: { description: 'Excuse staff from quota warnings for an inclusive date range',
    build(b) {
      addMember(b);
      b.addStringOption(o => o.setName('start').setDescription('First day: YYYY-MM-DD').setRequired(true).setMinLength(10).setMaxLength(10));
      b.addStringOption(o => o.setName('end').setDescription('Last day: YYYY-MM-DD').setRequired(true).setMinLength(10).setMaxLength(10));
      addReason(b);
    }, permission: 'viewer' },
  inactivityremove: { description: 'Cancel an inactivity notice by its ID',
    build(b) { b.addStringOption(o => o.setName('id').setDescription('Inactivity notice ID').setRequired(true)); }, permission: 'viewer' },
  inactivitylist: { description: 'View current/future inactivity notices',
    build(b) { addMember(b, false); }, permission: 'viewer' },
  staffweeklyreport: { description: 'Export this week’s quota/warning/payout report', permission: 'payments' }
};

// Creates individual /commands without duplicating implementation across files.
function make(name) {
  const spec = specs[name];
  if (!spec) throw Error(`Unknown staff command ${name}`);
  const data = new SlashCommandBuilder().setName(name).setDescription(spec.description)
    .setDMPermission(false);
  if (spec.build) spec.build(data);
  return { data, async execute(interaction) { await execute(name, spec, interaction); } };
}

async function hasLevel(i, roleIds) {
  if (!i.inGuild() || !i.guild) return false;
  const member = await i.guild.members.fetch(i.user.id);
  for (const id of roleIds) {
    // Missing roles must FAIL CLOSED, not accidentally grant global access.
    const required = await i.guild.roles.fetch(id).catch(() => null);
    if (required && member.roles.highest.position >= required.position) return true;
  }
  return false;
}
async function allowed(i, permission) {
  if (permission === 'profile') return hasLevel(i, [config.roles.staff]);
  if (permission === 'quota') return hasLevel(i, [config.roles.quotaManager]);
  if (permission === 'viewer') return hasLevel(i, config.roles.viewers);
  if (permission === 'payments') return hasLevel(i, [config.roles.paymentsManager]);
  if (permission === 'quotaAndPayments') {
    return (await hasLevel(i, [config.roles.quotaManager])) &&
      (await hasLevel(i, [config.roles.paymentsManager]));
  }
  return false;
}
function safeText(text) { return String(text).replace(/[`\r\n]/g, ' '); }
function fileExport(title, lines) {
  return new AttachmentBuilder(Buffer.from(`${title}\n${'='.repeat(60)}\n${lines.join('\n')}\n`, 'utf8'), {
    name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.txt`
  });
}
async function sendList(i, title, lines) {
  const preview = lines.length ? lines.slice(0, 12).join('\n').slice(0, 1450) : 'No staff records yet.';
  await i.editReply({
    content: `**${title}**\n${preview}\n\nFull list (${lines.length} entries) attached.`,
    files: [fileExport(title, lines)], allowedMentions: { parse: [] }
  });
}
function payoutLines(state) {
  return logic.payoutRows(state).map(r => `${r.id} | <@${r.id}> | ${logic.money(r.balanceHalf)} Robux`);
}
function quotaLines(state, dept) {
  return logic.quotaRows(state, dept).map(r => `${r.id} | <@${r.id}> | ${r.quota} ${dept === 'guide' ? 'Expedition points' : 'rescues'} | ${r.warnings} warning(s) | ${r.exempt ? 'INACTIVITY EXEMPT' : 'not exempt'}`);
}
function warningLines(state, dept) {
  return logic.quotaRows(state, dept).map(r => `${r.id} | <@${r.id}> | ${r.warnings} warning(s)`);
}
function getMember(i) { return i.options.getUser('member', true); }
function getDept(i) { return i.options.getString('department', true); }

async function confirmWipe(i, kind) {
  const state = logic.readCurrent();
  const token = crypto.randomBytes(8).toString('hex');
  const yes = `staffwipe:${token}:yes`;
  const no = `staffwipe:${token}:no`;
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(yes).setLabel(`Confirm ${kind} wipe`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(no).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );
  const payments = payoutLines(state);
  const quotas = kind === 'payments' ? [] : quotaLines(state, kind);
  // Include the entire payout list as a file in PREVIEW, even for quota wipes.
  const files = [fileExport('Pre-wipe staff payments', payments)];
  if (quotas.length) files.push(fileExport(`Pre-wipe ${kind} quotas`, quotas));
  const display = payments.slice(0, 8).join('\n').slice(0, 1050) || '(no balances)';
  await i.editReply({
    content: `**WARNING: Confirm ${kind.toUpperCase()} wipe**\nThis operation resets ${kind === 'payments' ? 'ALL unpaid balances' : 'this department’s CURRENT weekly quota totals'}. It does not erase warnings, audit events, or the other balance category.\n\n**Current staff payout list:**\n${display}\n\nComplete lists are attached. A dated JSON archive will also be written before clearing. Confirm within 30 seconds.`,
    files, components: [buttons], allowedMentions: { parse: [] }
  });
  const message = await i.fetchReply();
  try {
    const click = await message.awaitMessageComponent({
      filter: b => b.user.id === i.user.id && (b.customId === yes || b.customId === no),
      time: 30_000
    });
    if (click.customId === no) {
      await click.update({ content: 'Wipe cancelled. No changes were made.', components: [], files: [], allowedMentions: { parse: [] } });
      return;
    }
    // Permission checked a second time before the destructive action.
    const permission = kind === 'payments' ? 'payments' : 'quotaAndPayments';
    if (!await allowed(click, permission)) {
      await click.update({ content: 'Permission no longer valid. Wipe cancelled.', components: [], files: [] });
      return;
    }
    const result = logic.wipe({ actor: i.user.id, kind });
    try {
      await click.update({
      content: `**${kind.toUpperCase()} wipe complete.**\nArchived JSON: \`data/staffArchives/${result.filename}\`\nPre-wipe payout list and JSON archive attached below for safekeeping.`,
      components: [], files: [
        fileExport('Pre-wipe staff payments', result.snapshot.paymentsBefore.map(r => `${r.id} | <@${r.id}> | ${logic.money(r.balanceHalf)} Robux`)),
        new AttachmentBuilder(Buffer.from(JSON.stringify(result.snapshot, null, 2)), { name: result.filename })
      ], allowedMentions: { parse: [] }
      });
    } catch (displayError) {
      console.error('[staff] Wipe completed but Discord confirmation failed:', displayError);
      await i.editReply({ content: `Wipe **completed on disk**, but Discord could not display the confirmation. Archive: data/staffArchives/${result.filename}`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
    }
  } catch (err) {
    await i.editReply({ content: `Wipe was not completed (or confirmation expired): ${safeText(err.message)}.`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  }
}

async function execute(name, spec, i) {
  try {
    if (!i.inGuild()) return await i.reply({ content: 'Staff commands only work inside the server.', flags: MessageFlags.Ephemeral });
    if (!await allowed(i, spec.permission)) {
      return await i.reply({ content: 'You do not have the required staff rank to use this command.', flags: MessageFlags.Ephemeral });
    }
    // Defer to allow member fetches, file generation, and role verification.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    // Processing week boundaries here also handles commands run after bot downtime.
    const { publish } = require('./scheduler');
    for (const closed of logic.rollover()) await publish(i.client, closed);
    const actor = i.user.id;
    let state = logic.readCurrent();
    if (name === 'guidequota') {
      const u = getMember(i); const role = i.options.getString('role', true);
      const count = i.options.getInteger('count', true);
      const attendees = i.options.getInteger('attendees', true);
      const r = logic.recordActivity({ actor, userId: u.id, department: 'guide', kind: role, count, attendees });
      const paymentInfo = await allowed(i, 'payments')
        ? ` Payout change: **${logic.money(r.balanceChangeHalf)} Robux**; unpaid balance: **${logic.money(r.member.balanceHalf)} Robux**.`
        : ' Eligible Robux was recalculated automatically (amount restricted to payment managers).';
      return await i.editReply(`Recorded ${count} Guide ${role} expedition(s) for <@${u.id}>. Current quota: **${r.member.quota.guideHalf / 2} / 1.5 points**.${paymentInfo} Activity ID: \`${r.entry.id}\``);
    }
    if (name === 'sarquota') {
      const u = getMember(i); const kind = i.options.getString('rescue', true);
      const count = i.options.getInteger('count', true);
      const validated = i.options.getBoolean('validated', true);
      const validatedBy = i.options.getUser('validator', true).id;
      const r = logic.recordActivity({ actor, userId: u.id, department: 'sar', kind, count, validated, validatedBy });
      const paymentInfo = await allowed(i, 'payments')
        ? ` Payout change: **${logic.money(r.balanceChangeHalf)} Robux**; unpaid balance: **${logic.money(r.member.balanceHalf)} Robux**.`
        : ' Eligible Robux was recalculated automatically (amount restricted to payment managers).';
      return await i.editReply(`Recorded ${count} validated S&R ${kind} attendee rescue(s) for <@${u.id}>. Current quota: **${r.member.quota.sarRescues} / 1 rescues**.${paymentInfo} Activity ID: \`${r.entry.id}\``);
    }
    if (name === 'staffquotaadjust') {
      const u = getMember(i); const dept = getDept(i);
      const delta = i.options.getNumber('delta', true);
      const reason = i.options.getString('reason', true);
      const half = dept === 'guide' ? logic.halfFromInput(delta) : null;
      if (dept === 'sar' && !Number.isInteger(delta)) throw Error('S&R quota adjustments must be whole rescues.');
      const m = logic.adjustQuota({ actor, userId: u.id, department: dept, deltaHalfPoints: half, deltaRescues: delta, explanation: reason });
      return await i.editReply(`Adjusted <@${u.id}>'s ${dept.toUpperCase()} quota by ${delta}. New quota: **${dept === 'guide' ? m.quota.guideHalf / 2 : m.quota.sarRescues}**. **No Robux credited** for a manual quota-only edit; use /staffpaymentedit for a corresponding financial correction.`);
    }
    if (name === 'staffdepartment') {
      if (config.departmentEnrollmentRequiresAdministrator && !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) throw Error('Only server administrators may enroll staff.');
      const u = getMember(i); const dept = getDept(i); const enabled = i.options.getBoolean('enabled', true);
      logic.setMembership({ actor, userId: u.id, department: dept, enabled });
      return await i.editReply(`<@${u.id}> is now ${enabled ? 'enrolled in' : 'removed from'} **${dept.toUpperCase()}**. Enrollment starts in the current quota week; removing them does not delete existing records.`);
    }
    if (name === 'guidequotas' || name === 'sarquotalist') {
      const dept = name === 'guidequotas' ? 'guide' : 'sar';
      return await sendList(i, `${dept.toUpperCase()} quota week ${state.activeWeek}`, quotaLines(state, dept));
    }
    if (name === 'staffpayouts') return await sendList(i, 'Staff unpaid Robux balances', payoutLines(state));
    if (name === 'wipeguidequotas') return await confirmWipe(i, 'guide');
    if (name === 'wipesarquota' || name === 'wipesarquotas') return await confirmWipe(i, 'sar');
    if (name === 'wipestaffpayments') return await confirmWipe(i, 'payments');
    if (name === 'staffprofile') {
      const target = i.options.getUser('member') || i.user;
      const other = target.id !== actor;
      if (other && !await allowed(i, 'viewer')) throw Error('You need a senior staff rank to view another member’s profile.');
      const m = state.users[target.id];
      const payoutVisible = !other || await allowed(i, 'payments');
      if (!m) return await i.editReply(`No staff profile found for <@${target.id}>. A senior member must enroll them with /staffdepartment first.`);
      const active = logic.activeNotices(state, target.id);
      const future = logic.futureNotices(state, target.id);
      const notes = [...active.map(n => `ACTIVE (${n.id}) ${n.start}–${n.end}: ${safeText(n.reason)}`),
        ...future.map(n => `UPCOMING (${n.id}) ${n.start}–${n.end}: ${safeText(n.reason)}`)];
      return await i.editReply({ content: [
        `**Staff Profile: <@${target.id}>** (private to command user)`,
        `Departments: ${['guide', 'sar'].filter(d => m.memberships[d]).map(d => d.toUpperCase()).join(', ') || 'None'}`,
        `Guide: **${m.quota.guideHalf / 2} / 1.5** weekly expedition points • **${m.warnings.guide}** warnings`,
        `S&R: **${m.quota.sarRescues} / 1** weekly rescues • **${m.warnings.sar}** warnings`,
        `Unpaid Robux: **${payoutVisible ? logic.money(m.balanceHalf) + ' Robux' : 'Hidden — payments rank required'}**`,
        `Inactivity notices: ${notes.length ? notes.join(' | ') : 'None active or scheduled'}`
      ].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    }
    if (name === 'staffpaymentedit') {
      const u = getMember(i); const mode = i.options.getString('mode', true);
      const amountHalf = logic.halfFromInput(i.options.getNumber('amount', true));
      const explanation = i.options.getString('reason', true);
      const m = logic.editPayment({ actor, userId: u.id, mode, amountHalf, explanation });
      return await i.editReply(`Updated <@${u.id}>'s unpaid balance: **${logic.money(m.balanceHalf)} Robux** (${mode} ${logic.money(amountHalf)}). Audit record saved.`);
    }
    if (name === 'staffwarnings') {
      const dept = getDept(i);
      return await sendList(i, `${dept.toUpperCase()} staff warnings`, warningLines(state, dept));
    }
    if (name === 'staffwarningedit') {
      const u = getMember(i); const dept = getDept(i);
      const mode = i.options.getString('mode', true);
      const value = i.options.getInteger('count', true);
      const explanation = i.options.getString('reason', true);
      const m = logic.editWarnings({ actor, userId: u.id, department: dept, mode, value, explanation });
      const n = m.warnings[dept];
      return await i.editReply(`<@${u.id}> now has **${n} ${dept.toUpperCase()} warning(s)**. ${n >= 3 ? '**At termination threshold; manual senior staff review required.**' : n === 2 && dept === 'guide' ? 'Guide demotion review may be required.' : ''}`);
    }
    if (name === 'inactivityadd') {
      const u = getMember(i);
      const n = logic.addNotice({ actor, userId: u.id,
        start: i.options.getString('start', true), end: i.options.getString('end', true),
        reason: i.options.getString('reason', true) });
      return await i.editReply(`Added inactivity notice **${n.id}** for <@${u.id}> from ${n.start} through ${n.end}, inclusive. Overlapping weeks are exempt from warnings in BOTH departments.`);
    }
    if (name === 'inactivityremove') {
      const n = logic.removeNotice({ actor, id: i.options.getString('id', true) });
      return await i.editReply(`Cancelled inactivity notice **${n.id}** for <@${n.userId}>. Historical audit record retained.`);
    }
    if (name === 'inactivitylist') {
      const target = i.options.getUser('member');
      const notes = [...logic.activeNotices(state, target?.id), ...logic.futureNotices(state, target?.id)];
      return await sendList(i, 'Staff inactivity notices', notes.map(n => `${n.id} | <@${n.userId}> | ${n.start} - ${n.end} | ${safeText(n.reason)}`));
    }
    if (name === 'staffweeklyreport') {
      const rows = [
        `WEEK: ${state.activeWeek}`,
        ...quotaLines(state, 'guide').map(s => `GUIDE | ${s}`),
        ...quotaLines(state, 'sar').map(s => `S&R | ${s}`),
        ...payoutLines(state).map(s => `PAYMENT | ${s}`)
      ];
      return await sendList(i, `Staff weekly report ${state.activeWeek}`, rows);
    }
    throw Error(`No handler for command ${name}`);
  } catch (err) {
    console.error(`[staff] /${name}`, err);
    const response = { content: `Staff system error: ${safeText(err.message).slice(0, 1700)}`, allowedMentions: { parse: [] } };
    if (i.deferred || i.replied) await i.editReply(response).catch(() => {});
    else await i.reply({ ...response, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}
module.exports = { make, specs, allowed, quotaLines, payoutLines, fileExport };
