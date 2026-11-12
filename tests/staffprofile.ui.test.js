'use strict';

// Tests the command's layout and role guards without connecting to Discord.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const EventEmitter = require('node:events');
const Module = require('node:module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'summitbot-ui-test-'));
process.env.SUMMITBOT_STAFF_DATA_DIR = tmp;

class Builder {
  constructor() { this.components = []; this.fields = []; }
  setName(v) { this.name = v; return this; }
  setDescription(v) { this.description = v; return this; }
  setTitle(v) { this.title = v; return this; }
  setColor(v) { this.color = v; return this; }
  setFooter(v) { this.footer = v; return this; }
  setThumbnail(v) { this.thumbnail = v; return this; }
  addFields(...items) { this.fields.push(...items); return this; }
  setCustomId(v) { this.customId = v; return this; }
  setLabel(v) { this.label = v; return this; }
  setStyle(v) { this.style = v; return this; }
  setDisabled(v) { this.disabled = v; return this; }
  setRequired(v) { this.required = v; return this; }
  setMaxLength(v) { this.max = v; return this; }
  setValue(v) { this.value = v; return this; }
  setPlaceholder(v) { this.placeholder = v; return this; }
  addComponents(...items) { this.components.push(...items); return this; }
  addUserOption(fn) { fn(new Builder()); return this; }
}
const stub = {
  SlashCommandBuilder: Builder, EmbedBuilder: Builder, ActionRowBuilder: Builder,
  ButtonBuilder: Builder, ModalBuilder: Builder, TextInputBuilder: Builder,
  ButtonStyle: { Primary: 1, Secondary: 2, Success: 3, Danger: 4 },
  TextInputStyle: { Short: 1, Paragraph: 2 },
  MessageFlags: { Ephemeral: 64 },
};
const oldLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'discord.js') return stub;
  return oldLoad.call(this, name, parent, isMain);
};
const command = require('../commands/staffprofile');
Module._load = oldLoad;
const cfg = require('../staff/profileConfig');

function makeGuild(guide = true, senior = false, otherTarget = false) {
  const id = '123456789012345678';
  const required = new Map([
    [cfg.staffRoleId, { position: 10 }],
    [cfg.seniorRoleId, { position: 20 }],
  ]);
  const present = new Set([cfg.staffRoleId]);
  if (guide) present.add(cfg.guideRoleId);
  if (senior) present.add(cfg.seniorRoleId);
  const member = {
    user: { id, username: 'Tester', displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png' },
    roles: {
      cache: { has: (x) => present.has(x) },
      highest: { id: senior ? cfg.seniorRoleId : cfg.staffRoleId, name: 'Guide', position: senior ? 20 : 10 },
    },
  };
  const targetUser = { id: '234567890123456789', username: 'AnotherStaff',
    displayAvatarURL: () => 'https://cdn.discordapp.com/target.png' };
  const target = { user: targetUser, id: targetUser.id, roles: {
    cache: { has: (x) => [cfg.staffRoleId, cfg.guideRoleId].includes(x) },
    highest: { id: cfg.staffRoleId, name: 'Guide', position: 10 },
  } };
  const guild = {
    id: '987987987987987987',
    roles: { cache: { get: (x) => required.get(x) } },
    members: { fetch: async (id) => id === targetUser.id ? target : member },
  };
  member.guild = guild;
  target.guild = guild;
  return { guild, user: member.user, targetUser: otherTarget ? targetUser : null };
}

function fakeInteraction(guide = true, senior = false, otherTarget = false) {
  const { guild, user, targetUser } = makeGuild(guide, senior, otherTarget);
  const collector = new EventEmitter();
  collector.stop = () => collector.emit('end');
  let reply;
  return {
    guild, user, collector,
    options: { getUser: () => targetUser },
    inGuild: () => true,
    reply: async (data) => { reply = data; },
    fetchReply: async () => ({ createMessageComponentCollector: () => collector }),
    editReply: async (data) => { reply = { ...reply, ...data }; },
    get output() { return reply; },
  };
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 40)); }

