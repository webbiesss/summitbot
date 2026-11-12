'use strict';

// discord.js v14. This command READS stafflogs/staffpayments and ONLY writes inactivity notices.
const crypto = require('node:crypto');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require('discord.js');

const cfg = require('../staff/profileconfig');
const {
  loadStaffProfileData, formatRobux, roleOrHigher,
  hasDepartmentRole, getLocalToday,
} = require('../staff/profileData');
const notices = require('../staff/inactivityStore');

function safeMarkdown(value) {
  return String(value ?? '').replace(/([\\`*_~|>])/g, '\\$1').slice(0, 500);
}
// test
function fmtCount(value) {
  return Number(value || 0).toLocaleString('en-CA', { maximumFractionDigits: 2 });
}

function button(session, key, label, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(`sp:${session.id}:${key}`)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

function navRow(session) {
  if (session.page === 1) {
    return new ActionRowBuilder().addComponents(
      button(session, 'page2', 'Inactivity & payments →', ButtonStyle.Primary),
      button(session, 'refresh', 'Refresh', ButtonStyle.Secondary),
      button(session, 'close', 'Close', ButtonStyle.Secondary),
    );
  }
  return new ActionRowBuilder().addComponents(
    button(session, 'page1', '← Stats', ButtonStyle.Primary),
    button(session, 'older', 'Previous notices', ButtonStyle.Secondary, session.noticePage <= 0),
    button(session, 'newer', 'More notices', ButtonStyle.Secondary, session.noticePage >= session.totalNoticePages - 1),
    button(session, 'refresh', 'Refresh', ButtonStyle.Secondary),
    button(session, 'close', 'Close', ButtonStyle.Secondary),
  );
}

function guideStats(data) {
  const g = data.guide;
  return [
    '**🧭 Guide department**',
    '',
    '**Expeditions hosted:**',
    `Week: ${fmtCount(g.hosted.week)}`,
    `Month: ${fmtCount(g.hosted.month)}`,
    `All-time: ${fmtCount(g.hosted.allTime)}`,
    '',
    '**Number of co-hosts:**',
    `Week: ${fmtCount(g.coHosted.week)}`,
    `Month: ${fmtCount(g.coHosted.month)}`,
    `All-time: ${fmtCount(g.coHosted.allTime)}`,
    '',
    '**Current weekly Guide points:**',
    fmtCount(g.weeklyPoints),
    `**Quota:** ${fmtCount(g.quota)}`,
  ].join('\n');
}

function sarStats(data) {
  const s = data.sar;
  return [
    '**⛑️ S&R department**',
    '',
    '**Number of rescues:**',
    `Week: ${fmtCount(s.rescues.week)}`,
    `Month: ${fmtCount(s.rescues.month)}`,
    `All-time: ${fmtCount(s.rescues.allTime)}`,
    '',
    '**Current weekly S&R points:**',
    fmtCount(s.weeklyPoints),
    `**Quota:** ${fmtCount(s.quota)}`,
  ].join('\n');
}

async function renderStats(interaction, session) {
  const member = await interaction.guild.members.fetch(session.targetId);
  const user = member.user;
  const data = loadStaffProfileData(user.id);
  const guide = hasDepartmentRole(member, cfg.guideRoleId);
  const sar = hasDepartmentRole(member, cfg.sarRoleId);
  const avatar = user.displayAvatarURL({ size: 256 });
  const highest = member.roles.highest;
  const rank = highest?.id === interaction.guild.id ? 'Staff' : highest?.name || 'Staff';
  const stats = [guide ? guideStats(data) : null, sar ? sarStats(data) : null]
    .filter(Boolean).join('\n\n────────────\n\n') || 'No Guide or S&R department role assigned.';

  const embed = new EmbedBuilder()
    .setColor(cfg.green)
    .setTitle('🟢 World Expeditions Staff')
    .setDescription(`Staff profile for **${safeMarkdown(user.username)}**`)
    // Native Discord embeds do not allow placing a thumbnail inside an inline field.
    .setThumbnail(avatar)
    .addFields(
      {
        name: 'Staff member',
        value: `**Username:** ${safeMarkdown(user.username)}\n\n` +
          `**Profile picture:** [View](${avatar})\n\n**Rank:** ${safeMarkdown(rank)}`,
        inline: true,
      },
      { name: 'Department statistics', value: stats, inline: true },
    )
    .setFooter({ text: 'Page 1 of 2 · World Expeditions' });

  return { embeds: [embed], components: [navRow(session)], allowedMentions: { parse: [] } };
}

function noticeLabel(n, today) {
  const status = notices.noticeStatus(n, today);
  const removed = status.startsWith('removed-');
  return {
    status, removed,
    current: status === 'current' || status === 'removed-current',
    future: status === 'future' || status === 'removed-future',
  };
}

function relevantNotices(targetId, today) {
  const all = notices.listForUser(targetId)
    .filter((n) => {
      const s = notices.noticeStatus(n, today);
      if (s === 'expired') return false;
      // Self-removed notices disappear. Higher-up removals remain visible until end date.
      return !n.removedAt || n.removedBy !== n.userId;
    });

  const compare = (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id);
  const current = all.filter((n) => noticeLabel(n, today).current).sort(compare);
  const future = all.filter((n) => noticeLabel(n, today).future).sort(compare);
  return { current, future, ordered: [...current, ...future] };
}

function noticeEmbed(n, index, today) {
  const { current, removed } = noticeLabel(n, today);
  const length = notices.durationDays(n.startDate, n.endDate);
  const audit = [];
  const seniorEvents = Array.isArray(n.history) ?
    n.history.filter((event) => event.by && event.by !== n.userId) : [];
  // Keep a visible change trail even if the owner later edits the notice again.
  for (const event of seniorEvents.slice(-3)) {
    const verb = { created: 'Added', edited: 'Edited', removed: 'Removed' }[event.action] || 'Changed';
    audit.push(`${verb} by <@${event.by}>`);
  }
  if (!seniorEvents.length) {
    // Backward-compatible fallback for notices without a history array.
    if (n.createdBy && n.createdBy !== n.userId) audit.push(`Added by <@${n.createdBy}>`);
    if (n.editedBy && n.editedBy !== n.userId) audit.push(`Edited by <@${n.editedBy}>`);
    if (n.removedAt && n.removedBy !== n.userId) audit.push(`Removed by <@${n.removedBy}>`);
  }
  if (removed) audit.unshift('REMOVED — not counted for warning exemptions');

  return new EmbedBuilder()
    .setColor(removed ? 0xB44D4D : 0x20A461)
    .setTitle(`${current ? 'Current' : 'Future'} inactivity notice #${index + 1}${removed ? ' (removed)' : ''}`)
    .setDescription(
      `**${n.startDate} – ${n.endDate}**\n` +
      `**Length:** ${length} day${length === 1 ? '' : 's'}\n` +
      `**Reason:** ${safeMarkdown(n.reason)}\n` +
      `${audit.length ? `*${audit.join(' · ')}*` : ''}`
    );
}

async function renderNotices(interaction, session) {
  const member = await interaction.guild.members.fetch(session.targetId);
  const data = loadStaffProfileData(session.targetId);
  const guide = hasDepartmentRole(member, cfg.guideRoleId);
  const sar = hasDepartmentRole(member, cfg.sarRoleId);
  const today = getLocalToday();
  const list = relevantNotices(session.targetId, today);
  const pages = Math.max(1, Math.ceil(list.ordered.length / cfg.noticesPerPage));
  session.totalNoticePages = pages;
  session.noticePage = Math.max(0, Math.min(session.noticePage, pages - 1));
  const offset = session.noticePage * cfg.noticesPerPage;
  const visible = list.ordered.slice(offset, offset + cfg.noticesPerPage);

  const header = new EmbedBuilder().setColor(cfg.green)
    .setTitle('🟢 Inactivity Notices')
    .setDescription(`**Staff member:** ${safeMarkdown(member.user.username)}\n` +
      `Today: ${today} (${cfg.timezone})\n` +
      `Notices page ${session.noticePage + 1} of ${pages}`);
  const currentHeader = new EmbedBuilder().setColor(cfg.green)
    .setDescription(`**Current inactivity notices** (${list.current.length})` +
      (list.current.length === 0 ? '\nNo current notices.' : ''));
  const futureHeader = new EmbedBuilder().setColor(cfg.green)
    .setDescription(`**Future inactivity notices** (${list.future.length})` +
      (list.future.length === 0 ? '\nNo upcoming notices.' : ''));

  const currentCards = visible.filter((n) => noticeLabel(n, today).current);
  const futureCards = visible.filter((n) => noticeLabel(n, today).future);
  const embeds = [header, currentHeader];
  for (const n of currentCards) embeds.push(noticeEmbed(n, list.ordered.indexOf(n), today));
  embeds.push(futureHeader);
  for (const n of futureCards) embeds.push(noticeEmbed(n, list.ordered.indexOf(n), today));

  const warningLines = [];
  if (guide) warningLines.push(`**Guide warnings:** ${fmtCount(data.guide.warnings)}`);
  if (sar) warningLines.push(`**S&R warnings:** ${fmtCount(data.sar.warnings)}`);
  if (!warningLines.length) warningLines.push('No department roles assigned.');

  embeds.push(new EmbedBuilder().setColor(cfg.green)
    .setDescription(
      `────────────\n**Warnings:**\n${warningLines.join('\n')}\n` +
      `────────────\n**Payments:**\n` +
      `**Payments due this week:** ${formatRobux(data.payments.currentWeekDue)}\n` +
      `**Robux paid:** ${formatRobux(data.payments.robuxPaid)}`)
    .setFooter({ text: 'Page 2 of 2 · World Expeditions' }));

  const rows = [navRow(session)];
  rows.push(new ActionRowBuilder().addComponents(
    button(session, 'add', 'Add inactivity notice', ButtonStyle.Success)));
  // An action row for each visible notice; at most 3 notices + 2 navigation rows.
  for (const n of visible) {
    const removed = Boolean(n.removedAt);
    rows.push(new ActionRowBuilder().addComponents(
      button(session, `remove:${n.id}`, `Remove #${list.ordered.indexOf(n) + 1}`, ButtonStyle.Danger, removed),
      button(session, `edit:${n.id}`, `🟨 Edit #${list.ordered.indexOf(n) + 1}`, ButtonStyle.Secondary, removed),
    ));
  }
  // Yellow is not a native Discord button style; Secondary is used for Edit.
  return { embeds, components: rows, allowedMentions: { parse: [] } };
}

async function render(interaction, session) {
  return session.page === 1 ? renderStats(interaction, session) : renderNotices(interaction, session);
}

function formModal(session, action, existing, modalId) {
  const fields = [
    { id: 'start', label: 'Start date (YYYY-MM-DD)', value: existing?.startDate, max: 10 },
    { id: 'end', label: 'End date (YYYY-MM-DD)', value: existing?.endDate, max: 10 },
    { id: 'reason', label: 'Reason', value: existing?.reason, max: 500 },
  ];
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(action === 'add' ? 'Add inactivity notice' : 'Edit inactivity notice');
  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label)
      .setStyle(field.id === 'reason' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(field.max);
    if (field.value) input.setValue(field.value);
    else if (field.id !== 'reason') input.setPlaceholder('2026-12-21');
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

async function authorize(interaction, session) {
  const viewer = await interaction.guild.members.fetch(session.viewerId);
  if (!roleOrHigher(viewer, cfg.staffRoleId)) return false;
  return session.targetId === session.viewerId || roleOrHigher(viewer, cfg.seniorRoleId);
}

async function startForm(buttonInteraction, commandInteraction, session, action, noticeId) {
  const targetId = session.targetId;
  const original = noticeId ? notices.listForUser(targetId).find((n) => n.id === noticeId) : null;
  if (action === 'edit' && (!original || original.removedAt)) {
    return buttonInteraction.reply({ content: 'That notice is no longer editable. Refresh the profile.', flags: MessageFlags.Ephemeral });
  }
  const modalId = `sp-form:${session.id}:${crypto.randomBytes(5).toString('hex')}`;
  await buttonInteraction.showModal(formModal(session, action, original, modalId));

  let submission;
  try {
    submission = await buttonInteraction.awaitModalSubmit({
      filter: (m) => m.customId === modalId && m.user.id === session.viewerId,
      time: Math.max(1, session.expiresAt - Date.now()),
    });
  } catch {
    // Closing a modal or reaching the deadline cancels the form with no writes.
    return;
  }

  let form;
  try {
    form = notices.validateForm(
      submission.fields.getTextInputValue('start'),
      submission.fields.getTextInputValue('end'),
      submission.fields.getTextInputValue('reason'),
    );
  } catch (error) {
    await submission.reply({ content: `Notice not saved: ${error.message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (Date.now() >= session.expiresAt || !(await authorize(commandInteraction, session))) {
    await submission.reply({ content: 'This profile session expired or you no longer have access.', flags: MessageFlags.Ephemeral });
    return;
  }

  const preview = new EmbedBuilder().setColor(cfg.green)
    .setTitle(action === 'add' ? 'Confirm new inactivity notice' : 'Confirm notice changes')
    .setDescription(`**${form.startDate} – ${form.endDate}**\n` +
      `**Length:** ${notices.durationDays(form.startDate, form.endDate)} days\n` +
      `**Reason:** ${safeMarkdown(form.reason)}\n\nNo change is saved until you select Confirm.`);
  const confirmId = `sp-confirm:${session.id}:${crypto.randomBytes(5).toString('hex')}`;
  const cancelId = `sp-cancel:${session.id}:${crypto.randomBytes(5).toString('hex')}`;
  await submission.reply({
    embeds: [preview], flags: MessageFlags.Ephemeral,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm').setStyle(ButtonStyle.Success),
    )],
    allowedMentions: { parse: [] },
  });

  try {
    const previewMsg = await submission.fetchReply();
    const result = await previewMsg.awaitMessageComponent({
      filter: (i) => i.user.id === session.viewerId &&
        (i.customId === confirmId || i.customId === cancelId),
      time: Math.max(1, session.expiresAt - Date.now()),
    });
    if (result.customId === cancelId) {
      await result.update({ content: 'Inactivity notice cancelled. No changes saved.', embeds: [], components: [] });
      return;
    }
    if (Date.now() >= session.expiresAt || !(await authorize(commandInteraction, session))) {
      await result.update({ content: 'This session has expired or access was revoked. Nothing was saved.', embeds: [], components: [] });
      return;
    }
    try {
      if (action === 'add') {
        notices.createNotice(targetId, session.viewerId, form);
      } else {
        notices.updateNotice(targetId, noticeId, session.viewerId, form, original.revision);
      }
      await result.update({ content: 'Inactivity notice saved.', embeds: [], components: [] });
      session.page = 2;
      await commandInteraction.editReply(await render(commandInteraction, session));
    } catch (error) {
      await result.update({ content: `Notice not saved: ${error.message}`, embeds: [], components: [] });
    }
  } catch {
    // Timeout of Confirm/Cancel: don't persist anything, clear popup buttons.
    await submission.editReply({
      content: 'Confirmation timed out. No changes were saved.', embeds: [], components: [],
    }).catch(() => {});
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staffprofile')
    .setDescription('Open your private two-page staff profile.')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('View another staff member (senior staff only).')
      .setRequired(false)),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: 'This command can only be used in the staff server.', flags: MessageFlags.Ephemeral });
    }
    let viewer;
    try {
      viewer = await interaction.guild.members.fetch(interaction.user.id);
    } catch {
      return interaction.reply({ content: 'Unable to verify your server roles.', flags: MessageFlags.Ephemeral });
    }
    if (!roleOrHigher(viewer, cfg.staffRoleId)) {
      return interaction.reply({ content: 'You do not have permission to use /staffprofile.', flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;
    if (targetUser.id !== interaction.user.id && !roleOrHigher(viewer, cfg.seniorRoleId)) {
      return interaction.reply({ content: 'Only senior staff can view other staff profiles.', flags: MessageFlags.Ephemeral });
    }
    try {
      await interaction.guild.members.fetch(targetUser.id);
    } catch {
      return interaction.reply({ content: 'The selected user is not in this server.', flags: MessageFlags.Ephemeral });
    }

    const session = {
      id: crypto.randomBytes(5).toString('hex'),
      viewerId: interaction.user.id,
      targetId: targetUser.id,
      page: 1,
      noticePage: 0,
      totalNoticePages: 1,
      expiresAt: Date.now() + cfg.sessionTimeoutMs,
    };

    try {
      await interaction.reply({ ...await render(interaction, session), flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('[staffprofile] Initial render error:', error);
      return interaction.reply({ content: 'Could not load staff profile data. Check the JSON file structure and console.', flags: MessageFlags.Ephemeral });
    }

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === session.viewerId && i.customId.startsWith(`sp:${session.id}:`),
      time: cfg.sessionTimeoutMs,
    });

    collector.on('collect', async (buttonInteraction) => {
      try {
        if (Date.now() >= session.expiresAt || !(await authorize(interaction, session))) {
          await buttonInteraction.reply({ content: 'This profile expired or your access has changed.', flags: MessageFlags.Ephemeral });
          collector.stop('expired');
          return;
        }
        const action = buttonInteraction.customId.slice(`sp:${session.id}:`.length);
        if (action === 'close') {
          await buttonInteraction.update({ components: [] });
          collector.stop('closed');
          return;
        }
        if (action === 'add') {
          await startForm(buttonInteraction, interaction, session, 'add');
          return;
        }
        if (action.startsWith('edit:')) {
          await startForm(buttonInteraction, interaction, session, 'edit', action.slice(5));
          return;
        }
        if (action.startsWith('remove:')) {
          const id = action.slice(7);
          const found = notices.listForUser(session.targetId).find((n) => n.id === id);
          if (!found) throw new Error('That notice was not found.');
          // Remove is a soft delete, preserving senior removals for the owner to see.
          notices.removeNotice(session.targetId, id, session.viewerId);
          await buttonInteraction.update(await render(interaction, session));
          return;
        }
        if (action === 'page1') session.page = 1;
        if (action === 'page2') session.page = 2;
        if (action === 'older') session.noticePage -= 1;
        if (action === 'newer') session.noticePage += 1;
        // Refresh re-reads all three JSON files; no quota/payment changes are made.
        await buttonInteraction.update(await render(interaction, session));
      } catch (error) {
        console.error('[staffprofile] Button error:', error);
        const options = { content: `Unable to process action: ${error.message}`, flags: MessageFlags.Ephemeral };
        if (!buttonInteraction.replied && !buttonInteraction.deferred) {
          await buttonInteraction.reply(options).catch(() => {});
        } else {
          await buttonInteraction.followUp(options).catch(() => {});
        }
      }
    });

    collector.on('end', async () => {
      // Disables ALL original profile buttons after five minutes.
      await interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};