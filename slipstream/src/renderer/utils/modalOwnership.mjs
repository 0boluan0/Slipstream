export const APP_TOP_LAYER_SELECTOR = '[data-app-top-layer]';

export function hasActiveAppTopLayer(root = globalThis.document) {
  return Boolean(root?.querySelector?.(APP_TOP_LAYER_SELECTOR));
}

export function shouldHandleBackgroundEscape(event, root = globalThis.document) {
  return event?.key === 'Escape'
    && event.defaultPrevented !== true
    && !hasActiveAppTopLayer(root);
}
