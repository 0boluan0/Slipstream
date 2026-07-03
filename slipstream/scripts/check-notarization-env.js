const required = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`missing notarization env: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('notarization environment check passed');
