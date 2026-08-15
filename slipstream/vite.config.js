const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react').default;
const path = require('path');

const LAZY_WORKSPACE_FIXTURE_RUN = 'lazy-workspace-recovery-native';
const RESULT_STYLESHEET_FIXTURE_RUN = 'result-stylesheet-recovery-native';
const SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN = 'settings-stylesheet-collision-native';
const SAVED_TERMS_FIXTURE_RUN = 'saved-terms-deferral-native';
const RESULT_STYLESHEET_FIXTURE_LOAD = 'result-style-fixture-primary';
const SETTINGS_STYLESHEET_FIXTURE_LOAD = 'settings-style-fixture-primary';
const LAZY_WORKSPACE_FIXTURE_LOADS = new Set([
  'settings-fixture-primary',
  'result-fixture-primary',
]);
const RESULT_STYLESHEET_FIXTURE_LOADS = new Set([
  RESULT_STYLESHEET_FIXTURE_LOAD,
  SETTINGS_STYLESHEET_FIXTURE_LOAD,
]);
const SAVED_TERMS_FIXTURE_LOAD = 'saved-terms-fixture-primary';
const SETTINGS_STYLESHEET_COLLISION_ARM_PATH = '/__slipstream-fixture__/settings-stylesheet-collision/arm';
const SETTINGS_STYLESHEET_COLLISION_RELEASE_PATH = '/__slipstream-fixture__/settings-stylesheet-collision/release';
const SETTINGS_STYLESHEET_COLLISION_STATE_PATH = '/__slipstream-fixture__/settings-stylesheet-collision/state';
const SETTINGS_STYLESHEET_COLLISION_WATCHDOG_MS = 12_000;
const SETTINGS_STYLESHEET_COLLISION_PREVIEW_WATCHDOG_MS = 40_000;
const WORKSPACE_FIXTURE_PATHS = Object.freeze({
  'settings-fixture-primary': '/components/SettingsPanel.jsx',
  'result-fixture-primary': '/components/ResultDisplay.jsx',
  [RESULT_STYLESHEET_FIXTURE_LOAD]: '/components/ResultDisplay.css',
  [SETTINGS_STYLESHEET_FIXTURE_LOAD]: '/components/SettingsPanel.css',
  [SAVED_TERMS_FIXTURE_LOAD]: '/components/SavedTermsLibrary.jsx',
});

