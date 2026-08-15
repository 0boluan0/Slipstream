const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const {
  OCR_SYSTEM_PATH,
  createOcrEnvironment,
} = require('../src/main/ocr-environment');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'scripts', 'ocr-swift-runner.sh');
const servicePath = path.join(projectRoot, 'src', 'main', 'ocr-service.js');
const allowedEnvironmentKeys = [
  'CFFIXED_USER_HOME',
  'HOME',
  'PATH',
  'SLIPSTREAM_OCR_CACHE',
  'TEMP',
  'TMP',
  'TMPDIR',
];
const forbiddenEnvironmentKeys = [
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'DYLD_INSERT_LIBRARIES',
  'NODE_OPTIONS',
  'OPENAI_API_KEY',
  'SSH_AUTH_SOCK',
];
const parentEnvironmentKeys = [
  ...forbiddenEnvironmentKeys,
  'CFFIXED_USER_HOME',
  'HOME',
  'PATH',
  'TEMP',
  'TMP',
  'TMPDIR',
];

function createPrivateTestRoot(prefix) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(temporaryRoot, 0o700);
  return fs.realpathSync(temporaryRoot);
}

function assertPrivateRealDirectory(directoryPath, message) {
  const entry = fs.lstatSync(directoryPath);
  assert.equal(entry.isSymbolicLink(), false, `${message} must not be a symbolic link`);
  assert.equal(entry.isDirectory(), true, `${message} must be a directory`);
  assert.equal(entry.mode & 0o777, 0o700, `${message} must use mode 0700`);
}

