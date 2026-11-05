/* global globalThis */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCartBookingPresenter,
  createCheckoutBookingFallbackSummaries,
  createCheckoutBookingSnapshot,
  getCartBookingLabels,
  getCartBookingPanelModel,
  loadCartBookingSummaries,
  renderCartBookingPanel,
  resetCartBookingRequestCache,
} from '../../scripts/event-app/cart-display.js';

const labels = getCartBookingLabels({});
const event = Object.freeze({
  endsAtUtc: '2026-08-20T11:00:00.000Z',
  eventId: 'event-1',
  organizer: 'Adobe Events',
  startsAtUtc: '2026-08-20T09:00:00.000Z',
  timezone: 'Asia/Ho_Chi_Minh',
  venue: { name: 'City Hall' },
});

const recurringEvent = Object.freeze({
  ...event,
  eventId: 'recurring-event',
  scheduleType: 'recurring',
  recurrence: {
    dailyEndTime: '18:00',
    dailyStartTime: '09:00',
    endDate: '2026-08-31',
    sessionDurationMinutes: 90,
    startDate: '2026-08-01',
  },
  timezone: 'Australia/Sydney',
});

const occurrence = Object.freeze({
  occurrenceId: 'occurrence-1',
  localDate: '2026-08-08',
  startTime: '10:00',
  endTime: '11:30',
  timezone: 'Australia/Sydney',
});

function attributes(eventId = 'event-1') {
  return [
    {
      code: 'Is Event Ticket',
      selected_options: [{ label: 'Yes', value: '1' }],
    },
    { code: 'External Event Id', value: eventId },
  ];
}

function cartItem(uid, quantity = 1, eventId = 'event-1') {
  return {
    productAttributes: attributes(eventId),
    quantity,
    sku: `sku-${uid}`,
    uid,
  };
}

function cartData(items) {
  return { id: 'cart-id', items };
}

function linkedLine(uid, intentRef = 'opaque-intent-ref', selectedOccurrence) {
  return {
    bookingIntentRef: intentRef,
    ...(selectedOccurrence ? { occurrence: selectedOccurrence } : {}),
    quantity: 1,
    uid,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeElement {
  constructor(tagName) {
    this.attributes = new Map();
    this.children = [];
    this.hidden = false;
    this.isConnected = false;
    this.tagName = tagName;
    this._textContent = '';
  }

  append(...children) {
    children.forEach((child) => {
      child.isConnected = this.isConnected;
      this.children.push(child);
    });
  }

  replaceChildren(...children) {
    this.children = [];
    this._textContent = '';
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  set textContent(value) {
    this.children = [];
    this._textContent = String(value);
  }

  get textContent() {
    return `${this._textContent}${this.children.map((child) => child.textContent).join('')}`;
  }
}

function installFakeDocument() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
    documentElement: { lang: 'en' },
  };
  return () => {
    globalThis.document = previous;
  };
}

function eventBusStub() {
  return {
    on: () => ({ off() {} }),
  };
}

test('joins correlation strictly by UID and ignores same-SKU or unrelated lines', async () => {
  const summaries = await loadCartBookingSummaries({
    cartData: cartData([
      cartItem('linked'),
      cartItem('missing'),
      {
        productAttributes: [{ code: 'Is Event Ticket', value: 'No' }],
        quantity: 5,
        uid: 'ordinary',
      },
    ]),
    enrichEvents: async () => new Map([['event-1', event]]),
    fetchCartLines: async () => [
      linkedLine('linked'),
      { ...linkedLine('different-uid'), sku: 'sku-missing' },
    ],
  });

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].cartItemUid, 'linked');
  assert.equal(summaries[0].correlationStatus, 'linked');
  assert.equal(summaries[1].cartItemUid, 'missing');
  assert.equal(summaries[1].correlationStatus, 'missing');
});

