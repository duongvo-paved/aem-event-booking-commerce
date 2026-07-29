import { formatEventDateRange } from './dates.js';
import {
  getExternalEventId,
  isEventProduct,
} from './models.js';

const SURFACES = new Set(['cart', 'mini-cart']);
const inFlightRequests = new Map();
let headingSequence = 0;

const FALLBACK_LABELS = Object.freeze({
  attention: 'Booking needs attention',
  attentionMessage: 'Remove this item and book the event again.',
  date: 'Date and time',
  heading: 'Booking information',
  linked: 'Booking linked',
  organizer: 'Organizer',
  tickets: 'Tickets',
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
    date: getLabel(placeholders, 'EventDateLabel', FALLBACK_LABELS.date),
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
    organizer: getLabel(
      placeholders,
      'EventOrganizerLabel',
      FALLBACK_LABELS.organizer,
    ),
    tickets: getLabel(
      placeholders,
      'EventQuantityLabel',
      FALLBACK_LABELS.tickets,
    ),
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

function createSummary(item, correlationStatus, event) {
  const summary = {
    cartItemUid: item.uid,
    correlationStatus,
    quantity: item.quantity,
  };
  if (event) summary.event = event;
  return Object.freeze(summary);
}

function createUnavailableSummaries(items) {
  return items.map((item) => createSummary(item, 'unavailable'));
}

/**
 * Builds privacy-safe event booking summaries for the current Commerce cart.
 * Correlation values are used only to determine linked state and are discarded.
 */
export async function loadCartBookingSummaries({
  cartData,
  enrichEvents,
  fetchCartLines,
}) {
  const eventItems = getEventCartItems(cartData);
  if (!eventItems.length) return Object.freeze([]);

  let cartLines;
  try {
    cartLines = await fetchCartLines(cartData.id);
  } catch {
    return Object.freeze(createUnavailableSummaries(eventItems));
  }

  const linesByUid = new Map(
    cartLines
      .filter((line) => typeof line?.uid === 'string')
      .map((line) => [line.uid, line]),
  );
  const linkedItems = eventItems.filter(
    (item) => Boolean(linesByUid.get(item.uid)?.bookingIntentRef),
  );
  const eventIds = [...new Set(
    linkedItems
      .map((item) => getExternalEventId({ attributes: item.productAttributes }))
      .filter(Boolean),
  )];

  let eventsById = new Map();
  if (eventIds.length) {
    try {
      eventsById = await enrichEvents(eventIds);
    } catch {
      // Correlation is still valid when optional display enrichment is unavailable.
    }
  }

  return Object.freeze(eventItems.map((item) => {
    const line = linesByUid.get(item.uid);
    if (!line?.bookingIntentRef) return createSummary(item, 'missing');

    const eventId = getExternalEventId({ attributes: item.productAttributes });
    return createSummary(item, 'linked', eventsById.get(eventId));
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

export function getCartBookingPanelModel(
  summary,
  {
    labels = FALLBACK_LABELS,
    locale = 'en',
    surface = 'cart',
  } = {},
) {
  if (!SURFACES.has(surface)) throw new TypeError(`Unknown cart surface: ${surface}`);

  const rows = [];
  let message = labels.unavailable;
  let role = 'status';
  let description = null;

  if (summary.correlationStatus === 'linked') {
    message = labels.linked;
    if (summary.event) {
      rows.push([labels.date, formatEventDateRange(summary.event, locale)]);
      rows.push([labels.venue, summary.event.venue.name]);
      if (surface === 'cart') {
        rows.push([labels.organizer, summary.event.organizer]);
      }
    }
  } else if (summary.correlationStatus === 'missing') {
    message = labels.attention;
    description = labels.attentionMessage;
    role = 'alert';
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

export function renderCartBookingPanel(
  summary,
  {
    labels,
    locale,
    surface,
  },
) {
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
  section.append(status);

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
  if (!SURFACES.has(surface)) throw new TypeError(`Unknown cart surface: ${surface}`);

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
    if (summary) renderHost(host, summary);
    ctx.appendChild(host);
  }

  const subscription = eventBus.on('cart/data', handleCartData, { eager: true });
  return Object.freeze({
    destroy: () => subscription?.off(),
    handleCartData,
    ProductAttributes,
  });
}
