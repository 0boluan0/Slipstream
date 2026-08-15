const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDateOrdinal(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return Math.floor(parsed.getTime() / DAY_MS);
}

function localDateOrdinal(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return Math.floor(Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ) / DAY_MS);
}

export function getDeadlineDateOrdinal(deadline) {
  const calendarOrdinal = calendarDateOrdinal(deadline?.calendarDate);
  if (calendarOrdinal !== null) return calendarOrdinal;
  if (typeof deadline?.normalizedAt !== 'string') return null;
  const instant = new Date(deadline.normalizedAt);
  return localDateOrdinal(instant);
}

export function describeDeadlineUrgency(deadline, referenceNow = new Date()) {
  const todayOrdinal = localDateOrdinal(referenceNow);
  const targetOrdinal = getDeadlineDateOrdinal(deadline);
  if (todayOrdinal === null || targetOrdinal === null) return null;

  const daysRemaining = targetOrdinal - todayOrdinal;
  if (daysRemaining < 0) {
    const overdueDays = Math.abs(daysRemaining);
    return {
      tone: 'overdue',
      label: `已逾期 ${overdueDays} 天`,
      daysRemaining,
    };
  }
  if (daysRemaining === 0) return { tone: 'today', label: '今天截止', daysRemaining };
  if (daysRemaining === 1) return { tone: 'soon', label: '明天截止', daysRemaining };
  if (daysRemaining <= 7) {
    return { tone: 'soon', label: `还剩 ${daysRemaining} 天`, daysRemaining };
  }
  return { tone: 'neutral', label: `还有 ${daysRemaining} 天`, daysRemaining };
}

export function millisecondsUntilNextLocalDay(referenceNow = new Date()) {
  if (!(referenceNow instanceof Date) || Number.isNaN(referenceNow.getTime())) return 60_000;
  const nextDay = new Date(referenceNow);
  nextDay.setHours(24, 0, 1, 0);
  return Math.max(1_000, nextDay.getTime() - referenceNow.getTime());
}
