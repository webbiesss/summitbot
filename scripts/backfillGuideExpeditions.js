'use strict';

/**
 * One-time historical Guide log import. Run with the main bot STOPPED:
 *   node scripts/backfillGuideExpeditions.js --dry-run
 *   node scripts/backfillGuideExpeditions.js --apply
 *
 * An authorized verification reaction must exist; pending/unresolved messages
 * are saved for later review without counting or creating payments.
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { backfillGuideHistory } = require('../staff/staffLogListener');

const args = process.argv.slice(2);
if (args.some((a) => !['--dry-run', '--apply', '--private-threads'].includes(a)) ||
    (args.includes('--apply') && args.includes('--dry-run'))) {
  console.error('Usage: node scripts/backfillGuideExpeditions.js [--dry-run | --apply] [--private-threads]');
  process.exitCode = 1;
} else if (!process.env.TOKEN) {
  console.error('Missing TOKEN in environment/.env');
  process.exitCode = 1;
} else {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.MessageContent],
  });
  (async () => {
    try {
      await client.login(process.env.TOKEN);
      const result = await backfillGuideHistory(client, {
        dryRun: !args.includes('--apply'),
        includePrivateThreads: args.includes('--private-threads'),
        // Match the approval emoji configured in staff/staffLogListener.js
      });
      console.log('[Guide historical import]', JSON.stringify(result, null, 2));
      if (result.dryRun) console.log('Dry-run complete: no JSON files were modified.');
      else console.log('Historical import complete: statistics updated; no historical Robux credited.');
    } catch (err) {
      console.error('[Guide historical import] FAILED:', err);
      process.exitCode = 1;
    } finally {
      client.destroy();
    }
  })();
}