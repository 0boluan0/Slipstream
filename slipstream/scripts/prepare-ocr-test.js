'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app } = require('electron');
const { createOcrEnvironment } = require('../src/main/ocr-environment');

module.exports = function prepareOcrTest(imagePath) {
  // Installed apps bundle the helper. Development compilation belongs to test
  // setup, outside the unchanged 15-second recognition request deadline.
  execFileSync('/bin/bash', [path.join(__dirname, 'ocr-swift-runner.sh'), imagePath], {
    env: createOcrEnvironment(path.join(app.getPath('userData'), 'ocr-cache')),
    timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  });
};
