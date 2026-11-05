const DAY = 86400000;

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Resolve a wall-clock time only if it identifies exactly one instant (DST safe). */
export function localInstant(date, time, timezone) {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '') || !timezone) return null;
  const wall = Date.parse(`${date}T${time}:00Z`);
  try {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const wallAt = (instant) => {
      const parts = Object.fromEntries(formatter.formatToParts(instant)
        .map((part) => [part.type, part.value]));
      return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    };
    const offsets = new Set([-DAY, 0, DAY].map((delta) => wallAt(wall + delta) - wall - delta));
    const matches = [...offsets].map((offset) => wall - offset)
      .filter((instant) => wallAt(instant) === wall);
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function utcInstant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function escapeText(value) {
  return String(value || '').replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function timestamp(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// RFC 5545 folds at 75 octets, without splitting a UTF-8 character.
function fold(line) {
  const encoder = new TextEncoder();
  let result = '';
  let length = 0;
  Array.from(line).forEach((char) => {
    const size = encoder.encode(char).length;
    if (length + size > 75) {
      result += '\r\n ';
      length = 1;
    }
    result += char;
    length += size;
  });
  return result;
}

export function createCalendarContent({ event, occurrence, name }, now = new Date()) {
  if (!event || !name || !event.venue?.name) return null;
  let start;
  let end;
  if (event.scheduleType === 'recurring') {
    if (!occurrence) return null;
    start = localInstant(occurrence.localDate, occurrence.startTime, occurrence.timezone);
    let endDate = occurrence.localDate;
    if (validDate(endDate) && occurrence.endTime < occurrence.startTime) {
      endDate = new Date(Date.parse(`${endDate}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
    }
    end = localInstant(endDate, occurrence.endTime, occurrence.timezone);
  } else {
    start = utcInstant(event.startsAtUtc);
    end = utcInstant(event.endsAtUtc);
  }
  if (start === null || end === null || end <= start) return null;
  // Public event identity only. Never include booking references or attendee details.
  const identity = `${event.eventId || name}:${start}:${end}`;
  const hash = Array.from(identity).reduce(
    (value, char) => (value * 31 + char.codePointAt(0)) % 4294967291,
    0,
  );
  const location = [event.venue.name, event.venue.address].filter(Boolean).join(', ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Event Booking//Storefront//EN',
    'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${hash.toString(16)}-${start}@event-booking`,
    `DTSTAMP:${timestamp(now.getTime())}`, `DTSTART:${timestamp(start)}`, `DTEND:${timestamp(end)}`,
    `SUMMARY:${escapeText(name)}`, `LOCATION:${escapeText(location)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}

export function createCalendarButton(options, label = 'Add to calendar') {
  if (!createCalendarContent(options)) return null;
  const button = document.createElement('button');
  button.className = 'event-calendar-button';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    const content = createCalendarContent(options);
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'event.ics';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return button;
}
