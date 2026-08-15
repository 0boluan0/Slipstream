export class LazyWorkspaceLoadError extends Error {
  constructor(cause) {
    super('Lazy workspace load failed', { cause });
    this.name = 'LazyWorkspaceLoadError';
  }
}

export function isLazyWorkspaceLoadError(error) {
  return error instanceof LazyWorkspaceLoadError
    || error?.name === 'LazyWorkspaceLoadError';
}

export function createRetryableLazyImport(
  loaders,
) {
  if (
    !Array.isArray(loaders)
    || loaders.length === 0
    || loaders.some((loader) => typeof loader !== 'function')
  ) {
    throw new TypeError('One or more lazy workspace loaders are required');
  }

  let loaderIndex = 0;
  let cachedPromise = null;

  return Object.freeze({
    load() {
      if (!cachedPromise) {
        cachedPromise = Promise.resolve()
          .then(loaders[loaderIndex])
          .catch((error) => {
            if (isLazyWorkspaceLoadError(error)) throw error;
            throw new LazyWorkspaceLoadError(error);
          });
      }
      return cachedPromise;
    },

    reset() {
      if (loaderIndex >= loaders.length - 1) return false;
      loaderIndex += 1;
      cachedPromise = null;
      return true;
    },

    canRetry() {
      return loaderIndex < loaders.length - 1;
    },
  });
}

export function importRetryableWorkspaceAsset(fileName, attempt) {
  if (
    typeof fileName !== 'string'
    || !/^[A-Za-z][A-Za-z0-9-]*\.js$/u.test(fileName)
    || !Number.isSafeInteger(attempt)
    || attempt < 1
  ) {
    return Promise.reject(new TypeError('A safe workspace asset and retry attempt are required'));
  }

  const moduleUrl = new URL(fileName, import.meta.url);
  moduleUrl.searchParams.set('workspace-attempt', String(attempt));
  return import(/* @vite-ignore */ moduleUrl.href);
}
