const cron = require('node-cron');
const { archivePastMonth } = require('../services/monthlyArchiveService');

// Run on the 1st of every month at 00:00
cron.schedule('0 0 1 * *', async () => {
  console.log('[Cron] Running month transition job...');
  try {
    await archivePastMonth();
    console.log('[Cron] Month transition job completed successfully.');
  } catch (err) {
    console.error('[Cron] Month transition job failed:', err);
  }
});
