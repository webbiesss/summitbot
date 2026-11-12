'use strict';
/**
 * SummitBot Guide Historical Audit (READ ONLY)
 *
 * Inspects one Guide log by message ID/link or scans the main Guide channel.
 * NEVER changes Discord messages, reactions, quotas, payments or JSON files.
 *
 * One specific message:
 *   node scripts/auditPendingGuideExpeditions.js --message=1561860556397346826
 *   node scripts/auditPendingGuideExpeditions.js --message=https://discord.com/channels/GUILD/CHANNEL/MESSAGE
 *   node scripts/auditPendingGuideExpeditions.js --message=MESSAGE_ID --channel=THREAD_ID
 *
 * Reaction discovery across the Guide channel:
 *   node scripts/auditPendingGuideExpeditions.js
 *
 * Legacy single-emoji audit:
 *   node scripts/auditPendingGuideExpeditions.js --emoji=1546161163304304771
 *
 * Override the historical accepted emoji list for single-message diagnosis:
 *   node scripts/auditPendingGuideExpeditions.js --message=MESSAGE_ID --emojis=ID,✅,👍
 *
 * Requires discord.js v14, dotenv and a TOKEN in .env. Run from repo root.
 */
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { parseHistoricalGuideLog } = require('../staff/staffLogListener');

const GUIDE_CHANNEL_ID = '795373221322686466';
const SENIOR_ROLE_ID = '1528783820097196083';
const HISTORICAL_EMOJIS = [
  '1546161163304304771', // Worldian_Tickmark
  '🖊️',
  '✅',
  '👍',
  '852920746941612042',  // yep
  '653206565146591232',  // yes
];
const ALLOW_AUTHOR_APPROVAL = true; // Match the importer setting.
// If the importer has custom nameToUserId mappings, duplicate them here for audit accuracy.
const NAME_TO_USER_ID = {};

