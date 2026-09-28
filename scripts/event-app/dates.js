export function formatEventDateRange(event, locale = document.documentElement.lang || 'en') {
  if (event.scheduleType === 'recurring' && event.recurrence?.startDate) {
    const formatCalendarDate = (value, time) => {
      const [year, month, day] = value.split('-').map(Number);
      const [hour, minute] = time.split(':').map(Number);
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        timeZone: 'UTC',
        year: 'numeric',
      }).format(new Date(Date.UTC(year, month - 1, day, hour, minute)));
    };
    const start = formatCalendarDate(
      event.recurrence.startDate,
      event.recurrence.dailyStartTime,
    );
    return event.recurrence.endDate
      ? `${start} – ${formatCalendarDate(
        event.recurrence.endDate,
        event.recurrence.dailyEndTime,
      )} (${event.timezone})`
      : `${start} (${event.timezone})`;
  }

  if (!event.startsAtUtc) return '';

  const options = {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: event.timezone,
    year: 'numeric',
  };
  const formatter = new Intl.DateTimeFormat(locale, options);
  const startsAt = new Date(event.startsAtUtc);
  if (!event.endsAtUtc) return `${formatter.format(startsAt)} (${event.timezone})`;

  const endsAt = new Date(event.endsAtUtc);
  return `${formatter.format(startsAt)} – ${formatter.format(endsAt)} (${event.timezone})`;
}
