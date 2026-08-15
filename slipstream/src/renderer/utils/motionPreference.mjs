export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function preferredScrollBehavior(matchMedia = undefined) {
  const mediaMatcher = matchMedia === undefined
    ? globalThis.matchMedia?.bind(globalThis)
    : matchMedia;

  if (typeof mediaMatcher !== 'function') return 'auto';

  try {
    const preference = mediaMatcher(REDUCED_MOTION_QUERY);
    if (typeof preference?.matches !== 'boolean') return 'auto';
    return preference.matches ? 'auto' : 'smooth';
  } catch {
    return 'auto';
  }
}
