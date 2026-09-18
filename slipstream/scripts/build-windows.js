'use strict';

const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const pkg = require('../package.json');

function windowsConfig() {
  return {
    ...pkg.build,
    appId: 'com.slipstream.windows-preview',
    productName: 'Slipstream Windows Preview',
    directories: { output: 'release/windows-preview' },
    afterPack: null,
    afterSign: null,
    extraResources: [],
    publish: null,
    extraMetadata: {
      main: 'src/main/windows-preview-main.js',
      slipstreamWindowsPreview: true,
      slipstreamBuildIdentity: 'windows-preview',
    },
    win: {
      target: ['nsis'],
      executableName: 'Slipstream Windows Preview',
      signAndEditExecutable: false,
      artifactName: 'Slipstream-Windows-Preview-${version}-${arch}-Setup.${ext}',
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false,
    },
  };
}

async function buildWindows() {
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Build this preview on Windows or macOS.');
  const artifacts = await build({
    projectDir: path.join(__dirname, '..'),
    config: windowsConfig(),
    targets: Platform.WINDOWS.createTarget(process.argv.includes('--dir') ? 'dir' : 'nsis', Arch.x64),
    publish: 'never',
  });
  for (const artifact of artifacts) console.log(artifact);
}

if (require.main === module) {
  buildWindows().catch((error) => { console.error(error); process.exitCode = 1; });
}
module.exports = { windowsConfig };
