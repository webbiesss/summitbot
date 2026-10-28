'use strict';
const { AttachmentBuilder } = require('discord.js');
const config = require('./config');
const logic = require('./logic');

function textFile(name, lines) {
  return new AttachmentBuilder(Buffer.from(lines.join('\n') + '\n', 'utf8'), { name });
}
async function publish(client, closed) {
  const guide = closed.rows.filter(r => r.dept === 'guide');
  const sar = closed.rows.filter(r => r.dept === 'sar');
  const quotaLines = closed.rows.map(r =>
    `${r.dept.toUpperCase()} | ${r.id} | quota ${r.score}/${r.target} | ${r.result} | warnings: ${r.warningsAfter}`
  );
  const payoutLines = closed.balances.map(r =>
    `${r.id} | unpaid balance: ${logic.money(r.balanceHalf)} Robux`
  );
  const weekPayLines = closed.rows.map(r =>
    `${r.dept.toUpperCase()} | ${r.id} | earned for week: ${logic.money(r.paidThisWeekHalf)} Robux`
  );
  const targets = [
    { channelId: config.weeklyQuotaReportChannelId, label: 'QUOTA', lines: quotaLines, name: `quota_${closed.week}.txt` },
    { channelId: config.weeklyPaymentReportChannelId, label: 'PAYMENTS', lines: [...weekPayLines, '', 'CURRENT UNPAID BALANCES', ...payoutLines], name: `payout_${closed.week}.txt` }
  ];
  for (const target of targets) {
    if (!target.channelId) continue;
    try {
      const channel = await client.channels.fetch(target.channelId);
      if (!channel || typeof channel.send !== 'function') throw new Error('Invalid reporting channel');
      await channel.send({
        content: `**STAFF ${target.label} — week of ${closed.week} (closed)**\n` +
          `Guide staff checked: **${guide.length}** • S&R staff checked: **${sar.length}**.\n` +
          `Full export attached. Check the archive for the exact closure snapshot.`,
        files: [textFile(target.name, target.lines)],
        allowedMentions: { parse: [] }
      });
    } catch (err) {
      console.error(`[staff] Could not publish ${target.label} report:`, err);
    }
  }
}
let installed = false;
function startStaffScheduler(client) {
  if (installed) return;
  installed = true;
  let running = false;
  async function check() {
    if (running) return;
    running = true;
    try {
      const closed = logic.rollover();
      for (const week of closed) {
        console.log(`[staff] Closed quota week ${week.week} → ${week.filename}`);
        await publish(client, week);
      }
    } catch (err) {
      console.error('[staff] Weekly scheduler failed:', err);
    } finally { running = false; }
  }
  void check();
  const timer = setInterval(() => void check(), config.checkIntervalMs);
  // The actual bot process must remain online for automatic weekly runs.
  return timer;
}
module.exports = { startStaffScheduler, publish };