test('deduplicates event IDs into one batch enrichment request', async () => {
  const enrichmentCalls = [];
  const summaries = await loadCartBookingSummaries({
    cartData: cartData([
      cartItem('one', 1, 'same-event'),
      cartItem('two', 2, 'same-event'),
    ]),
    enrichEvents: async (eventIds) => {
      enrichmentCalls.push(eventIds);
      return new Map([['same-event', { ...event, eventId: 'same-event' }]]);
    },
    fetchCartLines: async () => [linkedLine('two'), linkedLine('one')],
  });

  assert.deepEqual(enrichmentCalls, [['same-event']]);
  assert.equal(summaries[0].event.eventId, 'same-event');
  assert.equal(summaries[1].event.eventId, 'same-event');
});

test('preserves the selected recurring occurrence in linked cart summaries', async () => {
  const summaries = await loadCartBookingSummaries({
    cartData: cartData([cartItem('recurring-line', 1, 'recurring-event')]),
    enrichEvents: async () => new Map([['recurring-event', recurringEvent]]),
    fetchCartLines: async () => [linkedLine('recurring-line', 'opaque-intent-ref', occurrence)],
  });

  assert.deepEqual(summaries[0].occurrence, occurrence);
  assert.doesNotMatch(JSON.stringify(summaries), /opaque-intent-ref/);
});

test('distinguishes failed correlation from failed optional enrichment', async () => {
  const unavailable = await loadCartBookingSummaries({
    cartData: cartData([cartItem('one', 3)]),
    enrichEvents: async () => {
      throw new Error('must not enrich');
    },
    fetchCartLines: async () => {
      throw new Error('Commerce unavailable');
    },
  });
  assert.deepEqual(unavailable, [{
    cartItemUid: 'one',
    correlationStatus: 'unavailable',
    quantity: 3,
    sku: 'sku-one',
  }]);

  const linked = await loadCartBookingSummaries({
    cartData: cartData([cartItem('one', 3)]),
    enrichEvents: async () => {
      throw new Error('Event App unavailable');
    },
    fetchCartLines: async () => [linkedLine('one')],
  });
  assert.deepEqual(linked, [{
    cartItemUid: 'one',
    correlationStatus: 'linked',
    quantity: 3,
    sku: 'sku-one',
  }]);
});

test('builds cart, mini-cart, and confirmation panel models', () => {
  const summary = {
    cartItemUid: 'one',
    correlationStatus: 'linked',
    event,
    quantity: 2,
  };
  const full = getCartBookingPanelModel(summary, {
    labels,
    locale: 'en',
    surface: 'cart',
  });
  const compact = getCartBookingPanelModel(summary, {
    labels,
    locale: 'en',
    surface: 'mini-cart',
  });
  const confirmation = getCartBookingPanelModel(summary, {
    labels,
    locale: 'en',
    surface: 'confirmation',
  });

  assert.equal(full.rows.some(([label]) => label === 'Organizer'), true);
  assert.equal(compact.rows.some(([label]) => label === 'Organizer'), false);
  assert.equal(confirmation.rows.some(([label]) => label === 'Organizer'), true);
  assert.deepEqual(full.rows.at(-1), ['Tickets', '2']);
  assert.deepEqual(compact.rows.at(-1), ['Tickets', '2']);
  assert.match(confirmation.message, /emailed to the address used for this order/);
});

test('shows the selected date and time for recurring cart items', () => {
  const summary = {
    cartItemUid: 'recurring-line',
    correlationStatus: 'linked',
    event: recurringEvent,
    occurrence,
    quantity: 1,
  };

  const cartPanel = getCartBookingPanelModel(summary, {
    labels,
    locale: 'en-AU',
    surface: 'cart',
  });
  const miniCartPanel = getCartBookingPanelModel(summary, {
    labels,
    locale: 'en-AU',
    surface: 'mini-cart',
  });

  assert.deepEqual(cartPanel.rows.slice(0, 3), [
    ['Selected date', '8 Aug 2026'],
    ['Time', '10:00 – 11:30 (Australia/Sydney)'],
    ['Venue', 'City Hall'],
  ]);
  assert.deepEqual(miniCartPanel.rows.slice(0, 2), [
    ['Selected date', '8 Aug 2026'],
    ['Time', '10:00 – 11:30 (Australia/Sydney)'],
  ]);
});

