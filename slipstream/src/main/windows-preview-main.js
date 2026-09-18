'use strict';

const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const metadata = require('../../package.json');

if (process.platform !== 'win32' || !app.isPackaged || metadata.slipstreamWindowsPreview !== true) {
  throw new Error('Windows preview requires its separate Windows build configuration.');
}
const profile = path.join(app.getPath('appData'), 'Slipstream Windows Preview');
const session = path.join(profile, 'session');
fs.mkdirSync(session, { recursive: true });
app.setName('Slipstream Windows Preview');
app.setAppUserModelId('com.slipstream.windows-preview');
app.setPath('userData', profile);
app.setPath('sessionData', session);
require('./main');
