import { formatEventDateRange } from './dates.js';
import { readOccurrenceSnapshot } from './cart.js';
import {
  getExternalEventId,
  isEventProduct,
} from './models.js';

const PANEL_SURFACES = new Set(['cart', 'confirmation', 'mini-cart']);
const PRESENTER_SURFACES = new Set(['cart', 'mini-cart']);
const inFlightRequests = new Map();
let headingSequence = 0;

const FALLBACK_LABELS = Object.freeze({
  attention: 'Booking needs attention',
  attentionMessage: 'Remove this item and book the event again.',
  confirmationAttentionMessage:
    'Please contact support and provide your order number so we can check your booking.',
  confirmationMessage:
    'Your tickets are being prepared. A link to access them will be emailed to the address used for this order.',
  availableDates: 'Available dates',
  date: 'Date and time',
  duration: 'Session duration',
  heading: 'Booking information',
  linked: 'Booking linked',
  location: 'Location',
  organizer: 'Organizer',
  selectedDate: 'Selected date',
  selectedDateUnavailable: 'Not available for this cart item',
  schedule: 'Schedule',
  tickets: 'Tickets',
  time: 'Time',
  unavailable: 'Booking information temporarily unavailable',
  venue: 'Venue',
});

function getLabel(placeholders, key, fallback) {
  const value = placeholders?.Global?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function getCartBookingLabels(placeholders) {
  return Object.freeze({
    attention: getLabel(
      placeholders,
      'CartEventBookingAttention',
      FALLBACK_LABELS.attention,
    ),
    attentionMessage: getLabel(
      placeholders,
      'CartEventBookingAttentionMessage',
      FALLBACK_LABELS.attentionMessage,
    ),
    confirmationAttentionMessage: getLabel(
      placeholders,
      'OrderConfirmationEventBookingAttentionMessage',
      FALLBACK_LABELS.confirmationAttentionMessage,
    ),
    confirmationMessage: getLabel(
      placeholders,
      'OrderConfirmationEventBookingMessage',
      FALLBACK_LABELS.confirmationMessage,
    ),
    availableDates: getLabel(
      placeholders,
      'EventAvailableDatesLabel',
      FALLBACK_LABELS.availableDates,
    ),
    date: getLabel(placeholders, 'EventDateLabel', FALLBACK_LABELS.date),
    duration: getLabel(
      placeholders,
      'EventSessionDurationLabel',
      FALLBACK_LABELS.duration,
    ),
    heading: getLabel(
      placeholders,
      'CartEventBookingHeading',
      FALLBACK_LABELS.heading,
    ),
    linked: getLabel(
      placeholders,
      'CartEventBookingLinked',
      FALLBACK_LABELS.linked,
    ),
    location: getLabel(
      placeholders,
      'EventLocationLabel',
      FALLBACK_LABELS.location,
    ),
    organizer: getLabel(
      placeholders,
      'EventOrganizerLabel',
      FALLBACK_LABELS.organizer,
    ),
    selectedDate: getLabel(
      placeholders,
      'EventSelectedDateLabel',
      FALLBACK_LABELS.selectedDate,
    ),
    selectedDateUnavailable: getLabel(
      placeholders,
      'EventSelectedDateUnavailable',
      FALLBACK_LABELS.selectedDateUnavailable,
    ),
    schedule: getLabel(
      placeholders,
      'EventScheduleLabel',
      FALLBACK_LABELS.schedule,
    ),
    tickets: getLabel(
      placeholders,
      'EventQuantityLabel',
      FALLBACK_LABELS.tickets,
    ),
    time: getLabel(placeholders, 'EventTimeLabel', FALLBACK_LABELS.time),
    unavailable: getLabel(
      placeholders,
      'CartEventBookingUnavailable',
      FALLBACK_LABELS.unavailable,
    ),
    venue: getLabel(placeholders, 'EventVenueLabel', FALLBACK_LABELS.venue),
  });
}

function getEventCartItems(cartData) {
  if (!Array.isArray(cartData?.items)) return [];
  return cartData.items.filter((item) => (
    typeof item?.uid === 'string'
    && isEventProduct({ attributes: item.productAttributes })
  ));
}

export function getCartItemSignature(cartData) {
  return getEventCartItems(cartData)
    .map((item) => `${item.uid}:${item.quantity}`)
    .sort()
    .join('|');
}

function createSummary(item, correlationStatus, event, line) {
  const summary = {
    cartItemUid: item.uid,
    correlationStatus,
    quantity: item.quantity,
    sku: item.sku,
  };
  if (event) summary.event = event;
  const occurrence = line?.occurrence || readOccurrenceSnapshot(line?.custom_attributes);
  // Preserve the selected session even if event enrichment is still pending.
  // Confirmation may hydrate public event details later from the catalog.
  if (occurrence) summary.occurrence = occurrence;
  return Object.freeze(summary);
}

function createUnavailableSummaries(items) {
  return items.map((item) => createSummary(item, 'unavailable'));
}

export function createCheckoutBookingFallbackSummaries(cartData) {
  return Object.freeze(createUnavailableSummaries(getEventCartItems(cartData)));
}

/**
 * Builds privacy-safe event booking summaries for the current Commerce cart.
 * Correlation values are used only to determine linked state and are discarded.
 */
export async function loadCartBookingSummaries({
  cartData,
  enrichEvents,
  fetchCartLines,
  resolveEventId = (item) => getExternalEventId({ attributes: item.productAttributes }),
}) {
  const eventItems = getEventCartItems(cartData);
  if (!eventItems.length) return Object.freeze([]);

  const eventIdsByUid = new Map(await Promise.all(eventItems.map(async (item) => ([
    item.uid,
    await resolveEventId(item),
  ]))));
  const eventIds = [...new Set(
    [...eventIdsByUid.values()]
      .filter(Boolean),
  )];
  let eventsById = new Map();
  if (eventIds.length) {
    try {
      // Public event details are useful on confirmation even if Commerce no
      // longer exposes the cart line after order placement.
      eventsById = await enrichEvents(eventIds);
    } catch {
      // Keep confirmation rendering available when optional enrichment fails.
    }
  }

  let cartLines;
  try {
    cartLines = await fetchCartLines(cartData.id);
  } catch {
    return Object.freeze(eventItems.map((item) => {
      const eventId = eventIdsByUid.get(item.uid);
      return createSummary(item, 'unavailable', eventsById.get(eventId));
    }));
  }

  const linesByUid = new Map(
    cartLines
      .filter((line) => typeof line?.uid === 'string')
      .map((line) => [line.uid, line]),
  );
  return Object.freeze(eventItems.map((item) => {
    const line = linesByUid.get(item.uid);
    const eventId = eventIdsByUid.get(item.uid);
    if (!line?.bookingIntentRef) {
      return createSummary(item, 'missing', eventsById.get(eventId));
    }
    return createSummary(item, 'linked', eventsById.get(eventId), line);
  }));
}

function getSharedSummaries(key, loader) {
  const existing = inFlightRequests.get(key);
  if (existing) return existing;

  const request = Promise.resolve().then(loader);
  inFlightRequests.set(key, request);
  const clear = () => {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  };
  request.then(clear, clear);
  return request;
}

export function resetCartBookingRequestCache() {
  inFlightRequests.clear();
}

export function createCheckoutBookingSnapshot({
  enrichEvents,
  fetchCartLines,
  resolveEventId,
}) {
  let revision = 0;
  let summaries = Object.freeze([]);

  async function update(cartData) {
    revision += 1;
    const currentRevision = revision;
    summaries = createCheckoutBookingFallbackSummaries(cartData);

    if (!summaries.length || typeof cartData?.id !== 'string') return;

    try {
      const loadedSummaries = await loadCartBookingSummaries({
        cartData,
        enrichEvents,
        fetchCartLines,
        ...(resolveEventId ? { resolveEventId } : {}),
      });
      if (currentRevision === revision) summaries = loadedSummaries;
    } catch {
      // Keep the synchronous, privacy-safe fallback without blocking checkout.
    }
  }

  return Object.freeze({
    getSummaries: () => summaries,
    update,
  });
}

function isValidOccurrenceSnapshot(occurrence) {
  return Boolean(
    occurrence
    && typeof occurrence.occurrenceId === 'string'
    && occurrence.occurrenceId.trim()
    && typeof occurrence.localDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(occurrence.localDate)
    && typeof occurrence.startTime === 'string'
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(occurrence.startTime)
    && typeof occurrence.endTime === 'string'
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(occurrence.endTime)
    && typeof occurrence.timezone === 'string'
    && occurrence.timezone.trim(),
  );
}

function formatCalendarDate(date, locale) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(parsed);
}

