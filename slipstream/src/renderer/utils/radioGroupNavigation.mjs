const PREVIOUS_KEYS = new Set(['ArrowLeft', 'ArrowUp']);
const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);

export function radioGroupTargetIndex(key, currentIndex, itemCount) {
  if (
    !Number.isInteger(currentIndex)
    || !Number.isInteger(itemCount)
    || itemCount < 1
    || currentIndex < 0
    || currentIndex >= itemCount
  ) return null;

  if (PREVIOUS_KEYS.has(key)) return (currentIndex - 1 + itemCount) % itemCount;
  if (NEXT_KEYS.has(key)) return (currentIndex + 1) % itemCount;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  return null;
}

export function authoritativeRadioTarget(target) {
  if (
    !target?.matches?.('[role="radio"]')
    || target.getAttribute?.('aria-checked') !== 'false'
    || Number(target.tabIndex) >= 0
  ) {
    return target;
  }

  const group = target.closest?.('[role="radiogroup"]');
  return group?.querySelector?.(
    '[role="radio"][aria-checked="true"]:not([disabled])'
  ) || target;
}
