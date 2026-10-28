'use strict';

// Configure guild role IDs before deployment. Role checks use the actual Discord
// role POSITION: holding the specified role OR a higher role qualifies.
module.exports = {
  timezone: 'America/Vancouver',
  // A new quota week begins Monday at 00:00 Vancouver time.
  checkIntervalMs: 60_000,
  roles: {
    staff: '1528783752199929896',
    quotaManager: '1528783820097196083',
    paymentsManager: '827956658055020614',
    viewers: [
      '1539257566088003644',
      '1528783820097196083',
      '827956659317899264'
    ]
  },
  quota: { guideHalfPoints: 3, sarRescues: 1 },
  pay: {
    // Every monetary value in the internal ledger is stored in HALF-ROBUX units.
    guideHostHalf: 10,      // 5 Robux
    guideCohostHalf: 6,     // 3 Robux
    guideAttendeeHalf: 1,   // 0.5 Robux per attendee
    guideAttendeeBonusExpeditionsPerMonth: 3,
    sarHealHalf: 6,         // 3 Robux per assisted attendee
    sarLostHalf: 20,        // 10 Robux per assisted attendee
    sarSupplyHalf: 2,       // 1 Robux per assisted attendee
    // Assumption: these are maximum monthly EARNINGS, not base salaries.
    applyMonthlyCaps: true,
    guideMonthlyCapHalf: 500, // 250 Robux
    sarMonthlyCapHalf: 300   // 150 Robux
  },
  // Optional channels. Set to real IDs; NEVER post payout data in public channels.
  weeklyQuotaReportChannelId: 798250705080811530,
  weeklyPaymentReportChannelId: 798250705080811530,
  // Set true to only allow administrators of this Discord server to enroll staff.
  departmentEnrollmentRequiresAdministrator: false
};
