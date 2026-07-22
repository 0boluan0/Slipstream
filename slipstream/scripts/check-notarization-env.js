const credentialSets = [
  ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'],
  ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'],
];

const available = credentialSets.find((keys) => keys.every((key) => Boolean(process.env[key])));
if (!available) {
  const choices = credentialSets.map((keys) => keys.join(' + ')).join(' OR ');
  console.error(`missing notarization credentials; provide ${choices}`);
  process.exit(1);
}

console.log(`notarization environment check passed (${available.join(', ')})`);
