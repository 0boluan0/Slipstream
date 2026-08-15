const { app, systemPreferences } = require('electron');

async function main() {
  await app.whenReady();
  const status = process.platform === 'darwin'
    ? systemPreferences.getMediaAccessStatus('screen')
    : 'unsupported';
  process.stdout.write(`${JSON.stringify({ platform: process.platform, status })}\n`);
  app.quit();
}

main().catch((error) => {
  process.stderr.write(`screen permission diagnostic failed: ${error?.message || 'unknown error'}\n`);
  app.exit(1);
});