async function withHostileParentEnvironment(temporaryRoot, callback) {
  const previous = new Map(parentEnvironmentKeys.map((key) => [key, process.env[key]]));
  const parentHome = path.join(temporaryRoot, 'parent-home-must-remain-unused');
  const parentTemp = path.join(temporaryRoot, 'parent-temp-must-remain-unused');
  fs.mkdirSync(parentHome, { mode: 0o700 });
  fs.mkdirSync(parentTemp, { mode: 0o700 });
  fs.writeFileSync(path.join(parentHome, 'sentinel'), 'unchanged', { mode: 0o600 });
  try {
    for (const key of forbiddenEnvironmentKeys) {
      process.env[key] = `private-parent-${key.toLowerCase()}`;
    }
    process.env.CFFIXED_USER_HOME = parentHome;
    process.env.HOME = parentHome;
    process.env.PATH = path.join(temporaryRoot, 'untrusted-bin');
    process.env.TMPDIR = parentTemp;
    process.env.TMP = parentTemp;
    process.env.TEMP = parentTemp;
    return await callback({ parentHome, parentTemp });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function expectedEnvironment(cacheDir) {
  const environmentRoot = path.join(cacheDir, '.environment');
  const privateHome = path.join(environmentRoot, 'home');
  const privateTemp = path.join(environmentRoot, 'tmp');
  return {
    PATH: OCR_SYSTEM_PATH,
    SLIPSTREAM_OCR_CACHE: cacheDir,
    HOME: privateHome,
    CFFIXED_USER_HOME: privateHome,
    TMPDIR: privateTemp,
    TMP: privateTemp,
    TEMP: privateTemp,
  };
}

function assertEnvironmentDirectories(environment) {
  assertPrivateRealDirectory(environment.SLIPSTREAM_OCR_CACHE, 'OCR cache');
  assertPrivateRealDirectory(path.dirname(environment.HOME), 'OCR environment root');
  assertPrivateRealDirectory(environment.HOME, 'OCR private HOME');
  assert.equal(environment.CFFIXED_USER_HOME, environment.HOME);
  assertPrivateRealDirectory(environment.TMPDIR, 'OCR private temp');
  assert.equal(environment.TMP, environment.TMPDIR);
  assert.equal(environment.TEMP, environment.TMPDIR);
}

async function checkEnvironmentFactory() {
  assert.equal(OCR_SYSTEM_PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  const temporaryRoot = createPrivateTestRoot('slipstream-ocr-factory-');
  const realUserHome = process.env.HOME;
  try {
    const profileRoot = path.join(temporaryRoot, 'profile');
    fs.mkdirSync(profileRoot, { mode: 0o700 });
    await withHostileParentEnvironment(temporaryRoot, async ({ parentHome, parentTemp }) => {
      const cacheDir = path.join(profileRoot, 'nested', '..', 'ocr-cache');
      const normalizedCacheDir = path.join(profileRoot, 'ocr-cache');
      const environment = createOcrEnvironment(cacheDir);
      assert.deepEqual(environment, expectedEnvironment(normalizedCacheDir));
      assert.equal(Object.isFrozen(environment), true);
      assert.deepEqual(Object.keys(environment).sort(), allowedEnvironmentKeys);
      assertEnvironmentDirectories(environment);
      assert.notEqual(environment.HOME, parentHome, 'OCR must replace inherited HOME');
      assert.notEqual(environment.TMPDIR, parentTemp, 'OCR must replace inherited temp paths');
      assert.notEqual(environment.HOME, realUserHome, 'OCR must not use the real user HOME');
      assert.deepEqual(fs.readdirSync(parentHome), ['sentinel'],
        'environment setup must not write into inherited HOME');
      for (const key of forbiddenEnvironmentKeys) {
        assert.equal(Object.prototype.hasOwnProperty.call(environment, key), false,
          `OCR subprocess must not inherit ${key}`);
      }

      const childEnvironment = spawnSync('/usr/bin/env', [], {
        encoding: 'utf8',
        env: environment,
      });
      assert.equal(childEnvironment.status, 0, childEnvironment.stderr);
      const observedKeys = childEnvironment.stdout.trim().split('\n')
        .filter(Boolean)
        .map((line) => line.slice(0, line.indexOf('=')))
        .sort();
      assert.deepEqual(observedKeys, allowedEnvironmentKeys,
        'a real child process must receive only the OCR environment allowlist');

      if (process.platform === 'darwin' && fs.existsSync('/usr/bin/swift')) {
        const foundationProbe = spawnSync('/usr/bin/swift', ['-e', [
          'import Foundation',
          'let environment = ProcessInfo.processInfo.environment',
          'let result = [',
          '  "home": environment["HOME"] ?? "",',
          '  "cfixedHome": environment["CFFIXED_USER_HOME"] ?? "",',
          '  "tmpdir": environment["TMPDIR"] ?? "",',
          '  "foundationHome": NSHomeDirectory(),',
          '  "fileManagerHome": FileManager.default.homeDirectoryForCurrentUser.path,',
          '  "foundationTemp": NSTemporaryDirectory(),',
          '  "fileManagerTemp": FileManager.default.temporaryDirectory.path',
          ']',
          'let data = try! JSONSerialization.data(withJSONObject: result)',
          'print(String(data: data, encoding: .utf8)!)',
        ].join('\n')], {
          encoding: 'utf8',
          env: environment,
          timeout: 30000,
        });
        assert.equal(foundationProbe.status, 0, foundationProbe.stderr);
        const observed = JSON.parse(foundationProbe.stdout.trim());
        assert.equal(observed.home, environment.HOME);
        assert.equal(observed.cfixedHome, environment.HOME);
        assert.equal(observed.tmpdir, environment.TMPDIR);
        assert.equal(fs.realpathSync(observed.foundationHome), fs.realpathSync(environment.HOME));
        assert.equal(fs.realpathSync(observed.fileManagerHome), fs.realpathSync(environment.HOME));
        // Current macOS Foundation can prefer its per-user Darwin temp root
        // over TMPDIR. Do not call that app-specific: validate the actual
        // directory Foundation reports is itself a real mode-0700 directory.
        assertPrivateRealDirectory(
          path.resolve(observed.foundationTemp),
          'Foundation user-private temp',
        );
        assertPrivateRealDirectory(
          path.resolve(observed.fileManagerTemp),
          'FileManager user-private temp',
        );
      }
    });

    const permissiveCache = path.join(temporaryRoot, 'permissive-cache');
    const permissiveRoot = path.join(permissiveCache, '.environment');
    const permissiveHome = path.join(permissiveRoot, 'home');
    const permissiveTemp = path.join(permissiveRoot, 'tmp');
    fs.mkdirSync(permissiveHome, { recursive: true, mode: 0o777 });
    fs.mkdirSync(permissiveTemp, { mode: 0o777 });
    for (const directoryPath of [permissiveCache, permissiveRoot, permissiveHome, permissiveTemp]) {
      fs.chmodSync(directoryPath, 0o777);
    }
    const correctedEnvironment = createOcrEnvironment(permissiveCache);
    assertEnvironmentDirectories(correctedEnvironment);

    assert.throws(() => createOcrEnvironment('relative/ocr-cache'), /absolute path/);
    assert.throws(() => createOcrEnvironment(''), /absolute path/);
    assert.throws(() => createOcrEnvironment(null), /absolute path/);
    assert.throws(() => createOcrEnvironment('/tmp/cache\0suffix'), /absolute path/);
    assert.throws(() => createOcrEnvironment(path.parse(temporaryRoot).root), /filesystem root/);

    const symlinkTarget = path.join(temporaryRoot, 'symlink-target');
    fs.mkdirSync(symlinkTarget, { mode: 0o700 });
    const cacheSymlink = path.join(temporaryRoot, 'cache-symlink');
    fs.symlinkSync(symlinkTarget, cacheSymlink, 'dir');
    assert.throws(() => createOcrEnvironment(cacheSymlink), /private cache/);

    const rootSymlinkCache = path.join(temporaryRoot, 'root-symlink-cache');
    fs.mkdirSync(rootSymlinkCache, { mode: 0o700 });
    fs.symlinkSync(symlinkTarget, path.join(rootSymlinkCache, '.environment'), 'dir');
    assert.throws(() => createOcrEnvironment(rootSymlinkCache), /private environment root/);

    const homeSymlinkCache = path.join(temporaryRoot, 'home-symlink-cache');
    const homeSymlinkRoot = path.join(homeSymlinkCache, '.environment');
    fs.mkdirSync(homeSymlinkRoot, { recursive: true, mode: 0o700 });
    fs.symlinkSync(symlinkTarget, path.join(homeSymlinkRoot, 'home'), 'dir');
    assert.throws(() => createOcrEnvironment(homeSymlinkCache), /private home/);

    const tempSymlinkCache = path.join(temporaryRoot, 'temp-symlink-cache');
    const tempSymlinkRoot = path.join(tempSymlinkCache, '.environment');
    fs.mkdirSync(path.join(tempSymlinkRoot, 'home'), { recursive: true, mode: 0o700 });
    fs.symlinkSync(symlinkTarget, path.join(tempSymlinkRoot, 'tmp'), 'dir');
    assert.throws(() => createOcrEnvironment(tempSymlinkCache), /private temporary/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function checkOcrServiceRuntime() {
  const temporaryRoot = createPrivateTestRoot('slipstream-ocr-service-');
  const profileRoot = path.join(temporaryRoot, 'profile');
  fs.mkdirSync(profileRoot, { mode: 0o700 });
  const originalLoad = Module._load;
  const modulePath = require.resolve('../src/main/ocr-service');
  let execution = null;

  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath: (name) => {
            assert.equal(name, 'userData');
            return profileRoot;
          },
        },
      };
    }
    if (request === 'child_process') {
      return {
        execFile: (file, args, options, callback) => {
          execution = { file, args, options };
          queueMicrotask(() => callback(null, JSON.stringify({
            text: 'fixture text',
            confidence: 0.9,
            blocks: [],
          }), ''));
          return { kill: () => true };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[modulePath];
  try {
    await withHostileParentEnvironment(temporaryRoot, async ({ parentHome }) => {
      const { performOCR } = require('../src/main/ocr-service');
      const result = await performOCR(path.join(temporaryRoot, 'fictional-ocr-fixture.png'));
      assert.equal(result.text, 'fixture text');
      assert.deepEqual(fs.readdirSync(parentHome), ['sentinel'],
        'formal OCR service must not write into inherited HOME');
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  assert(execution, 'OCR service did not launch its local runner');
  assert.equal(execution.file, '/bin/bash');
  assert.equal(path.isAbsolute(execution.args[0]), true);
  assert.equal(path.isAbsolute(execution.args[1]), true);
  assert.deepEqual(execution.options.env, expectedEnvironment(
    path.join(profileRoot, 'ocr-cache'),
  ), 'formal OCR service must use the shared private environment contract');
  assert.deepEqual(Object.keys(execution.options.env).sort(), allowedEnvironmentKeys);
}

function checkRunnerSource() {
  const runnerSource = fs.readFileSync(runnerPath, 'utf8');
  const serviceSource = fs.readFileSync(servicePath, 'utf8');
  const requiredAbsoluteCommands = [
    '/usr/bin/dirname',
    '/bin/pwd',
    '/bin/echo',
    '/bin/mkdir',
    '/bin/chmod',
    '/usr/bin/grep',
    '/bin/cat',
    '/usr/bin/swiftc',
  ];
  for (const command of requiredAbsoluteCommands) {
    assert(runnerSource.includes(command), `OCR runner must use absolute command ${command}`);
  }
  assert.match(runnerSource, /exec -- "\$BUNDLED_BINARY" "\$1"/,
    'packaged OCR binary must be executed by its absolute resolved path');
  assert.match(runnerSource, /exec -- "\$BINARY" "\$IMAGE_PATH"/,
    'development OCR binary must be executed by its absolute cache path');
  assert.match(runnerSource, /case "\$CACHE_DIR" in[\s\S]*?\/\*\) ;;[\s\S]*?OCR cache path must be absolute/,
    'runner must reject a relative cache path before creating it');
  assert.doesNotMatch(
    runnerSource,
    /(^|[|;&!(]\s*)(dirname|pwd|echo|mkdir|chmod|grep|cat|swiftc)(?=\s)/gm,
    'runner must not resolve external commands through inherited PATH',
  );
  assert.doesNotMatch(serviceSource, /\.\.\.process\.env|env:\s*process\.env/,
    'OCR service must not inherit the parent process environment');
  assert.match(serviceSource, /environment = createOcrEnvironment\(cacheDir\)/,
    'OCR service must prepare the shared private environment contract');
  assert.match(serviceSource, /env:\s*environment/,
    'OCR service must pass only the prepared private environment');
}

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, { encoding: 'utf8', mode: 0o700 });
  fs.chmodSync(filePath, 0o700);
}

function checkPathHijackResistance() {
  const temporaryRoot = createPrivateTestRoot('slipstream-ocr-path-');
  try {
    const fakeBin = path.join(temporaryRoot, 'fake-bin');
    const cacheDir = path.join(temporaryRoot, 'ocr-cache');
    const sentinel = path.join(temporaryRoot, 'path-hijack-ran');
    fs.mkdirSync(fakeBin, { mode: 0o700 });
    for (const command of ['dirname', 'pwd', 'echo', 'mkdir', 'chmod', 'grep', 'cat', 'swiftc']) {
      writeExecutable(path.join(fakeBin, command), [
        '#!/bin/sh',
        `/usr/bin/touch ${JSON.stringify(sentinel)}`,
        'exit 99',
        '',
      ].join('\n'));
    }

    const missingArgument = spawnSync('/bin/bash', [runnerPath], {
      encoding: 'utf8',
      env: {
        PATH: fakeBin,
        SLIPSTREAM_OCR_CACHE: cacheDir,
      },
    });
    assert.equal(missingArgument.status, 1);
    assert.match(missingArgument.stderr, /No image path provided/);
    assert.equal(fs.existsSync(sentinel), false,
      'a hostile PATH command must never be invoked by the OCR runner');

    const relativeCache = spawnSync('/bin/bash', [runnerPath, 'fictional-image.png'], {
      encoding: 'utf8',
      env: {
        PATH: fakeBin,
        SLIPSTREAM_OCR_CACHE: 'relative-cache',
      },
    });
    assert.equal(relativeCache.status, 1);
    assert.match(relativeCache.stderr, /OCR cache path must be absolute/);
    assert.equal(fs.existsSync(sentinel), false,
      'relative-cache rejection must not resolve any command through PATH');

    const packagedRoot = path.join(temporaryRoot, 'packaged scripts');
    const packagedRunner = path.join(packagedRoot, 'ocr-swift-runner.sh');
    const packagedBinary = path.join(packagedRoot, 'slipstream-ocr');
    fs.mkdirSync(packagedRoot, { mode: 0o700 });
    fs.copyFileSync(runnerPath, packagedRunner);
    fs.chmodSync(packagedRunner, 0o700);
    writeExecutable(packagedBinary, [
      '#!/bin/bash',
      '/usr/bin/printf "%s\\n%s\\n" "$#" "$1"',
      '',
    ].join('\n'));
    const hostileLookingImagePath = '-fictional image;not-a-command.png';
    const packagedRun = spawnSync('/bin/bash', [packagedRunner, hostileLookingImagePath], {
      encoding: 'utf8',
      env: {
        PATH: fakeBin,
        SLIPSTREAM_OCR_CACHE: cacheDir,
      },
    });
    assert.equal(packagedRun.status, 0, packagedRun.stderr);
    assert.equal(packagedRun.stdout, `1\n${hostileLookingImagePath}\n`,
      'packaged runner must pass the image path as one inert argument');
    assert.equal(fs.existsSync(sentinel), false,
      'packaged binary selection must remain independent of hostile PATH entries');
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  await checkEnvironmentFactory();
  checkRunnerSource();
  checkPathHijackResistance();
  await checkOcrServiceRuntime();
  console.log('OCR subprocess environment checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
