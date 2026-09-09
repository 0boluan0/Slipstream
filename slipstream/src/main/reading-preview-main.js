'use strict';

// Entry point for the separately built local reading preview. Its settings and
// Chromium session are isolated from the installed application's profile.
const { app, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const metadata = require('../../package.json');
if (!app.isPackaged || metadata.slipstreamReadingPreview !== true || metadata.slipstreamBuildIdentity !== 'developer-id') {
  throw new Error('Reading preview requires its separate signed build configuration.');
}
const profile = path.join(app.getPath('appData'), 'Slipstream Reading Preview');
const session = path.join(profile, 'session');
fs.mkdirSync(session, { recursive: true, mode: 0o700 });
app.setPath('userData', profile);
app.setPath('sessionData', session);
if (process.argv.includes('--screen-permission-check')) {
  // Read the permission under the exact packaged identity, before credentials,
  // windows or providers initialize. This does not request access or capture.
  app.whenReady().then(() => {
    const status = systemPreferences.getMediaAccessStatus('screen');
    process.stdout.write(`${JSON.stringify({ status, executable: app.getPath('exe') })}\n`);
    app.exit(status === 'granted' ? 0 : 1);
  });
} else if (process.argv.includes('--reading-check')) require('./reading-live-check').run();
else require('./main');
