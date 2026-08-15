'use strict';

const fs = require('node:fs');
const path = require('node:path');

const conflictCopySegmentPattern = / \d+(?=(?:\.[^./]+)?$)/u;

function canonicalizeConflictSegment(segment) {
  return segment.replace(conflictCopySegmentPattern, '');
}

function canonicalizeConflictPath(filePath) {
  return filePath
    .replaceAll('\\', '/')
    .split('/')
    .map(canonicalizeConflictSegment)
    .join('/');
}

function findFileProviderConflictCopies(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) return [];

  const conflicts = [];

  function visit(directory, relativeParts) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = [...relativeParts, entry.name].join('/');
      const canonicalName = canonicalizeConflictSegment(entry.name);

      if (canonicalName !== entry.name) {
        conflicts.push(relativePath);
        continue;
      }

      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        visit(entryPath, [...relativeParts, entry.name]);
      }
    }
  }

  visit(rootDirectory, []);
  return conflicts.sort();
}

function findFileProviderConflictCopiesInEntries(entries) {
  const normalizedEntries = entries
    .map((entry) => entry.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, ''))
    .filter(Boolean);
  const candidates = normalizedEntries
    .filter((entry) => canonicalizeConflictPath(entry) !== entry)
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
  const conflicts = [];

  for (const candidate of candidates) {
    if (conflicts.some((conflict) => candidate.startsWith(`${conflict}/`))) continue;
    conflicts.push(candidate);
  }

  return conflicts;
}

function formatConflictCopies(conflicts, limit = 8) {
  const visible = conflicts.slice(0, limit);
  const remaining = conflicts.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`;
}

module.exports = {
  canonicalizeConflictPath,
  canonicalizeConflictSegment,
  findFileProviderConflictCopies,
  findFileProviderConflictCopiesInEntries,
  formatConflictCopies,
};
