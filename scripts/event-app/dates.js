/** Compact listing-card date, using the event's local calendar day. */
export function formatEventCardDate(event, locale = 'en') {
  const recurring = event.scheduleType === 'recurring' && event.recurrence?.startDate;
  if (!recurring && !event.startsAtUtc) return '';

  const timezone = recurring ? 'UTC' : event.timezone;
  const start = new Date(recurring
    ? `${event.recurrence.startDate}T00:00:00Z` : event.startsAtUtc);
  const endValue = recurring ? event.recurrence.endDate : event.endsAtUtc;
  const end = endValue ? new Date(recurring ? `${endValue}T00:00:00Z` : endValue) : null;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone,
  });
  const parts = (date) => Object.fromEntries(dateFormatter.formatToParts(date)
    .map((part) => [part.type, part.value]));
  const first = parts(start);
  const last = end ? parts(end) : null;
  const differentYear = last && first.year !== last.year;
  const dateLabel = (value) => {
    const year = differentYear ? ` ${value.year}` : '';
    return `${value.weekday} ${value.day} ${value.month}${year}`;
  };
  const differentDay = last && ['year', 'month', 'day'].some((key) => first[key] !== last[key]);
  if (differentDay) return `${dateLabel(first)} – ${dateLabel(last)}`;
  if (recurring) return dateLabel(first);

  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  });
  const time = (date) => timeFormatter.format(date).replace(/\s/g, '').toLowerCase();
  return `${dateLabel(first)}, ${time(start)}${end ? ` – ${time(end)}` : ''}`;
}

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

/** Readable PDP summary; timezone and full address remain in Event details. */
export function formatEventHeadlineDate(event, locale = 'en-AU') {
  const recurring = event.scheduleType === 'recurring' && event.recurrence?.startDate;
  if (!recurring && !event.startsAtUtc) return '';
  const timeZone = recurring ? 'UTC' : event.timezone;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone,
  });
  const dateLabel = (value) => {
    const parts = Object.fromEntries(dateFormatter.formatToParts(value)
      .map((part) => [part.type, part.value]));
    return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
  };
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  const timeLabel = (value) => timeFormatter.format(value).replace(/\s/g, '').toLowerCase();
  if (recurring) {
    const { recurrence } = event;
    const start = new Date(`${recurrence.startDate}T00:00:00Z`);
    const end = recurrence.endDate ? new Date(`${recurrence.endDate}T00:00:00Z`) : null;
    const dates = end && recurrence.endDate !== recurrence.startDate
      ? `${dateLabel(start)} – ${dateLabel(end)}` : dateLabel(start);
    if (!recurrence.dailyStartTime || !recurrence.dailyEndTime) return dates;
    const time = (value) => timeLabel(new Date(`2000-01-01T${value}:00Z`));
    return `${dates}, ${time(recurrence.dailyStartTime)} – ${time(recurrence.dailyEndTime)}`;
  }
  const start = new Date(event.startsAtUtc);
  if (!event.endsAtUtc) return `${dateLabel(start)}, ${timeLabel(start)}`;
  const end = new Date(event.endsAtUtc);
  const endDate = dateLabel(start) === dateLabel(end) ? '' : `${dateLabel(end)}, `;
  return `${dateLabel(start)}, ${timeLabel(start)} – ${endDate}${timeLabel(end)}`;
}
