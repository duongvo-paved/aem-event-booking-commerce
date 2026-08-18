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

function linkedLine(uid, intentRef = 'opaque-intent-ref') {
  return { bookingIntentRef: intentRef, quantity: 1, uid };
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
    sku: 'event-ticket-sku',
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

test('renders semantic status, warning, and definition-list content without sensitive data', () => {
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
    assert.equal(panel.children[0].tagName, 'h3');
    assert.equal(panel.children[1].attributes.get('role'), 'alert');
    assert.equal(panel.children.at(-1).tagName, 'dl');
    assert.match(panel.textContent, /Remove this item and book the event again/);
    assert.doesNotMatch(
      panel.textContent,
      /opaque-intent-ref|ada@example\.com|participant/i,
    );
  } finally {
    restoreDocument();
  }
});

test('renders confirmation guidance and a post-purchase support warning', () => {
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
    assert.match(linkedPanel.textContent, /emailed to the address used for this order/);
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

    assert.match(host.textContent, /Tickets2/);
    assert.doesNotMatch(host.textContent, /Tickets1/);
  } finally {
    restoreDocument();
  }
});