function option(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg === undefined ? undefined : arg.slice(prefix.length);
}
function hasFlag(name) { return process.argv.includes(`--${name}`); }
function asId(value) { return String(value || '').trim(); }
function emojiKey(reaction) { return asId(reaction.emoji?.id || reaction.emoji?.name); }
function urlFor(message) {
  return message.url || `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`;
}
function inc(stats, key) { stats[key] = (stats[key] || 0) + 1; }
function pushSample(examples, key, entry, limit) {
  examples[key] ||= [];
  if (examples[key].length < limit) examples[key].push(entry);
}
function parseTarget(input, channelOverride = GUIDE_CHANNEL_ID) {
  const raw = asId(input);
  const link = raw.match(/^https?:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:[/?#].*)?$/i);
  if (link) return { guildId: link[1], channelId: link[2], messageId: link[3] };
  if (/^\d{17,20}$/.test(raw) && /^\d{17,20}$/.test(channelOverride)) {
    return { guildId: null, channelId: channelOverride, messageId: raw };
  }
  throw new Error('Use --message=DISCORD_MESSAGE_ID or --message=FULL_DISCORD_MESSAGE_LINK.');
}
function acceptedList() {
  const single = option('emoji');
  const multi = option('emojis');
  if (single && multi) throw new Error('Use --emoji or --emojis, not both.');
  const list = single ? [single] : multi ? multi.split(',').map((x) => x.trim()) : HISTORICAL_EMOJIS;
  if (!list.length || list.some((x) => !x || /^:[\w-]+:$/.test(x))) {
    throw new Error('For custom emojis use numeric IDs, not :emoji_name:.');
  }
  return [...new Set(list.map(String))];
}
function memberIsSenior(member, seniorRole) {
  return Boolean(member?.roles?.cache && (member.roles.cache.has(seniorRole.id) ||
    member.roles.highest?.position >= seniorRole.position));
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

async function collectReactionUsers(reaction, message, seniorRole, authorCanApprove) {
  const result = { users: [], errors: [], eligibleCount: 0, rejectedCounts: {} };
  let after;
  while (true) {
    let users;
    try {
      users = await reaction.users.fetch({ limit: 100,
        ...(after ? { after } : {}) });
    } catch (error) {
      result.errors.push(`Could not fetch reaction users: ${error.message}`);
      break;
    }
    if (!users.size) break;
    for (const user of users.values()) {
      let reason = 'eligible_senior';
      let highestRole = null;
      if (user.bot) reason = 'bot';
      else if (!authorCanApprove && user.id === message.author?.id) reason = 'self_approval';
      else {
        try {
          const member = await message.guild.members.fetch(user.id);
          highestRole = member.roles.highest?.name || null;
          if (!memberIsSenior(member, seniorRole)) reason = 'not_currently_senior';
        } catch (error) {
          reason = 'member_unavailable';
        }
      }
      if (reason === 'eligible_senior') result.eligibleCount++;
      else inc(result.rejectedCounts, reason);
      result.users.push({
        id: user.id,
        username: user.username,
        reason,
        ...(highestRole ? { highestRole } : {}),
      });
    }
    if (users.size < 100) break;
    const last = [...users.keys()].at(-1);
    if (!last || last === after) {
      result.errors.push('Reaction pagination stalled.');
      break;
    }
    after = last;
  }
  return result;
}

function namesFromRaw(raw) {
  const value = asId(raw);
  if (!value || /^(?:n\/?a|none|no|-)$/i.test(value)) return [];
  return value.split(/\s*,\s*|\s+\band\b\s+/i).map((s) => s.trim()).filter(Boolean);
}
function resolvePerson(raw, message) {
  const mention = asId(raw).match(/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/);
  if (mention) return { input: raw, id: mention[1] || mention[2], source: 'mention' };
  const name = asId(raw).replace(/^@/, '').replace(/^[`*_]+|[`*_]+$/g, '');
  if (!name) return { input: raw, id: null, issue: 'Blank staff name.' };
  const alias = Object.entries(NAME_TO_USER_ID).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (alias && /^\d{17,20}$/.test(alias[1])) {
    return { input: raw, id: alias[1], source: 'alias' };
  }
  const members = message.guild?.members?.cache;
  const matched = members ? [...members.values()].filter((member) =>
    [member.user?.username, member.user?.globalName, member.displayName]
      .filter(Boolean).some((value) => value.toLowerCase() === name.toLowerCase())) : [];
  if (matched.length === 1) return { input: raw, id: matched[0].id, source: 'exact_name_cached' };
  if (matched.length > 1) return { input: raw, id: null, issue: `Ambiguous staff name: ${raw}` };
  return { input: raw, id: null,
    issue: `Cannot resolve ${raw}. Use a Discord mention or an entry in nameToUserId.` };
}
function checkParticipants(parsed, message) {
  const issues = [...parsed.issues];
  const guide = resolvePerson(parsed.guideRaw, message);
  if (!guide.id) issues.push(guide.issue);
  const coHosts = namesFromRaw(parsed.coHostsRaw).map((name) => resolvePerson(name, message));
  const coHostIds = [];
  for (const coHost of coHosts) {
    if (!coHost.id) issues.push(coHost.issue);
    else if (!coHostIds.includes(coHost.id)) coHostIds.push(coHost.id);
  }
  if (guide.id && coHostIds.includes(guide.id)) issues.push('Guide cannot also be Co-Host.');
  return { guide, coHosts, issues };
}
function decideStatus(parsed, matchingEligibleCount, participantIssues) {
  if (!parsed) return 'not_recognized';
  if (matchingEligibleCount > 0) return participantIssues.length ? 'needs_review' : 'approved';
  return parsed.issues.length ? 'needs_review' : 'pending';
}

async function diagnoseOne(client, rawTarget, accepted) {
  const { guildId, channelId, messageId } = parseTarget(rawTarget, option('channel') || GUIDE_CHANNEL_ID);
  const channel = await client.channels.fetch(channelId);
  if (!channel?.messages?.fetch) throw new Error(`Cannot read channel ${channelId}. Check bot permissions.`);
  if (channel.id !== GUIDE_CHANNEL_ID && channel.parentId !== GUIDE_CHANNEL_ID) {
    throw new Error(`Channel ${channel.id} is not the configured Guide channel or one of its threads.`);
  }
  const message = await channel.messages.fetch({ message: messageId, cache: false });
  if (!message?.guildId) throw new Error('Target message is not a server message.');
  if (guildId && message.guildId !== guildId) throw new Error('Message guild does not match the supplied URL.');
  const seniorRole = await message.guild.roles.fetch(SENIOR_ROLE_ID);
  if (!seniorRole) throw new Error(`Senior role ${SENIOR_ROLE_ID} not found.`);
  const parsed = parseHistoricalGuideLog(message.content);
  const participants = parsed ? checkParticipants(parsed, message) : null;
  const reactions = [];
  let eligible = 0;
  let incomplete = false;
  for (const reaction of message.reactions?.cache?.values() || []) {
    const key = emojiKey(reaction);
    const isAccepted = accepted.includes(key);
    const checked = await collectReactionUsers(reaction, message, seniorRole, ALLOW_AUTHOR_APPROVAL);
    if (isAccepted) eligible += checked.eligibleCount;
    if (checked.errors.length) incomplete = true;
    reactions.push({ emoji: reaction.emoji?.name, id: key, total: reaction.count || 0,
      accepted: isAccepted, eligible: checked.eligibleCount,
      rejected: checked.rejectedCounts, users: checked.users,
      errors: checked.errors });
  }
  const predicted = message.author?.bot ? 'ignored_bot_message' :
    decideStatus(parsed, eligible, participants?.issues || []);
  console.log('\nGUIDE MESSAGE DIAGNOSTIC (READ ONLY)');
  console.log('Message:', urlFor(message));
  console.log('Message ID:', message.id);
  console.log('Message author:', `${message.author?.username || '(unknown)'} (${message.author?.id || '?'})`);
  console.log('Posted (UTC):', message.createdAt?.toISOString?.() || '(unknown)');
  console.log('Attachments:', message.attachments?.size || 0, '| Embeds:', message.embeds?.length || 0);
  console.log('Accepted verification emojis:', accepted.join(', '));
  console.log('Requires current senior role:', SENIOR_ROLE_ID);
  console.log('Author can verify own log:', ALLOW_AUTHOR_APPROVAL);
  console.log('\nHISTORICAL PARSER');
  console.log('Guide field:', parsed?.guideRaw || '(missing/not recognized)');
  console.log('Co-Host field:', parsed?.coHostsRaw || '(missing/N/A)');
  console.log('Recognized historical Guide log:', Boolean(parsed));
  console.log('Parser issues:', parsed?.issues.length ? parsed.issues : '(none)');
  if (!parsed) {
    console.log('First 1500 characters of message content:', JSON.stringify(asId(message.content).slice(0, 1500)));
    console.log('NOTE: The historical parser reads message text, not text inside screenshots or image attachments.');
  }
  console.log('\nSTAFF IDENTIFICATION');
  console.log('Guide:', participants?.guide || '(not parsed)');
  console.log('Co-Hosts:', participants?.coHosts.length ? participants.coHosts : '(none)');
  console.log('Identification issues:', participants?.issues.length ? participants.issues : '(none)');
  console.log('\nREACTIONS AND REVIEWERS');
  if (!reactions.length) console.log('(No reactions found on the message)');
  for (const r of reactions) {
    console.log(`\n${r.emoji || r.id} [${r.id}] | uses=${r.total} | ACCEPTED=${r.accepted} | eligible senior reactions=${r.eligible}`);
    if (!r.users.length) console.log('  (No reaction users returned)');
    for (const u of r.users) console.log(`  - ${u.username} (${u.id}): ${u.reason}${u.highestRole ? ` [highest role: ${u.highestRole}]` : ''}`);
    for (const error of r.errors) console.log('  FETCH ERROR:', error);
  }
  console.log('\nPREDICTED HISTORICAL IMPORT STATUS:', predicted.toUpperCase());
  if (incomplete) console.log('WARNING: Some reaction users could not be fetched; verification may be incomplete.');
  if (predicted === 'approved') console.log('Reason: eligible senior approval and resolvable Guide/Co-Host. Historical all-time counts only; 0 Robux.');
  if (predicted === 'needs_review') console.log('Reason: Guide or Co-Host is missing, ambiguous, or cannot be resolved.');
  if (predicted === 'pending') console.log('Reason: no accepted approval emoji from a currently authorized senior (excluding self/bots).');
  if (predicted === 'not_recognized') console.log('Reason: no readable Guide/Co-Host field in message.content.');
  console.log('\nNo JSON records, Discord messages, or reactions were changed.');
}

async function discovery(client) {
  const target = await client.channels.fetch(GUIDE_CHANNEL_ID);
  if (!target?.messages?.fetch) throw new Error('Guide channel unavailable or unreadable.');
  const seniorRole = await target.guild.roles.fetch(SENIOR_ROLE_ID);
  if (!seniorRole) throw new Error(`Senior role ${SENIOR_ROLE_ID} not found.`);
  const singleEmoji = option('emoji');
  const maxSamples = Number(option('samples') || 6);
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 20) {
    throw new Error('--samples must be 1 through 20.');
  }
  const byReason = {}, examples = {}, reactionCounts = new Map();
  let scanned = 0, recognized = 0;
  for await (const message of messagesIn(target)) {
    scanned++;
    if (message.author?.bot || !message.guildId) continue;
    const parsed = parseHistoricalGuideLog(message.content);
    if (!parsed) continue;
    recognized++;
    const reactions = [...(message.reactions?.cache?.values() || [])];
    for (const reaction of reactions) {
      const key = emojiKey(reaction);
      const entry = reactionCounts.get(key) || { id: key, name: reaction.emoji?.name, messages: 0, uses: 0 };
      entry.messages++;
      entry.uses += reaction.count || 0;
      reactionCounts.set(key, entry);
    }
    let reason;
    if (!singleEmoji) reason = reactions.length ? 'contains_reactions' : 'no_reactions';
    else {
      const matching = reactions.find((r) => emojiKey(r) === singleEmoji);
      if (!matching) reason = reactions.length ? 'different_emoji_only' : 'no_reactions';
      else {
        const reviewers = await collectReactionUsers(matching, message, seniorRole, ALLOW_AUTHOR_APPROVAL);
        if (reviewers.errors.length) reason = 'reaction_users_fetch_failed';
        else if (reviewers.eligibleCount) reason = parsed.issues.length ? 'approved_emoji_but_parse_issues' : 'eligible_senior_reaction';
        else if (reviewers.rejectedCounts.not_currently_senior || reviewers.rejectedCounts.member_unavailable) reason = 'emoji_only_non_senior_or_former_senior';
        else if (reviewers.rejectedCounts.self_approval) reason = 'emoji_only_by_log_author';
        else reason = 'emoji_only_by_bot_or_no_user';
      }
    }
    inc(byReason, reason);
    pushSample(examples, reason, {
      link: urlFor(message), guide: parsed.guideRaw || '(missing)', issues: parsed.issues,
    }, maxSamples);
  }
  console.log('\nGUIDE HISTORICAL AUDIT (READ ONLY)');
  console.log(`Messages scanned: ${scanned}; recognizable Guide logs: ${recognized}`);
  console.log(`Configured emoji checked: ${singleEmoji || '(none; discovery mode)'}`);
  console.log('\nREACTIONS FOUND ON RECOGNIZED GUIDE LOGS');
  console.table([...reactionCounts.values()].sort((a, b) => b.messages - a.messages).slice(0, 25));
  console.log('\nVERIFICATION DIAGNOSTIC COUNTS');
  console.table(byReason);
  console.log('\nEXAMPLE LOGS BY CATEGORY');
  for (const [reason, list] of Object.entries(examples)) {
    console.log(`\n${reason}:`);
    for (const row of list) {
      console.log(`  ${row.link} | Guide: ${row.guide}`);
      if (row.issues.length) console.log(`    Parsing: ${row.issues.join(' | ')}`);
    }
  }
  if (!singleEmoji) console.log('\nNEXT: add --message=ID or --message=FULL_LINK to inspect one log.');
  console.log('\nNo JSON records, Discord messages, or reactions were changed.');
}

async function main() {
  if (hasFlag('help')) {
    console.log('Usage: node scripts/auditPendingGuideExpeditions.js [--message=ID_OR_LINK] [--channel=THREAD_ID] [--emojis=ID,✅,...]');
    console.log('With no --message: inspect reactions in the Guide channel; --emoji=ID checks one verification emoji.');
    console.log('Single-message diagnosis uses all six historic verification emojis unless overridden.');
    return;
  }
  if (!process.env.TOKEN) throw new Error('Missing TOKEN in the .env file.');
  const client = new Client({ intents: [GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent] });
  try {
    await client.login(process.env.TOKEN);
    if (option('message')) await diagnoseOne(client, option('message'), acceptedList());
    else await discovery(client);
  } finally {
    client.destroy();
  }
}
if (require.main === module) {
  main().catch((error) => {
    console.error('[Guide audit] FAILED:', error.message);
    process.exitCode = 1;
  });
}
module.exports = { parseTarget, decideStatus, namesFromRaw, acceptedList, checkParticipants, diagnoseOne, collectReactionUsers, memberIsSenior };