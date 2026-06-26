/**
 * Truncate text to maxChars, cutting at the nearest word boundary and
 * appending an ellipsis character.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function truncateText(text, maxChars) {
  if (typeof text !== 'string') {
    return '';
  }

  if (text.length <= maxChars) {
    return text;
  }

  // Find the last space at or before maxChars (word boundary)
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace === -1) {
    // No word boundary found — hard-cut at maxChars
    return truncated + '…';
  }

  return truncated.slice(0, lastSpace) + '…';
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * - < 60 s: "X.Xs" (one decimal place)
 * - >= 60 s: "Xm Ys" (whole seconds)
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatProcessingTime(ms) {
  if (typeof ms !== 'number' || ms < 0) {
    return '0.0s';
  }

  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    return totalSeconds.toFixed(1) + 's';
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}
