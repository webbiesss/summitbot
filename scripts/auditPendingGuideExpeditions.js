'use strict';
/**
 * Read-only diagnostics for historical World Expeditions Guide logs.
 *
 * From the SummitBot repository root:
 *   node scripts/auditPendingGuideExpeditions.js
 *   node scripts/auditPendingGuideExpeditions.js --emoji=123456789012345678
 *
 * No data files are read or written. No Discord messages are sent or changed.
 * Omit --emoji to discover which reactions historical posts actually contain.
 */
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { parseHistoricalGuideLog } = require('../staff/staffLogListener');

const GUIDE_CHANNEL = '795373221322686466';
const SENIOR_ROLE = '1528783820097196083';

function getOption(name, fallback = '') {
  const arg = process.argv.slice(2).find(v => v.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : fallback;
}
function emojiId(reaction) {
  return String(reaction.emoji?.id || reaction.emoji?.name || '');
}
function addSample(map, key, item, maxSamples) {
  map[key] ||= [];
  if (map[key].length < maxSamples) map[key].push(item);
}
function inc(obj, key) { obj[key] = (obj[key] || 0) + 1; }
function messageUrl(message) {
  return message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}
async function* messagesIn(channel) {
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100,
      ...(before ? { before } : {}), cache: false });
    if (!page.size) break;
    for (const message of page.values()) yield message;
    before = [...page.keys()].reduce((smallest, id) =>
      BigInt(id) < BigInt(smallest) ? id : smallest);
    if (page.size < 100) break;
  }
}
async function checkApprovers(reaction, message, seniorRole) {
  const seen = { eligible: 0, self: 0, bot: 0, notSenior: 0, fetchErrors: 0 };
  let after;
  while (true) {
    let users;
    try {
      users = await reaction.users.fetch({ limit: 100, ...(after ? { after } : {}) });
    } catch (error) {
      seen.fetchErrors++;
      break;
    }
    if (!users.size) break;
    for (const user of users.values()) {
      if (user.bot) { seen.bot++; continue; }
      if (user.id === message.author?.id) { seen.self++; continue; }
      let member;
      try { member = await message.guild.members.fetch(user.id); }
      catch (error) { seen.notSenior++; continue; }
      const authorized = member.roles.cache.has(seniorRole.id) ||
        member.roles.highest.position >= seniorRole.position;
      if (authorized) seen.eligible++;
      else seen.notSenior++;
    }
    if (users.size < 100) break;
    after = [...users.keys()].at(-1);
  }
  return seen;
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/auditPendingGuideExpeditions.js [--emoji=CUSTOM_EMOJI_ID] [--samples=6]');
    console.log('No --emoji: discover existing reactions. With --emoji: classify senior verification.');
    return;
  }
  const emoji = getOption('emoji');
  const maxSamples = Number(getOption('samples', '6'));
  if (emoji && /^:[A-Za-z0-9_]+:$/.test(emoji)) {
    throw Error('Custom emoji must be provided by numeric ID, not :emoji_name:.');
  }
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 20) {
    throw Error('--samples must be an integer from 1 through 20');
  }
  if (!process.env.TOKEN) throw Error('Missing TOKEN from .env');

  const client = new Client({ intents: [GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent] });
  try {
    await client.login(process.env.TOKEN);
    const channel = await client.channels.fetch(GUIDE_CHANNEL);
    if (!channel?.messages?.fetch) throw Error('Guide channel unavailable or missing permissions');
    const role = await channel.guild.roles.fetch(SENIOR_ROLE);
    if (!role) throw Error('Configured senior role not found in this server');

    let scanned = 0, recognized = 0;
    const byReason = {};
    const examples = {};
    const emojiCounts = new Map();
    for await (const message of messagesIn(channel)) {
      scanned++;
      if (message.author?.bot || !message.guildId) continue;
      const parsed = parseHistoricalGuideLog(message.content);
      if (!parsed) continue;
      recognized++;
      const link = messageUrl(message);
      const guide = parsed.guideRaw || '(missing)';
      const reactions = [...(message.reactions?.cache?.values() || [])];
      for (const reaction of reactions) {
        const id = emojiId(reaction);
        const prev = emojiCounts.get(id) || { id, name: reaction.emoji?.name, messages: 0, uses: 0 };
        prev.messages++;
        prev.uses += reaction.count || 0;
        emojiCounts.set(id, prev);
      }
      let reason;
      const matching = emoji ? reactions.find(r => emojiId(r) === emoji) : undefined;
      if (!emoji) {
        reason = reactions.length ? 'contains_reactions' : 'no_reactions';
      } else if (!matching) {
        reason = reactions.length ? 'different_emoji_only' : 'no_reactions';
      } else {
        const approvers = await checkApprovers(matching, message, role);
        if (approvers.eligible) {
          reason = parsed.issues.length ? 'approved_emoji_but_log_has_parse_issues' : 'eligible_senior_reaction';
        } else if (approvers.fetchErrors) reason = 'reaction_users_fetch_failed';
        else if (approvers.notSenior) reason = 'emoji_only_non_senior_or_former_senior';
        else if (approvers.self) reason = 'emoji_only_by_log_author';
        else reason = 'emoji_only_by_bot_or_no_user';
      }
      inc(byReason, reason);
      addSample(examples, reason, { link, guide,
        parseIssues: parsed.issues.length ? parsed.issues : undefined }, maxSamples);
    }

    console.log('\nGUIDE HISTORICAL AUDIT (READ ONLY)');
    console.log(`Messages scanned: ${scanned}; recognizable Guide logs: ${recognized}`);
    console.log(`Configured emoji checked: ${emoji || '(none; discovery mode)'}`);
    console.log('\nREACTIONS FOUND ON RECOGNIZED GUIDE LOGS');
    console.table([...emojiCounts.values()].sort((a, b) => b.messages - a.messages).slice(0, 25));
    console.log('\nVERIFICATION DIAGNOSTIC COUNTS');
    console.table(byReason);
    console.log('\nEXAMPLE LOGS BY CATEGORY');
    for (const [reason, values] of Object.entries(examples)) {
      console.log(`\n${reason}:`);
      for (const entry of values) {
        console.log(`  ${entry.link} | Guide: ${entry.guide}`);
        if (entry.parseIssues) console.log(`    Parsing: ${entry.parseIssues.join(' | ')}`);
      }
    }
    if (!emoji) console.log('\nNEXT: run again with --emoji=NUMERIC_ID from the table above.');
    console.log('\nNo JSON records, Discord reactions, or messages were modified.');
  } finally {
    client.destroy();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[Guide audit] FAILED:', err);
    process.exitCode = 1;
  });
}
module.exports = { checkApprovers };