test('profile page displays only department present, and private buttons', async () => {
  const id = '123456789012345678';
  fs.writeFileSync(path.join(tmp, 'stafflogs.json'), JSON.stringify({ staff: {
    [id]: { guide: { hosted: { week: 2, month: 7, allTime: 10 },
      coHosted: { week: 1, month: 2, allTime: 5 }, weeklyPoints: 2.5 } },
  } }));
  const interaction = fakeInteraction(true);
  await command.execute(interaction);
  assert.equal(interaction.output.flags, 64);
  assert.equal(interaction.output.embeds[0].fields.length, 2);
  const stats = interaction.output.embeds[0].fields[1].value;
  assert.match(stats, /Guide department/);
  assert.match(stats, /2\.5/);
  assert.doesNotMatch(stats, /S&R department/);

  const page2Id = interaction.output.components[0].components[0].customId;
  let updated;
  interaction.collector.emit('collect', {
    user: interaction.user,
    customId: page2Id,
    update: async (p) => { updated = p; },
  });
  await flush();
  assert.ok(updated?.embeds?.some((e) => e.title?.includes('Inactivity Notices')));
  assert.ok(updated?.embeds?.some((e) => e.description?.includes('Payments due this week')));
  assert.equal(updated.components.length, 2);
  assert.equal(updated.components[1].components.some((c) => c.label === 'Edit warnings'), false);
  interaction.collector.stop();
});

test('senior can edit another staff member warnings using modal and confirmation', async () => {
  const targetId = '234567890123456789';
  fs.writeFileSync(path.join(tmp, 'stafflogs.json'), JSON.stringify({
    schemaVersion: 1,
    staff: { [targetId]: { guide: { warnings: 2 }, sar: { warnings: 1 } } },
  }));
  const interaction = fakeInteraction(true, true, true);
  await command.execute(interaction);
  const page2Id = interaction.output.components[0].components[0].customId;
  let page2;
  interaction.collector.emit('collect', {
    user: interaction.user, customId: page2Id,
    update: async (data) => { page2 = data; },
  });
  await flush();
  const editButton = page2.components[1].components.find((c) => c.label === 'Edit warnings');
  assert.ok(editButton);
  assert.equal(page2.components.length, 2);
  let shownModal, preview, confirmed;
  const modalSubmission = {
    user: interaction.user,
    fields: { getTextInputValue: (id) => ({ guide: '1', sar: '3', reason: 'Manager correction' })[id] },
    reply: async (data) => { preview = data; },
    fetchReply: async () => ({
      awaitMessageComponent: async () => ({
        user: interaction.user,
        customId: preview.components[0].components[1].customId,
        update: async (data) => { confirmed = data; },
      }),
    }),
  };
  interaction.collector.emit('collect', {
    user: interaction.user, guild: interaction.guild,
    customId: editButton.customId,
    showModal: async (modal) => { shownModal = modal; },
    awaitModalSubmit: async () => modalSubmission,
  });
  await flush();
  assert.equal(shownModal.title, 'Edit staff warnings');
  assert.match(preview.embeds[0].description, /2 → \*\*1\*\*/);
  assert.match(confirmed.content, /saved/);
  const db = JSON.parse(fs.readFileSync(path.join(tmp, 'stafflogs.json'), 'utf8'));
  assert.equal(db.staff[targetId].guide.warnings, 1);
  assert.equal(db.staff[targetId].sar.warnings, 3);
  assert.equal(db.staff[targetId].warningHistory[0].by, interaction.user.id);
  assert.ok(interaction.output.embeds.some((e) => e.description?.includes('Recent warning changes')));
  interaction.collector.stop();
});

test('senior cancellation does not write warnings', async () => {
  const targetId = '234567890123456789';
  const before = fs.readFileSync(path.join(tmp, 'stafflogs.json'), 'utf8');
  const interaction = fakeInteraction(true, true, true);
  await command.execute(interaction);
  let page2;
  interaction.collector.emit('collect', {
    user: interaction.user,
    customId: interaction.output.components[0].components[0].customId,
    update: async (data) => { page2 = data; },
  });
  await flush();
  const edit = page2.components[1].components.find((b) => b.label === 'Edit warnings');
  let preview, cancelResult;
  const modalSubmission = {
    user: interaction.user,
    fields: { getTextInputValue: (id) => ({ guide: '0', sar: '0', reason: 'Cancel test' })[id] },
    reply: async (data) => { preview = data; },
    fetchReply: async () => ({ awaitMessageComponent: async () => ({
      user: interaction.user,
      customId: preview.components[0].components[0].customId,
      update: async (data) => { cancelResult = data; },
    }) }),
  };
  interaction.collector.emit('collect', {
    user: interaction.user, guild: interaction.guild, customId: edit.customId,
    showModal: async () => {},
    awaitModalSubmit: async () => modalSubmission,
  });
  await flush();
  assert.match(cancelResult.content, /cancelled/);
  assert.equal(fs.readFileSync(path.join(tmp, 'stafflogs.json'), 'utf8'), before);
  interaction.collector.stop();
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));