function formatCalendarDateRange(startDate, endDate, locale) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDate} – ${endDate}`;
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
  if (typeof formatter.formatRange === 'function') {
    return formatter.formatRange(start, end);
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatLocalTimeRange(startTime, endTime, timezone) {
  return `${startTime} – ${endTime} (${timezone})`;
}

function getScheduleRows(event, occurrence, labels, locale) {
  if (event.scheduleType !== 'recurring') {
    return [[labels.date, formatEventDateRange(event, locale)]];
  }

  if (isValidOccurrenceSnapshot(occurrence)) {
    return [
      [labels.selectedDate, formatCalendarDate(occurrence.localDate, locale)],
      [
        labels.time,
        formatLocalTimeRange(
          occurrence.startTime,
          occurrence.endTime,
          occurrence.timezone,
        ),
      ],
    ];
  }

  if (!event.recurrence) return [[labels.date, formatEventDateRange(event, locale)]];
  return [
    [labels.selectedDate, labels.selectedDateUnavailable],
    [
      labels.schedule,
      formatCalendarDateRange(
        event.recurrence.startDate,
        event.recurrence.endDate,
        locale,
      ),
    ],
    [
      labels.time,
      formatLocalTimeRange(
        event.recurrence.dailyStartTime,
        event.recurrence.dailyEndTime,
        event.timezone,
      ),
    ],
    [labels.duration, `${event.recurrence.sessionDurationMinutes} minutes`],
  ];
}

export function getCartBookingPanelModel(
  summary,
  {
    labels = FALLBACK_LABELS,
    locale = 'en',
    surface = 'cart',
  } = {},
) {
  if (!PANEL_SURFACES.has(surface)) {
    throw new TypeError(`Unknown booking surface: ${surface}`);
  }

  const rows = [];
  let message = labels.unavailable;
  let role = 'status';
  let description = null;

  if (summary.correlationStatus === 'linked') {
    message = surface === 'confirmation'
      ? labels.confirmationMessage
      : labels.linked;
  } else if (summary.correlationStatus === 'missing') {
    message = labels.attention;
    description = surface === 'confirmation'
      ? labels.confirmationAttentionMessage
      : labels.attentionMessage;
    role = 'alert';
  } else if (surface === 'confirmation') {
    message = labels.confirmationMessage;
  }

  // Event date and venue are public event details. Keep them visible when
  // booking correlation is unavailable so a confirmation still identifies the
  // event the customer purchased.
  if (summary.event) {
    if (surface === 'confirmation') {
      const session = summary.event.scheduleType === 'recurring'
        && !isValidOccurrenceSnapshot(summary.occurrence)
        ? getScheduleRows(summary.event, summary.occurrence, labels, locale)
          .filter(([label]) => label !== labels.selectedDate && label !== labels.duration)
          .map(([, value]) => value)
          .join(' · ')
        : formatCartSession(summary, labels, locale);
      if (session) rows.push([labels.date, session]);
    } else {
      rows.push(...getScheduleRows(
        summary.event,
        summary.occurrence,
        labels,
        locale,
      ));
    }
    const { venue } = summary.event;
    if (surface === 'confirmation') {
      rows.push([labels.location, venue.address || venue.name]);
      if (venue.address && venue.name) rows.push([labels.venue, venue.name]);
    } else {
      rows.push([labels.venue, venue.name]);
    }
    if (surface !== 'confirmation' && surface !== 'mini-cart' && summary.event.organizer) {
      rows.push([labels.organizer, summary.event.organizer]);
    }
  }

  rows.push([labels.tickets, String(summary.quantity)]);
  return Object.freeze({
    description,
    heading: labels.heading,
    message,
    role,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  });
}

function appendDefinitionRow(list, label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  list.append(term, description);
}

function formatCartSession(summary, labels, locale) {
  const { event, occurrence } = summary;
  const recurring = event.scheduleType === 'recurring';
  if (recurring && !isValidOccurrenceSnapshot(occurrence)) {
    return `${labels.selectedDate}: ${labels.selectedDateUnavailable}`;
  }
  const timezone = recurring ? 'UTC' : event.timezone;
  const start = new Date(recurring
    ? `${occurrence.localDate}T${occurrence.startTime}:00Z` : event.startsAtUtc);
  const end = new Date(recurring
    ? `${occurrence.localDate}T${occurrence.endTime}:00Z` : event.endsAtUtc);
  if (Number.isNaN(start.getTime())) return labels.unavailable;
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone,
  });
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  });
  const formatTime = (value) => time.format(value).replace(/\s/g, '').toLowerCase();
  const sameDay = !Number.isNaN(end.getTime()) && date.format(start) === date.format(end);
  const endLabel = Number.isNaN(end.getTime()) ? ''
    : ` – ${sameDay ? '' : `${date.format(end)}, `}${formatTime(end)}`;
  return `${date.format(start)}, ${formatTime(start)}${endLabel}`;
}

function createCartDetailIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('aria-hidden', 'true');
  let paths;
  if (kind === 'date') {
    paths = ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M8 3v4M16 3v4M3 10h18'];
  } else if (kind === 'venue') {
    paths = ['M4 21h16 M6 21V3h12v18 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M10 21v-5h4v5'];
  } else {
    paths = ['M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Z', 'M14.2 11a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z'];
  }
  paths.forEach((value) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', value);
    svg.append(path);
  });
  return svg;
}

function renderCartRowDetails(summary, labels, locale, surface) {
  const section = document.createElement('section');
  section.className = `event-cart-booking event-cart-booking--${surface}`;
  section.setAttribute('aria-label', labels.heading);
  if (summary.correlationStatus === 'linked' && summary.event) {
    [
      ['date', formatCartSession(summary, labels, locale)],
      ['location', summary.event.venue.address],
      ['venue', summary.event.venue.name],
    ].forEach(([kind, value]) => {
      const row = document.createElement('p');
      row.className = `event-cart-booking__${kind}`;
      const text = document.createElement('span');
      text.textContent = value;
      row.append(createCartDetailIcon(kind), text);
      section.append(row);
    });
  } else if (summary.correlationStatus === 'missing') {
    const status = document.createElement('p');
    status.className = 'event-cart-booking__status';
    status.setAttribute('role', 'alert');
    status.setAttribute('aria-live', 'assertive');
    status.textContent = labels.attention;
    section.append(status);
    const description = document.createElement('p');
    description.className = 'event-cart-booking__description';
    description.textContent = labels.attentionMessage;
    section.append(description);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'event-cart-booking__placeholder';
    placeholder.setAttribute('role', 'status');
    placeholder.setAttribute('aria-label', labels.unavailable);
    for (let index = 0; index < 2; index += 1) {
      const line = document.createElement('span');
      line.setAttribute('aria-hidden', 'true');
      placeholder.append(line);
    }
    section.append(placeholder);
  }
  const tickets = document.createElement('p');
  tickets.className = 'event-cart-booking__tickets';
  tickets.textContent = `${summary.quantity} × ${labels.tickets}`;
  section.append(tickets);
  return section;
}

export function renderCartBookingPanel(
  summary,
  {
    labels,
    locale,
    surface,
  },
) {
  if (surface === 'cart' || surface === 'mini-cart') {
    return renderCartRowDetails(summary, labels || FALLBACK_LABELS, locale || 'en', surface);
  }
  const model = getCartBookingPanelModel(summary, { labels, locale, surface });
  const section = document.createElement('section');
  section.className = `event-cart-booking event-cart-booking--${surface}`;

  headingSequence += 1;
  const heading = document.createElement('h3');
  heading.id = `event-cart-booking-heading-${headingSequence}`;
  heading.textContent = model.heading;
  section.setAttribute('aria-labelledby', heading.id);
  section.append(heading);

  const status = document.createElement('p');
  status.className = 'event-cart-booking__status';
  status.setAttribute('role', model.role);
  status.setAttribute('aria-live', model.role === 'alert' ? 'assertive' : 'polite');
  status.textContent = model.message;
  if (surface !== 'confirmation' || model.role === 'alert') section.append(status);

  if (model.description) {
    const description = document.createElement('p');
    description.className = 'event-cart-booking__description';
    description.textContent = model.description;
    section.append(description);
  }

  const details = document.createElement('dl');
  model.rows.forEach(([label, value]) => appendDefinitionRow(details, label, value));
  section.append(details);
  return section;
}

export function createCartBookingPresenter({
  enrichEvents,
  eventBus,
  fetchCartLines,
  labels,
  locale = document.documentElement.lang || 'en',
  surface,
}) {
  if (!PRESENTER_SURFACES.has(surface)) {
    throw new TypeError(`Unknown cart surface: ${surface}`);
  }

  const hostsByUid = new Map();
  let currentRevision = 0;
  let summariesByUid = new Map();

  function renderHost(host, summary) {
    host.replaceChildren(renderCartBookingPanel(summary, {
      labels,
      locale,
      surface,
    }));
    host.hidden = false;
  }

  function updateConnectedHosts() {
    hostsByUid.forEach((hosts, uid) => {
      const summary = summariesByUid.get(uid);
      hosts.forEach((host) => {
        if (!host.isConnected) {
          hosts.delete(host);
        } else if (summary) {
          renderHost(host, summary);
        } else {
          host.replaceChildren();
          host.hidden = true;
        }
      });
      if (!hosts.size) hostsByUid.delete(uid);
    });
  }

  async function handleCartData(cartData) {
    currentRevision += 1;
    const revision = currentRevision;
    const eventItems = getEventCartItems(cartData);

    if (!eventItems.length || typeof cartData?.id !== 'string') {
      summariesByUid = new Map();
      updateConnectedHosts();
      return;
    }

    const signature = getCartItemSignature(cartData);
    const key = `${cartData.id}:${signature}`;
    const summaries = await getSharedSummaries(
      key,
      () => loadCartBookingSummaries({
        cartData,
        enrichEvents,
        fetchCartLines,
      }),
    );
    if (revision !== currentRevision) return;

    summariesByUid = new Map(
      summaries.map((summary) => [summary.cartItemUid, summary]),
    );
    updateConnectedHosts();
  }

  function ProductAttributes(ctx) {
    const { item } = ctx;
    if (
      typeof item?.uid !== 'string'
      || !isEventProduct({ attributes: item.productAttributes })
    ) return;

    const host = document.createElement('div');
    host.className = 'event-cart-booking-host';
    host.hidden = true;

    const hosts = hostsByUid.get(item.uid) || new Set();
    hosts.add(host);
    hostsByUid.set(item.uid, hosts);

    const summary = summariesByUid.get(item.uid);
    renderHost(host, summary || createSummary(item, 'unavailable'));
    ctx.appendChild(host);
  }

  const subscription = eventBus.on('cart/data', handleCartData, { eager: true });
  return Object.freeze({
    destroy: () => subscription?.off(),
    handleCartData,
    ProductAttributes,
  });
}