test('falls back to recurring schedule details for legacy cart lines', () => {
  const panel = getCartBookingPanelModel({
    cartItemUid: 'legacy-recurring-line',
    correlationStatus: 'linked',
    event: recurringEvent,
    quantity: 1,
  }, {
    labels,
    locale: 'en-AU',
    surface: 'cart',
  });

  assert.deepEqual(panel.rows.slice(0, 3), [
    ['Selected date', 'Not available for this cart item'],
    ['Schedule', '1–31 Aug 2026'],
    ['Time', '09:00 – 18:00 (Australia/Sydney)'],
  ]);
});

test('confirmation combines the selected session and uses the venue address, not organizer', () => {
  const panel = getCartBookingPanelModel({
    correlationStatus: 'linked',
    event: {
      ...recurringEvent,
      organizer: 'Different organizer',
      venue: { name: 'City Hall', address: '1 Main Street, Sydney, AU' },
    },
    occurrence,
    quantity: 1,
  }, { labels, locale: 'en-AU', surface: 'confirmation' });

  assert.equal(panel.rows[0][0], labels.date);
  assert.match(panel.rows[0][1], /8 Aug 2026, 10:00am – 11:30am$/);
  assert.doesNotMatch(panel.rows[0][1], /Australia\/Sydney/);
  assert.equal(panel.rows.some(([label]) => label === labels.time), false);
  assert.deepEqual(panel.rows[1], ['Venue', 'City Hall, 1 Main Street, Sydney, AU']);
  assert.deepEqual(panel.rows[2], ['Organizer', 'Different organizer']);
});

test('omits organizer rows when event enrichment has no organizer', () => {
  const summary = {
    cartItemUid: 'one',
    correlationStatus: 'linked',
    event: { ...event, organizer: null },
    quantity: 2,
  };

  const panel = getCartBookingPanelModel(summary, {
    labels,
    surface: 'cart',
  });

  assert.equal(panel.rows.some(([label]) => label === 'Organizer'), false);
});

test('creates immediate checkout fallbacks without sensitive correlation data', () => {
  const summaries = createCheckoutBookingFallbackSummaries(cartData([
    { ...cartItem('one', 2), topLevelSku: 'event-ticket-sku' },
    {
      productAttributes: [{ code: 'Is Event Ticket', value: 'No' }],
      quantity: 4,
      sku: 'ordinary-sku',
      uid: 'ordinary',
    },
  ]));

  assert.deepEqual(summaries, [{
    cartItemUid: 'one',
    correlationStatus: 'unavailable',
    quantity: 2,
    sku: 'sku-one',
  }]);
  assert.doesNotMatch(JSON.stringify(summaries), /opaque-intent|participant|contact/i);
});

test('checkout snapshot enriches in the background and ignores stale responses', async () => {
  const firstRequest = deferred();
  const secondRequest = deferred();
  let call = 0;
  const snapshot = createCheckoutBookingSnapshot({
    enrichEvents: async () => new Map([['event-1', event]]),
    fetchCartLines: async () => {
      call += 1;
      return call === 1 ? firstRequest.promise : secondRequest.promise;
    },
  });

  const firstUpdate = snapshot.update(cartData([cartItem('one', 1)]));
  assert.equal(snapshot.getSummaries()[0].correlationStatus, 'unavailable');

  const secondUpdate = snapshot.update(cartData([cartItem('one', 3)]));
  secondRequest.resolve([linkedLine('one')]);
  await secondUpdate;
  assert.equal(snapshot.getSummaries()[0].quantity, 3);
  assert.equal(snapshot.getSummaries()[0].correlationStatus, 'linked');

  firstRequest.resolve([linkedLine('one')]);
  await firstUpdate;
  assert.equal(snapshot.getSummaries()[0].quantity, 3);
});

