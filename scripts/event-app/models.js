import {
  EVENT_APP_ERROR_TYPES,
  EventAppError,
} from './errors.js';

const EVENT_KEYS = Object.freeze([
  'age_requirement',
  'ends_at_utc',
  'event_id',
  'organizer',
  'starts_at_utc',
  'tags',
  'timezone',
  'venue',
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

function normalizeVenue(venue) {
  if (
    !isPlainObject(venue)
    || !hasOnlyKeys(venue, ['address', 'name'])
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'event.venue is invalid',
    );
  }
  return Object.freeze({
    address: requireString(venue.address, 'event.venue.address'),
    name: requireString(venue.name, 'event.venue.name'),
  });
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

  return Object.freeze({
    ageRequirement: optionalString(value.age_requirement, 'event.age_requirement'),
    endsAtUtc: requireIsoDate(value.ends_at_utc, 'event.ends_at_utc'),
    eventId,
    organizer: requireString(value.organizer, 'event.organizer'),
    startsAtUtc: requireIsoDate(value.starts_at_utc, 'event.starts_at_utc'),
    tags: Object.freeze(value.tags.map((tag) => tag.trim())),
    timezone: requireTimeZone(value.timezone),
    venue: normalizeVenue(value.venue),
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
