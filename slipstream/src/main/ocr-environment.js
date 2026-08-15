const fs = require('fs');
const path = require('path');

const OCR_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const PRIVATE_DIRECTORY_MODE = 0o700;

function privateDirectoryError(label) {
  return new Error(`OCR private ${label} directory could not be secured`);
}

function ensurePrivateDirectory(directoryPath, label) {
  try {
    let entry;
    try {
      entry = fs.lstatSync(directoryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      fs.mkdirSync(directoryPath, { mode: PRIVATE_DIRECTORY_MODE });
      entry = fs.lstatSync(directoryPath);
    }

    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw privateDirectoryError(label);
    }

    const openFlags = fs.constants.O_RDONLY
      | fs.constants.O_DIRECTORY
      | fs.constants.O_NOFOLLOW;
    const descriptor = fs.openSync(directoryPath, openFlags);
    try {
      const opened = fs.fstatSync(descriptor);
      if (!opened.isDirectory()) throw privateDirectoryError(label);
      fs.fchmodSync(descriptor, PRIVATE_DIRECTORY_MODE);
      const secured = fs.fstatSync(descriptor);
      const current = fs.lstatSync(directoryPath);
      if (
        !current.isDirectory()
        || current.isSymbolicLink()
        || current.dev !== secured.dev
        || current.ino !== secured.ino
        || (secured.mode & 0o777) !== PRIVATE_DIRECTORY_MODE
      ) {
        throw privateDirectoryError(label);
      }
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    if (error?.message === `OCR private ${label} directory could not be secured`) throw error;
    throw privateDirectoryError(label);
  }

  return directoryPath;
}

function createOcrEnvironment(cacheDir) {
  if (
    typeof cacheDir !== 'string'
    || cacheDir.length === 0
    || cacheDir.includes('\0')
    || !path.isAbsolute(cacheDir)
  ) {
    throw new TypeError('OCR cache directory must be an absolute path');
  }

  const normalizedCacheDir = path.normalize(cacheDir);
  if (normalizedCacheDir === path.parse(normalizedCacheDir).root) {
    throw new TypeError('OCR cache directory must not be the filesystem root');
  }

  ensurePrivateDirectory(normalizedCacheDir, 'cache');
  const environmentRoot = ensurePrivateDirectory(
    path.join(normalizedCacheDir, '.environment'),
    'environment root',
  );
  const privateHome = ensurePrivateDirectory(path.join(environmentRoot, 'home'), 'home');
  const privateTemp = ensurePrivateDirectory(path.join(environmentRoot, 'tmp'), 'temporary');

  return Object.freeze({
    PATH: OCR_SYSTEM_PATH,
    SLIPSTREAM_OCR_CACHE: normalizedCacheDir,
    HOME: privateHome,
    CFFIXED_USER_HOME: privateHome,
    TMPDIR: privateTemp,
    TMP: privateTemp,
    TEMP: privateTemp,
  });
}

module.exports = {
  OCR_SYSTEM_PATH,
  createOcrEnvironment,
};