test('renders cart warnings and ticket counts without sensitive data', () => {
  const restoreDocument = installFakeDocument();
  try {
    const panel = renderCartBookingPanel({
      cartItemUid: 'one',
      correlationStatus: 'missing',
      quantity: 1,
    }, {
      labels,
      locale: 'en',
      surface: 'cart',
    });

    assert.equal(panel.tagName, 'section');
    assert.equal(panel.attributes.get('aria-label'), 'Booking information');
    assert.equal(panel.children[0].attributes.get('role'), 'alert');
    assert.equal(panel.children.at(-1).textContent, '1 × Tickets');
    assert.match(panel.textContent, /Remove this item and book the event again/);
    assert.doesNotMatch(
      panel.textContent,
      /opaque-intent-ref|ada@example\.com|participant/i,
    );
  } finally {
    restoreDocument();
  }
});

test('renders compact cart details using the event timezone without booking status or PII', () => {
  const restoreDocument = installFakeDocument();
  try {
    const panel = renderCartBookingPanel({
      correlationStatus: 'linked', event, quantity: 2,
    }, { labels, locale: 'en-AU', surface: 'cart' });
    assert.match(panel.textContent, /Thu,? 20 Aug 2026, 4:00pm – 6:00pm/);
    assert.match(panel.textContent, /City Hall/);
    assert.match(panel.textContent, /2 × Tickets/);
    assert.doesNotMatch(panel.textContent, /Booking linked|Organizer|Adobe Events/);
    assert.equal(panel.children[0].children[0].attributes.get('aria-hidden'), 'true');
  } finally {
    restoreDocument();
  }
});

test('cart rows use the selected session and never substitute the recurrence range', () => {
  const restoreDocument = installFakeDocument();
  try {
    const render = (selectedOccurrence) => renderCartBookingPanel({
      correlationStatus: 'linked', event: recurringEvent, occurrence: selectedOccurrence, quantity: 1,
    }, { labels, locale: 'en-AU', surface: 'cart' });
    const selected = render(occurrence);
    const legacy = render();
    assert.match(selected.textContent, /Sat,? 8 Aug 2026, 10:00am – 11:30am/);
    assert.match(legacy.textContent, /Selected date: Not available for this cart item/);
    assert.doesNotMatch(legacy.textContent, /31 Aug|09:00|18:00/);
  } finally {
    restoreDocument();
  }
});

test('linked cart rows without enrichment show an accessible placeholder', () => {
  const restoreDocument = installFakeDocument();
  try {
    const panel = renderCartBookingPanel({ correlationStatus: 'linked', quantity: 3 }, {
      labels, locale: 'en-AU', surface: 'cart',
    });
    assert.doesNotMatch(panel.textContent, /Booking information temporarily unavailable/);
    assert.match(panel.textContent, /3 × Tickets/);
    assert.equal(panel.children[0].attributes.get('role'), 'status');
    assert.equal(panel.children[0].attributes.get('aria-label'), labels.unavailable);
    assert.equal(panel.children[0].children.length, 2);
  } finally {
    restoreDocument();
  }
});

test('mini-cart uses the same compact details, placeholders, and warnings as the cart', () => {
  const restoreDocument = installFakeDocument();
  try {
    const summaries = [
      { correlationStatus: 'linked', event, quantity: 2 },
      { correlationStatus: 'linked', event: recurringEvent, occurrence, quantity: 1 },
      { correlationStatus: 'linked', event: recurringEvent, quantity: 1 },
      { correlationStatus: 'unavailable', quantity: 3 },
      { correlationStatus: 'missing', quantity: 1 },
    ];
    summaries.forEach((summary) => {
      const cart = renderCartBookingPanel(summary, { labels, locale: 'en-AU', surface: 'cart' });
      const mini = renderCartBookingPanel(summary, { labels, locale: 'en-AU', surface: 'mini-cart' });
      assert.equal(mini.textContent, cart.textContent);
      assert.equal(mini.className, 'event-cart-booking event-cart-booking--mini-cart');
    });
  } finally {
    restoreDocument();
  }
});

