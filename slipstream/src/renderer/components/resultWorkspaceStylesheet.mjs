const RESULT_STYLESHEET_FILE = 'ResultDisplay.css';
const RESULT_STYLESHEET_TIMEOUT_MS = 10000;
const MAX_RESULT_STYLESHEET_ATTEMPT = 1;
const RESULT_STYLESHEET_SELECTOR = 'link[data-workspace-stylesheet="result"]';

const activeAttempts = new WeakMap();

function parseAttempt(value) {
  if (value === null || value === '') return 0;
  if (!/^(?:0|1)$/u.test(value)) {
    throw new TypeError('A bounded Result stylesheet attempt is required');
  }
  return Number(value);
}

function isExactStylesheetAttempt(left, right) {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.href === rightUrl.href;
  } catch {
    return false;
  }
}

export function getResultStylesheetAttempt(moduleUrl) {
  if (typeof moduleUrl !== 'string' || moduleUrl.length === 0) {
    throw new TypeError('A Result module URL is required');
  }
  const parsed = new URL(moduleUrl);
  return parseAttempt(parsed.searchParams.get('workspace-attempt'));
}

export function buildResultStylesheetAttemptUrl(href, attempt, baseUrl) {
  if (
    typeof href !== 'string'
    || href.length === 0
    || !Number.isSafeInteger(attempt)
    || attempt < 0
    || attempt > MAX_RESULT_STYLESHEET_ATTEMPT
    || typeof baseUrl !== 'string'
    || baseUrl.length === 0
  ) {
    throw new TypeError('A safe Result stylesheet URL and bounded attempt are required');
  }

  const base = new URL(baseUrl);
  const stylesheet = new URL(href, base);
  const rendererDirectory = new URL('.', base);
  const sameBoundary = base.protocol === 'file:'
    ? stylesheet.protocol === 'file:'
      && stylesheet.host === base.host
      && stylesheet.pathname.startsWith(rendererDirectory.pathname)
    : stylesheet.protocol === base.protocol && stylesheet.origin === base.origin;
  if (
    !sameBoundary
    || !stylesheet.pathname.endsWith(`/${RESULT_STYLESHEET_FILE}`)
  ) {
    throw new TypeError('The Result stylesheet must stay inside the renderer boundary');
  }
  if (attempt === 0) stylesheet.searchParams.delete('workspace-attempt');
  else stylesheet.searchParams.set('workspace-attempt', String(attempt));
  return stylesheet.href;
}

function findReusableStylesheet(documentRef, requestedHref, attempt) {
  const candidates = [...documentRef.head.querySelectorAll(RESULT_STYLESHEET_SELECTOR)];
  const loaded = candidates.find((candidate) => (
    candidate.dataset.workspaceLoaded === 'true'
    && candidate.dataset.workspaceAttempt === String(attempt)
    && candidate.isConnected
    && isExactStylesheetAttempt(candidate.href, requestedHref)
  ));

  candidates.forEach((candidate) => {
    if (candidate !== loaded) candidate.remove();
  });
  return loaded || null;
}

export function loadResultWorkspaceStylesheet({
  attempt,
  documentRef = globalThis.document,
  href,
  timeoutMs = RESULT_STYLESHEET_TIMEOUT_MS,
} = {}) {
  if (
    !documentRef?.head
    || typeof documentRef.createElement !== 'function'
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
  ) {
    return Promise.reject(new TypeError('A renderer document and finite timeout are required'));
  }

  let requestedHref;
  try {
    requestedHref = buildResultStylesheetAttemptUrl(href, attempt, documentRef.baseURI);
  } catch (error) {
    return Promise.reject(error);
  }

  const current = activeAttempts.get(documentRef);
  if (
    current
    && !current.loaded
    && current.attempt === attempt
    && current.requestedHref === requestedHref
    && current.link?.isConnected
  ) return current.promise;
  current?.cancel?.();

  const reusable = findReusableStylesheet(documentRef, requestedHref, attempt);
  if (reusable) {
    const promise = Promise.resolve(reusable);
    activeAttempts.set(documentRef, Object.freeze({
      attempt,
      link: reusable,
      loaded: true,
      promise,
      requestedHref,
    }));
    return promise;
  }

  const link = documentRef.createElement('link');
  link.rel = 'stylesheet';
  link.href = requestedHref;
  link.dataset.workspaceStylesheet = 'result';
  link.dataset.workspaceAttempt = String(attempt);
  link.dataset.workspaceLoaded = 'false';

  const timerHost = documentRef.defaultView || globalThis;
  let settled = false;
  let resolveAttempt;
  let rejectAttempt;
  let timeoutId = null;
  const promise = new Promise((resolve, reject) => {
    resolveAttempt = resolve;
    rejectAttempt = reject;
  });
  const record = {
    attempt,
    link,
    loaded: false,
    promise,
    requestedHref,
    cancel() {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) timerHost.clearTimeout(timeoutId);
      link.onload = null;
      link.onerror = null;
      link.remove();
      rejectAttempt(new Error('Result stylesheet attempt was superseded'));
    },
  };

  const rejectCurrentAttempt = (message) => {
    if (settled || activeAttempts.get(documentRef) !== record) return;
    settled = true;
    if (timeoutId !== null) timerHost.clearTimeout(timeoutId);
    link.onload = null;
    link.onerror = null;
    link.remove();
    activeAttempts.delete(documentRef);
    rejectAttempt(new Error(message));
  };

  link.onload = () => {
    if (settled || activeAttempts.get(documentRef) !== record || !link.isConnected) return;
    settled = true;
    if (timeoutId !== null) timerHost.clearTimeout(timeoutId);
    link.onload = null;
    link.onerror = null;
    link.dataset.workspaceLoaded = 'true';
    record.loaded = true;
    resolveAttempt(link);
  };
  link.onerror = () => rejectCurrentAttempt('Result stylesheet failed to load');
  timeoutId = timerHost.setTimeout(() => {
    rejectCurrentAttempt('Result stylesheet load timed out');
  }, timeoutMs);

  activeAttempts.set(documentRef, record);
  documentRef.head.append(link);
  return promise;
}
