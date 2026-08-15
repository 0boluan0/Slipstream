import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererRoot = path.join(projectRoot, 'src', 'renderer');
const demoAdapterPath = path.join(rendererRoot, 'hooks', 'useIpc.js');
const productionAdapterPath = path.join(rendererRoot, 'hooks', 'useIpc.production.js');
const demoPreviewDataPath = path.join(rendererRoot, 'utils', 'previewData.js');
const productionPreviewDataPath = path.join(rendererRoot, 'utils', 'previewData.production.js');
const safeSampleSourcePath = path.join(rendererRoot, 'utils', 'safeSampleSource.js');
const viteConfigPath = path.join(projectRoot, 'vite.config.js');
const require = createRequire(import.meta.url);

const rendererSources = [];
const pendingDirectories = [rendererRoot];
while (pendingDirectories.length > 0) {
  const directory = pendingDirectories.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pendingDirectories.push(entryPath);
    } else if (/\.(?:js|jsx|mjs)$/u.test(entry.name)) {
      rendererSources.push(entryPath);
    }
  }
}

const directAdapterImports = rendererSources.filter((sourcePath) => {
  if (sourcePath === demoAdapterPath || sourcePath === productionAdapterPath) return false;
  const source = fs.readFileSync(sourcePath, 'utf8');
  return /from\s+['"][^'"]*useIpc(?:\.production)?(?:\.js)?['"]/u.test(source);
});
assert.deepEqual(directAdapterImports, [],
  'renderer consumers must import @renderer-ipc instead of bypassing the build boundary');

const ipcConsumers = rendererSources.filter((sourcePath) => (
  fs.readFileSync(sourcePath, 'utf8').includes("from '@renderer-ipc'")
));
assert.ok(ipcConsumers.length >= 5,
  'expected renderer IPC consumers to use the build-selected adapter');

const productionAdapter = fs.readFileSync(productionAdapterPath, 'utf8');
assert.match(productionAdapter, /window\.api\?\.invoke/u,
  'production IPC adapter must use the preload invoke bridge');
assert.match(productionAdapter, /window\.api\?\.on/u,
  'production IPC adapter must use the preload event bridge');
assert.doesNotMatch(productionAdapter,
  /import\.meta\.env|URLSearchParams|invokeDemo|PREVIEW_|fixture|demoMode/u,
  'production IPC adapter must not include development fixture behavior');

const demoAdapter = fs.readFileSync(demoAdapterPath, 'utf8');
assert.match(demoAdapter, /import\.meta\.env\.DEV/u,
  'development IPC adapter must remain explicitly gated to dev mode');
assert.match(demoAdapter, /function invokeDemo/u,
  'development IPC adapter must retain deterministic fixture behavior');

const productionPreviewData = fs.readFileSync(productionPreviewDataPath, 'utf8');
assert.match(productionPreviewData, /SAFE_SAMPLE_SOURCE_TEXT/u,
  'production preview data must retain the user-facing safe sample source');
assert.match(productionPreviewData, /PREVIEW_ACTION_BRIEF = null/u,
  'production preview data must replace the development result fixture with a null sentinel');
assert.match(productionPreviewData, /PREVIEW_CAPTURE = null/u,
  'production preview data must replace the development OCR fixture with a null sentinel');
assert.doesNotMatch(productionPreviewData,
  /action-brief\.v1|preview-university-services-email|verify-evisa-guidance|analysisProvenance/u,
  'production preview data must not ship the development result fixture');

const demoPreviewData = fs.readFileSync(demoPreviewDataPath, 'utf8');
assert.match(demoPreviewData, /const PREVIEW_ACTION_BRIEF = \{/u,
  'development preview data must retain the deterministic result fixture');
assert.match(demoPreviewData, /SAFE_SAMPLE_SOURCE_TEXT/u,
  'development preview data must share the production-safe sample source');
const safeSampleSource = fs.readFileSync(safeSampleSourcePath, 'utf8');
assert.match(safeSampleSource, /const SAFE_SAMPLE_SOURCE_TEXT = `Dear Student,/u,
  'the user-facing safe sample source must remain available in production');

const floatingPanelPath = path.join(rendererRoot, 'components', 'FloatingPanel.jsx');
const floatingPanelSource = fs.readFileSync(floatingPanelPath, 'utf8');
assert.match(floatingPanelSource, /from '@preview-data'/u,
  'the capture surface must use the build-selected preview-data boundary');
assert.doesNotMatch(floatingPanelSource, /from ['"][^'"]*utils\/previewData['"]/u,
  'the capture surface must not bypass the build-selected preview-data boundary');

const viteConfigSource = fs.readFileSync(viteConfigPath, 'utf8');
assert.match(viteConfigSource, /defineConfig\(\(\{ command \}\) =>/u,
  'Vite config must select the IPC adapter from its build command');
assert.match(viteConfigSource,
  /command === 'build' \? 'useIpc\.production\.js' : 'useIpc\.js'/u,
  'production builds must select the production IPC adapter');
assert.match(viteConfigSource,
  /command === 'build' \? 'previewData\.production\.js' : 'previewData\.js'/u,
  'production builds must select the fixture-free preview-data adapter');

const viteConfigFactory = require(viteConfigPath);
const serveConfig = viteConfigFactory({ command: 'serve', mode: 'development' });
const buildConfig = viteConfigFactory({ command: 'build', mode: 'production' });
assert.equal(serveConfig.resolve.alias['@renderer-ipc'], demoAdapterPath,
  'development serving must resolve the deterministic fixture adapter');
assert.equal(buildConfig.resolve.alias['@renderer-ipc'], productionAdapterPath,
  'production builds must resolve the fixture-free IPC adapter');
assert.equal(serveConfig.resolve.alias['@preview-data'], demoPreviewDataPath,
  'development serving must resolve the deterministic preview data');
assert.equal(buildConfig.resolve.alias['@preview-data'], productionPreviewDataPath,
  'production builds must resolve the fixture-free preview data');

console.log('Renderer IPC boundary checks passed.');
console.log(JSON.stringify({
  ipcConsumers: ipcConsumers.map((sourcePath) => path.relative(projectRoot, sourcePath)).sort(),
  productionAdapter: path.relative(projectRoot, productionAdapterPath),
  developmentAdapter: path.relative(projectRoot, demoAdapterPath),
  productionPreviewData: path.relative(projectRoot, productionPreviewDataPath),
  developmentPreviewData: path.relative(projectRoot, demoPreviewDataPath),
  safeSampleSource: path.relative(projectRoot, safeSampleSourcePath),
}, null, 2));
