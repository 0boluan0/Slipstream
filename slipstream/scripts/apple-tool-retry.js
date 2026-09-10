const { execFileSync } = require('node:child_process');

const TRANSIENT_NETWORK_ERROR = /The timestamp service is not available\.|HTTPClientError\.(?:connectTimeout|readTimeout)|NSURLErrorDomain Code=-(?:1001|1005|1009)|The network connection was lost/;
const CREDENTIAL_FLAGS = new Set(['--key', '--key-id', '--issuer', '--apple-id', '--password', '--team-id', '--keychain', '--keychain-profile']);

function resumeNotarization(args, output) {
  if (args[0] !== 'notarytool' || args[1] !== 'submit' || !output.includes('Successfully uploaded file')) return args;
  const id = output.match(/\bid:\s*([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/i)?.[1];
  if (!id) return args;
  const credentials = [];
  for (let index = 3; index < args.length; index += 1) {
    if (CREDENTIAL_FLAGS.has(args[index])) {
      credentials.push(args[index], args[index + 1]);
      index += 1;
    }
  }
  return ['notarytool', 'wait', id, ...credentials];
}

function runAppleTool(tool, args, options = {}, dependencies = {}) {
  const execute = dependencies.execute || execFileSync;
  const pause = dependencies.pause || ((milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds));
  const log = dependencies.log || ((message) => process.stdout.write(message));
  let currentArgs = [...args];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    log(`Apple ${currentArgs[0] || tool}: attempt ${attempt + 1}\n`);
    try {
      const output = execute(tool, currentArgs, { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (output) log(String(output));
      return;
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`;
      log(output);
      if (attempt === 3 || !TRANSIENT_NETWORK_ERROR.test(output)) {
        // Do not include the command line: another credential mode may put a password there.
        throw new Error(`Apple tool failed (${tool.split('/').pop()}); see output above`);
      }
      currentArgs = resumeNotarization(currentArgs, output);
      const delay = [3000, 10000, 20000][attempt];
      log(`Temporary Apple connection failure; retrying in ${delay / 1000}s.\n`);
      pause(delay);
    }
  }
}

module.exports = { runAppleTool };