test('omits confirmation preparation copy while retaining post-purchase support warnings', () => {
  const restoreDocument = installFakeDocument();
  try {
    const linkedPanel = renderCartBookingPanel({
      cartItemUid: 'one',
      correlationStatus: 'linked',
      event,
      quantity: 2,
      sku: 'event-sku',
    }, {
      labels,
      locale: 'en',
      surface: 'confirmation',
    });
    const missingPanel = renderCartBookingPanel({
      cartItemUid: 'two',
      correlationStatus: 'missing',
      quantity: 1,
      sku: 'event-sku-2',
    }, {
      labels,
      locale: 'en',
      surface: 'confirmation',
    });

    assert.match(linkedPanel.textContent, /City Hall/);
    assert.match(linkedPanel.textContent, /Adobe Events/);
    assert.doesNotMatch(linkedPanel.textContent, /being prepared|emailed to the address used for this order/);
    assert.equal(missingPanel.children[1].attributes.get('role'), 'alert');
    assert.match(missingPanel.textContent, /contact support and provide your order number/);
    assert.doesNotMatch(
      `${linkedPanel.textContent}${missingPanel.textContent}`,
      /opaque-intent|participant|contact@example/i,
    );
  } finally {
    restoreDocument();
  }
});

test('shares concurrent Commerce and enrichment requests across both presenters', async () => {
  resetCartBookingRequestCache();
  const restoreDocument = installFakeDocument();
  let commerceCalls = 0;
  let enrichmentCalls = 0;
  const input = cartData([cartItem('one')]);
  const dependencies = {
    enrichEvents: async () => {
      enrichmentCalls += 1;
      return new Map([['event-1', event]]);
    },
    eventBus: eventBusStub(),
    fetchCartLines: async () => {
      commerceCalls += 1;
      return [linkedLine('one')];
    },
    labels,
  };

  try {
    const cart = createCartBookingPresenter({ ...dependencies, surface: 'cart' });
    const miniCart = createCartBookingPresenter({
      ...dependencies,
      surface: 'mini-cart',
    });
    await Promise.all([
      cart.handleCartData(input),
      miniCart.handleCartData(input),
    ]);

    assert.equal(commerceCalls, 1);
    assert.equal(enrichmentCalls, 1);
  } finally {
    restoreDocument();
  }
});

test('ignores a stale async response after a newer cart state', async () => {
  resetCartBookingRequestCache();
  const restoreDocument = installFakeDocument();
  const oldRequest = deferred();
  const newRequest = deferred();
  let call = 0;
  const presenter = createCartBookingPresenter({
    enrichEvents: async () => new Map([['event-1', event]]),
    eventBus: eventBusStub(),
    fetchCartLines: async () => {
      call += 1;
      return call === 1 ? oldRequest.promise : newRequest.promise;
    },
    labels,
    surface: 'cart',
  });
  let host;
  presenter.ProductAttributes({
    appendChild: (element) => {
      host = element;
      host.isConnected = true;
    },
    item: cartItem('one'),
  });

  try {
    const oldUpdate = presenter.handleCartData(cartData([cartItem('one', 1)]));
    const newUpdate = presenter.handleCartData(cartData([cartItem('one', 2)]));
    newRequest.resolve([linkedLine('one')]);
    await newUpdate;
    oldRequest.resolve([linkedLine('one')]);
    await oldUpdate;

    assert.match(host.textContent, /2 × Tickets/);
    assert.doesNotMatch(host.textContent, /1 × Tickets/);
  } finally {
    restoreDocument();
  }
});
