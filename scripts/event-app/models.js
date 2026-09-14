import {
  EVENT_APP_ERROR_TYPES,
  EventAppError,
} from './errors.js';

const EVENT_KEYS = Object.freeze([
  'age_requirement',
  'ends_at_utc',
  'event_id',
  'organizer',
  'recurrence',
  'schedule_type',
  'starts_at_utc',
  'tags',
  'timezone',
  'venue',
  'allocations',
]);
const BOOKING_KEYS = Object.freeze([
  'booking_ref',
  'order_increment_id',
  'status',
  'tickets',
]);
const TICKET_KEYS = Object.freeze([
  'qr_render_url',
  'status',
  'ticket_ref',
]);

const ISO_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6, 7]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function requireString(value, label) {
  if (!isNonEmptyString(value)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is missing`,
    );
  }
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return requireString(value, label);
}

function requireIsoDate(value, label) {
  const normalized = requireString(value, label);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }
  return normalized;
}

function requireCalendarDate(value, label) {
  const normalized = requireString(value, label);
  if (!DATE_PATTERN.test(normalized)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }
  return normalized;
}

function requireLocalTime(value, label) {
  const normalized = requireString(value, label);
  if (!TIME_PATTERN.test(normalized)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }
  return normalized;
}

function timeToMinutes(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function getIsoWeekday(value) {
  const [year, month, day] = value.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function requireTimeZone(value) {
  const timeZone = requireString(value, 'event.timezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
  } catch {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.timezone is invalid',
    );
  }
  return timeZone;
}

function normalizeVenueAddress(address) {
  if (
    !isPlainObject(address)
    || !hasOnlyKeys(address, ['city', 'country_code', 'lines'])
    || !Array.isArray(address.lines)
    || address.lines.length === 0
    || address.lines.some((line) => !isNonEmptyString(line))
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.venue.address is invalid',
    );
  }

  const lines = address.lines.map((line, index) => requireString(
    line,
    `event.venue.address.lines[${index}]`,
  ));
  const city = requireString(address.city, 'event.venue.address.city');
  const countryCode = requireString(
    address.country_code,
    'event.venue.address.country_code',
  );

  return Object.freeze({
    display: [...lines, city, countryCode].join(', '),
    city,
    countryCode,
    lines: Object.freeze(lines),
  });
}

function normalizeVenue(venue) {
  if (
    !isPlainObject(venue)
    || !hasOnlyKeys(venue, ['address', 'name', 'venue_id'])
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.venue is invalid',
    );
  }
  const address = normalizeVenueAddress(venue.address);
  return Object.freeze({
    address: address.display,
    addressLines: address.lines,
    city: address.city,
    countryCode: address.countryCode,
    id: requireString(venue.venue_id, 'event.venue.venue_id'),
    name: requireString(venue.name, 'event.venue.name'),
  });
}

function normalizeAllocationLocation(value, label, idKey) {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, ['name', idKey])
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }

  return Object.freeze({
    id: requireString(
      value[idKey],
      `${label}.id`,
    ),
    name: requireString(value.name, `${label}.name`),
  });
}

function normalizeRecurrence(value) {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, [
      'daily_end_time',
      'daily_start_time',
      'end_date',
      'excluded_dates',
      'session_duration_minutes',
      'start_date',
      'weekdays',
    ])
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence is invalid',
    );
  }

  const startDate = requireCalendarDate(value.start_date, 'event.recurrence.start_date');
  const endDate = requireCalendarDate(value.end_date, 'event.recurrence.end_date');
  if (startDate > endDate) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence date range is invalid',
    );
  }

  if (
    !Array.isArray(value.weekdays)
    || value.weekdays.length === 0
    || value.weekdays.some((weekday) => (
      !Number.isInteger(weekday) || !ISO_WEEKDAYS.has(weekday)
    ))
    || new Set(value.weekdays).size !== value.weekdays.length
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence.weekdays is invalid',
    );
  }

  const dailyStartTime = requireLocalTime(
    value.daily_start_time,
    'event.recurrence.daily_start_time',
  );
  const dailyEndTime = requireLocalTime(
    value.daily_end_time,
    'event.recurrence.daily_end_time',
  );
  if (timeToMinutes(dailyEndTime) <= timeToMinutes(dailyStartTime)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence daily hours are invalid',
    );
  }
  if (
    !Number.isInteger(value.session_duration_minutes)
    || value.session_duration_minutes < 1
    || value.session_duration_minutes > (
      timeToMinutes(dailyEndTime) - timeToMinutes(dailyStartTime)
    )
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence.session_duration_minutes is invalid',
    );
  }

  if (
    !Array.isArray(value.excluded_dates)
    || new Set(value.excluded_dates).size !== value.excluded_dates.length
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence.excluded_dates is invalid',
    );
  }
  const excludedDates = value.excluded_dates.map((date, index) => {
    const normalized = requireCalendarDate(
      date,
      `event.recurrence.excluded_dates[${index}]`,
    );
    if (normalized < startDate || normalized > endDate) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'event.recurrence.excluded_dates is invalid',
      );
    }
    return normalized;
  });

  return Object.freeze({
    dailyEndTime,
    dailyStartTime,
    endDate,
    excludedDates: Object.freeze(excludedDates),
    sessionDurationMinutes: value.session_duration_minutes,
    startDate,
    weekdays: Object.freeze([...value.weekdays]),
  });
}

function normalizeOccurrence(value, label) {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, [
      'available_quantity',
      'end_time',
      'ends_at_utc',
      'local_date',
      'occurrence_id',
      'start_time',
      'starts_at_utc',
      'timezone',
    ])
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }

  const availableQuantity = requireNonNegativeInteger(
    value.available_quantity,
    `${label}.available_quantity`,
  );
  const startsAtUtc = requireIsoDate(value.starts_at_utc, `${label}.starts_at_utc`);
  const endsAtUtc = requireIsoDate(value.ends_at_utc, `${label}.ends_at_utc`);
  const startTime = requireLocalTime(value.start_time, `${label}.start_time`);
  const endTime = requireLocalTime(value.end_time, `${label}.end_time`);
  if (Date.parse(startsAtUtc) >= Date.parse(endsAtUtc)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} interval is invalid`,
    );
  }
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} local interval is invalid`,
    );
  }

  return Object.freeze({
    availableQuantity,
    endTime,
    endsAtUtc,
    localDate: requireCalendarDate(value.local_date, `${label}.local_date`),
    occurrenceId: requireString(value.occurrence_id, `${label}.occurrence_id`),
    startTime,
    startsAtUtc,
    timezone: requireTimeZone(value.timezone),
  });
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      `${label} is invalid`,
    );
  }
  return value;
}

function normalizeAllocations(allocations) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.allocations is invalid',
    );
  }

  const allocationIds = new Set();
  const commerceSkus = new Set();
  return Object.freeze(allocations.map((allocation, index) => {
    if (
      !isPlainObject(allocation)
      || !hasOnlyKeys(allocation, [
        'allocated_capacity',
        'available_quantity',
        'commerce_sku',
        'event_allocation_id',
        'occurrences',
        'space',
        'zone',
      ])
    ) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        `event.allocations[${index}] is invalid`,
      );
    }

    const eventAllocationId = requireString(
      allocation.event_allocation_id,
      `event.allocations[${index}].event_allocation_id`,
    );
    const commerceSku = requireString(
      allocation.commerce_sku,
      `event.allocations[${index}].commerce_sku`,
    );
    if (allocationIds.has(eventAllocationId) || commerceSkus.has(commerceSku)) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'event.allocations contains duplicate identities',
      );
    }
    allocationIds.add(eventAllocationId);
    commerceSkus.add(commerceSku);

    const allocatedCapacity = requireNonNegativeInteger(
      allocation.allocated_capacity,
      `event.allocations[${index}].allocated_capacity`,
    );
    const availableQuantity = requireNonNegativeInteger(
      allocation.available_quantity,
      `event.allocations[${index}].available_quantity`,
    );
    if (availableQuantity > allocatedCapacity) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'event allocation availability is invalid',
      );
    }

    let occurrences;
    if (allocation.occurrences !== undefined) {
      if (!Array.isArray(allocation.occurrences)) {
        throw new EventAppError(
          EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
          `event.allocations[${index}].occurrences is invalid`,
        );
      }
      occurrences = Object.freeze(allocation.occurrences.map((occurrence, occurrenceIndex) => (
        normalizeOccurrence(
          occurrence,
          `event.allocations[${index}].occurrences[${occurrenceIndex}]`,
        )
      )));
      const occurrenceIds = new Set(occurrences.map((occurrence) => occurrence.occurrenceId));
      if (occurrenceIds.size !== occurrences.length) {
        throw new EventAppError(
          EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
          `event.allocations[${index}].occurrences contains duplicate identities`,
        );
      }
    }

    const zone = allocation.zone === undefined || allocation.zone === null
      ? null
      : normalizeAllocationLocation(
        allocation.zone,
        `event.allocations[${index}].zone`,
        'zone_id',
      );
    return Object.freeze({
      allocatedCapacity,
      availableQuantity,
      commerceSku,
      eventAllocationId,
      space: normalizeAllocationLocation(
        allocation.space,
        `event.allocations[${index}].space`,
        'space_id',
      ),
      zone,
      ...(occurrences ? { occurrences } : {}),
    });
  }));
}

function normalizeCommerceAttributeCode(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getCommerceAttributeValue(attribute) {
  if (
    attribute?.value !== undefined
    && attribute.value !== null
    && attribute.value !== ''
  ) {
    return attribute.value;
  }

  const selectedOptions = attribute?.selected_options ?? attribute?.selectedOptions;
  if (!Array.isArray(selectedOptions)) return undefined;

  const selectedValue = selectedOptions.find((option) => (
    option?.value !== undefined
    && option.value !== null
    && option.value !== ''
  ))?.value;
  if (selectedValue !== undefined) return selectedValue;

  return selectedOptions.find((option) => isNonEmptyString(option?.label))?.label;
}

export function getCommerceAttribute(product, code) {
  if (!Array.isArray(product?.attributes)) return undefined;
  const normalizedCode = normalizeCommerceAttributeCode(code);
  if (!normalizedCode) return undefined;
  const attribute = product.attributes.find((candidate) => (
    [candidate?.name, candidate?.id, candidate?.code]
      .some((identifier) => (
        normalizeCommerceAttributeCode(identifier) === normalizedCode
      ))
  ));
  return getCommerceAttributeValue(attribute);
}

export function isEventProduct(product) {
  const value = getCommerceAttribute(product, 'is_event_ticket');
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

export function getExternalEventId(product) {
  const value = getCommerceAttribute(product, 'external_event_id');
  return isNonEmptyString(value) ? value.trim() : null;
}

export function normalizePublicEvent(value, expectedEventId) {
  if (!isPlainObject(value) || !hasOnlyKeys(value, EVENT_KEYS)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Event response contains unexpected fields',
    );
  }

  const eventId = requireString(value.event_id, 'event.event_id');
  if (expectedEventId && eventId !== expectedEventId) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Event response identifier does not match the request',
    );
  }

  if (!Array.isArray(value.tags) || value.tags.some((tag) => !isNonEmptyString(tag))) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.tags is invalid',
    );
  }

  const scheduleType = value.schedule_type === undefined
    ? 'one_time'
    : requireString(value.schedule_type, 'event.schedule_type');
  if (!['one_time', 'recurring'].includes(scheduleType)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.schedule_type is invalid',
    );
  }
  const recurrence = value.recurrence === undefined
    ? null
    : normalizeRecurrence(value.recurrence);
  if (scheduleType === 'recurring' && !recurrence) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.recurrence is missing',
    );
  }

  const timezone = requireTimeZone(value.timezone);
  const allocations = normalizeAllocations(value.allocations);
  allocations.forEach((allocation) => {
    allocation.occurrences?.forEach((occurrence) => {
      if (scheduleType !== 'recurring') {
        throw new EventAppError(
          EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
          'One-time events cannot contain occurrences',
        );
      }
      if (
        occurrence.timezone !== timezone
        || occurrence.localDate < recurrence.startDate
        || occurrence.localDate > recurrence.endDate
        || recurrence.excludedDates.includes(occurrence.localDate)
        || !recurrence.weekdays.includes(getIsoWeekday(occurrence.localDate))
        || timeToMinutes(occurrence.startTime) < timeToMinutes(recurrence.dailyStartTime)
        || timeToMinutes(occurrence.endTime) > timeToMinutes(recurrence.dailyEndTime)
      ) {
        throw new EventAppError(
          EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
          'Event occurrence does not match the recurring schedule',
        );
      }
    });
  });

  return Object.freeze({
    ageRequirement: optionalString(value.age_requirement, 'event.age_requirement'),
    endsAtUtc: requireIsoDate(value.ends_at_utc, 'event.ends_at_utc'),
    eventId,
    organizer: optionalString(value.organizer, 'event.organizer'),
    recurrence,
    scheduleType,
    startsAtUtc: requireIsoDate(value.starts_at_utc, 'event.starts_at_utc'),
    tags: Object.freeze(value.tags.map((tag) => tag.trim())),
    timezone,
    venue: normalizeVenue(value.venue),
    allocations,
  });
}

export function normalizeEventMap(value, expectedIds) {
  if (!isPlainObject(value)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Event enrichment response is invalid',
    );
  }

  const expected = new Set(expectedIds);
  const normalized = new Map();
  Object.entries(value).forEach(([eventId, event]) => {
    if (!expected.has(eventId)) return;
    normalized.set(eventId, normalizePublicEvent(event, eventId));
  });
  return normalized;
}

export function normalizeIntentResponse(value) {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, ['intent_ref', 'status'])
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Booking intent response is invalid',
    );
  }
  return Object.freeze({
    intentRef: requireString(value.intent_ref, 'intent_ref'),
    status: requireString(value.status, 'status'),
  });
}

function normalizeQrUrl(value, allowedOrigins) {
  const rawUrl = requireString(value, 'ticket.qr_render_url');
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'ticket.qr_render_url is invalid',
    );
  }

  if (
    url.protocol !== 'https:'
    || !allowedOrigins.includes(url.origin)
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'ticket.qr_render_url origin is not approved',
    );
  }
  return rawUrl;
}

export function normalizePublicBooking(value, allowedOrigins) {
  if (
    !isPlainObject(value)
    || !hasOnlyKeys(value, BOOKING_KEYS)
    || !Array.isArray(value.tickets)
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Booking response contains unexpected fields',
    );
  }

  const tickets = value.tickets.map((ticket) => {
    if (!isPlainObject(ticket) || !hasOnlyKeys(ticket, TICKET_KEYS)) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'Ticket response contains unexpected fields',
      );
    }
    return Object.freeze({
      qrRenderUrl: normalizeQrUrl(ticket.qr_render_url, allowedOrigins),
      status: requireString(ticket.status, 'ticket.status'),
      ticketRef: requireString(ticket.ticket_ref, 'ticket.ticket_ref'),
    });
  });

  return Object.freeze({
    bookingRef: requireString(value.booking_ref, 'booking.booking_ref'),
    orderIncrementId: optionalString(
      value.order_increment_id,
      'booking.order_increment_id',
    ),
    status: requireString(value.status, 'booking.status'),
    tickets: Object.freeze(tickets),
  });
}