function lazyWorkspaceFailureFixture() {
  const rejectedLoads = new Set();
  let activeFixtureRun = null;
  let settingsCollisionCheckMode = false;
  let settingsCollisionGate = null;
  let settingsCollisionStats = null;

  const resetSettingsCollisionGate = () => {
    if (settingsCollisionGate?.watchdog) clearTimeout(settingsCollisionGate.watchdog);
    if (settingsCollisionGate?.response && !settingsCollisionGate.response.writableEnded) {
      settingsCollisionGate.response.statusCode = 503;
      settingsCollisionGate.response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      settingsCollisionGate.response.end('Fixed Settings stylesheet collision fixture reset');
    }
    settingsCollisionGate = null;
    settingsCollisionStats = {
      armCount: 0,
      heldCount: 0,
      manualReleaseCount: 0,
      watchdogReleaseCount: 0,
      failureCount: 0,
    };
  };

  const releaseSettingsCollisionGate = (releaseKind) => {
    const held = settingsCollisionGate;
    if (!held?.response || held.response.writableEnded) return false;
    if (held.watchdog) clearTimeout(held.watchdog);
    settingsCollisionGate = null;
    if (releaseKind === 'manual') settingsCollisionStats.manualReleaseCount += 1;
    else settingsCollisionStats.watchdogReleaseCount += 1;
    settingsCollisionStats.failureCount += 1;
    held.response.statusCode = 503;
    held.response.setHeader('Cache-Control', 'no-store');
    held.response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    held.response.end('Fixed Settings stylesheet collision fixture failure');
    return true;
  };

  resetSettingsCollisionGate();

  return {
    name: 'slipstream-lazy-workspace-failure-fixture',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url) return next();

        const url = new URL(request.url, 'http://127.0.0.1');
        const fetchDestination = request.headers?.['sec-fetch-dest'];
        const isDocumentNavigation = fetchDestination == null
          || fetchDestination === 'document';
        if (
          url.pathname === '/'
          && isDocumentNavigation
          && url.searchParams.get('run') !== SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN
          && (
            activeFixtureRun === SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN
            || settingsCollisionGate
          )
        ) {
          settingsCollisionCheckMode = false;
          resetSettingsCollisionGate();
        }
        if (
          url.pathname === '/'
          && isDocumentNavigation
          && url.searchParams.get('run') === LAZY_WORKSPACE_FIXTURE_RUN
        ) {
          activeFixtureRun = LAZY_WORKSPACE_FIXTURE_RUN;
          rejectedLoads.clear();
          return next();
        }
        if (
          url.pathname === '/'
          && isDocumentNavigation
          && url.searchParams.get('run') === SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN
        ) {
          activeFixtureRun = SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN;
          settingsCollisionCheckMode = url.searchParams.get('fixture') === 'check';
          rejectedLoads.clear();
          resetSettingsCollisionGate();
          if (!settingsCollisionCheckMode) {
            settingsCollisionStats.armCount = 1;
            settingsCollisionGate = { armed: true, response: null, watchdog: null };
          }
          return next();
        }
        if (
          url.pathname === '/'
          && isDocumentNavigation
          && url.searchParams.get('run') === RESULT_STYLESHEET_FIXTURE_RUN
        ) {
          activeFixtureRun = RESULT_STYLESHEET_FIXTURE_RUN;
          rejectedLoads.clear();
          return next();
        }
        if (
          url.pathname === '/'
          && isDocumentNavigation
          && url.searchParams.get('run') === SAVED_TERMS_FIXTURE_RUN
        ) {
          activeFixtureRun = SAVED_TERMS_FIXTURE_RUN;
          rejectedLoads.clear();
          return next();
        }
        if (url.pathname === '/' && isDocumentNavigation) {
          activeFixtureRun = null;
          settingsCollisionCheckMode = false;
          rejectedLoads.clear();
          resetSettingsCollisionGate();
        }
        // A renderer isolation probe legitimately fetches `/` after navigation
        // with Sec-Fetch-Dest: empty. It must not cancel the active run between
        // the intentional Result and Settings failures.

        if (
          activeFixtureRun === SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN
          && request.method === 'GET'
          && url.search === ''
        ) {
          if (url.pathname === SETTINGS_STYLESHEET_COLLISION_ARM_PATH) {
            if (settingsCollisionStats.armCount !== 0 || settingsCollisionGate) {
              response.statusCode = 409;
              response.end('Settings stylesheet collision gate already armed');
              return undefined;
            }
            settingsCollisionStats.armCount += 1;
            settingsCollisionGate = { armed: true, response: null, watchdog: null };
            response.statusCode = 204;
            response.setHeader('Cache-Control', 'no-store');
            response.end();
            return undefined;
          }
          if (url.pathname === SETTINGS_STYLESHEET_COLLISION_RELEASE_PATH) {
            const released = releaseSettingsCollisionGate('manual');
            response.statusCode = released ? 204 : 409;
            response.setHeader('Cache-Control', 'no-store');
            if (released) response.end();
            else response.end('Settings stylesheet collision response is not held');
            return undefined;
          }
          if (url.pathname === SETTINGS_STYLESHEET_COLLISION_STATE_PATH) {
            response.statusCode = 200;
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({
              ...settingsCollisionStats,
              armed: settingsCollisionGate?.armed === true,
              held: Boolean(settingsCollisionGate?.response),
            }));
            return undefined;
          }
        }

        const workspaceLoad = url.searchParams.get('workspace-load');
        const runAllowsLoad = activeFixtureRun === LAZY_WORKSPACE_FIXTURE_RUN
          ? LAZY_WORKSPACE_FIXTURE_LOADS.has(workspaceLoad)
          : activeFixtureRun === RESULT_STYLESHEET_FIXTURE_RUN
            ? RESULT_STYLESHEET_FIXTURE_LOADS.has(workspaceLoad)
          : activeFixtureRun === SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN
            ? workspaceLoad === SETTINGS_STYLESHEET_FIXTURE_LOAD
          : activeFixtureRun === SAVED_TERMS_FIXTURE_RUN
            ? workspaceLoad === SAVED_TERMS_FIXTURE_LOAD
            : false;
        if (
          !runAllowsLoad
          || url.pathname !== WORKSPACE_FIXTURE_PATHS[workspaceLoad]
          || rejectedLoads.has(workspaceLoad)
        ) return next();

        rejectedLoads.add(workspaceLoad);
        if (activeFixtureRun === SETTINGS_STYLESHEET_COLLISION_FIXTURE_RUN) {
          if (!settingsCollisionGate?.armed || settingsCollisionGate.response) {
            response.statusCode = 500;
            response.end('Settings stylesheet collision gate was not armed exactly once');
            return undefined;
          }
          settingsCollisionStats.heldCount += 1;
          settingsCollisionGate.response = response;
          settingsCollisionGate.watchdog = setTimeout(() => {
            releaseSettingsCollisionGate('watchdog');
          }, settingsCollisionCheckMode
            ? SETTINGS_STYLESHEET_COLLISION_WATCHDOG_MS
            : SETTINGS_STYLESHEET_COLLISION_PREVIEW_WATCHDOG_MS);
          return undefined;
        }
        response.statusCode = 503;
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end('Fixed lazy workspace fixture failure');
        return undefined;
      });
    },
  };
}

module.exports = defineConfig(({ command }) => ({
  plugins: [lazyWorkspaceFailureFixture(), react()],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // A retryable workspace must be a closed resource: if Rolldown hoists
        // dependencies shared by multiple lazy workspaces into extra async
        // chunks, restoring the named workspace resource set is no longer
        // enough to recover it. Keep shared modules in their owning
        // entry/workspace so each workspace has a finite fetch boundary.
        codeSplitting: {
          groups: [{
            name: 'index',
            tags: ['$initial'],
            priority: 100,
            includeDependenciesRecursively: true,
          }],
        },
        chunkFileNames(chunk) {
          if (['ResultDisplay', 'SettingsPanel', 'SavedTermsLibrary'].includes(chunk.name)) {
            return 'assets/[name].js';
          }
          return 'assets/[name]-[hash].js';
        },
        assetFileNames(asset) {
          const originalNames = asset.originalFileNames || [];
          if (
            asset.name === 'ResultDisplay.css'
            || originalNames.some((name) => name.endsWith('/ResultDisplay.css'))
          ) return 'assets/ResultDisplay.css';
          if (
            asset.name === 'SettingsPanel.css'
            || originalNames.some((name) => name.endsWith('/SettingsPanel.css'))
          ) return 'assets/SettingsPanel.css';
          if (
            asset.name === 'SavedTermsLibrary.css'
            || originalNames.some((name) => name.endsWith('/SavedTermsLibrary.css'))
          ) return 'assets/SavedTermsLibrary.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@renderer-ipc': path.resolve(
        __dirname,
        'src/renderer/hooks',
        command === 'build' ? 'useIpc.production.js' : 'useIpc.js',
      ),
      '@preview-data': path.resolve(
        __dirname,
        'src/renderer/utils',
        command === 'build' ? 'previewData.production.js' : 'previewData.js',
      ),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
}));
