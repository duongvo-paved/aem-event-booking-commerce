export function formatEventDateRange(event, locale = document.documentElement.lang || 'en') {
  const options = {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: event.timezone,
    timeZoneName: 'short',
    year: 'numeric',
  };
  const formatter = new Intl.DateTimeFormat(locale, options);
  const startsAt = new Date(event.startsAtUtc);
  const endsAt = new Date(event.endsAtUtc);

  if (typeof formatter.formatRange === 'function') {
    return formatter.formatRange(startsAt, endsAt);
  }
  return `${formatter.format(startsAt)} – ${formatter.format(endsAt)}`;
}
