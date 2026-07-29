import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/* eslint-disable no-console */

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = 'scratch/test-results';

const target = await fetch(`${DEVTOOLS_URL}/json/new?about:blank`, {
  method: 'PUT',
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const listeners = new Map();
let nextId = 1;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  (listeners.get(message.method) || []).forEach((listener) => listener(message.params));
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { reject, resolve });
  });
}

function on(method, handler) {
  listeners.set(method, [...(listeners.get(method) || []), handler]);
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description
      || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function captureScreenshot(name) {
  const { data } = await send('Page.captureScreenshot', {
    captureBeyondViewport: false,
    format: 'png',
  });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.writeFile(`${SCREENSHOT_DIR}/${name}.png`, Buffer.from(data, 'base64'));
}

const consoleErrors = [];
const pageExceptions = [];
on('Runtime.consoleAPICalled', (event) => {
  if (event.type === 'error') {
    consoleErrors.push(event.args.map((arg) => arg.value || arg.description).join(' '));
  }
});
on('Runtime.exceptionThrown', (event) => {
  pageExceptions.push(event.exceptionDetails.text);
});

await Promise.all([
  send('Page.enable'),
  send('Runtime.enable'),
  send('Accessibility.enable'),
]);
await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 1,
  height: 900,
  mobile: false,
  width: 1440,
});
await send('Page.navigate', {
  url: `${BASE_URL}/drafts/agents/event-ticket-test`,
});
await evaluate(`document.readyState === 'complete'
  ? true
  : new Promise((resolve) => window.addEventListener('load', resolve, { once: true }))`);
await evaluate('new Promise((resolve) => window.setTimeout(resolve, 1500))');
consoleErrors.length = 0;
pageExceptions.length = 0;

await evaluate(`(async () => {
  const {
    createCartBookingPresenter,
    getCartBookingLabels,
    renderCartBookingPanel,
  } = await import('/scripts/event-app/cart-display.js');

  const loadStyle = (href) => new Promise((resolve, reject) => {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    stylesheet.addEventListener('load', resolve, { once: true });
    stylesheet.addEventListener('error', reject, { once: true });
    document.head.append(stylesheet);
  });
  await Promise.all([
    loadStyle('/blocks/commerce-cart/commerce-cart.css'),
    loadStyle('/blocks/commerce-mini-cart/commerce-mini-cart.css'),
  ]);

  const labels = getCartBookingLabels({});
  const event = {
    endsAtUtc: '2026-08-20T11:00:00.000Z',
    eventId: 'event-1',
    organizer: 'Adobe Events',
    startsAtUtc: '2026-08-20T09:00:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    venue: { name: 'City Hall' },
  };
  const item = {
    productAttributes: [
      {
        code: 'Is Event Ticket',
        selected_options: [{ label: 'Yes', value: '1' }],
      },
      { code: 'External Event Id', value: 'event-1' },
    ],
    quantity: 2,
    uid: 'event-line',
  };
  const eventBus = { on: () => ({ off() {} }) };
  let commerceCalls = 0;
  let enrichmentCalls = 0;
  const dependencies = {
    enrichEvents: async () => {
      enrichmentCalls += 1;
      return new Map([['event-1', event]]);
    },
    eventBus,
    fetchCartLines: async () => {
      commerceCalls += 1;
      return [{
        bookingIntentRef: 'opaque-intent-must-not-render',
        uid: 'event-line',
      }];
    },
    labels,
  };

  const cartBlock = document.createElement('div');
  cartBlock.className = 'commerce-cart';
  const miniCartBlock = document.createElement('div');
  miniCartBlock.className = 'commerce-mini-cart';
  const stateBlock = document.createElement('div');
  stateBlock.className = 'commerce-cart';
  const title = document.createElement('h1');
  title.textContent = 'Cart booking presenter browser verification';
  const cartHeading = document.createElement('h2');
  cartHeading.textContent = 'Shopping cart';
  const miniHeading = document.createElement('h2');
  miniHeading.textContent = 'Mini-cart';
  const statesHeading = document.createElement('h2');
  statesHeading.textContent = 'Fallback states';
  document.body.classList.add('appear');
  document.querySelector('main').replaceChildren(
    title,
    cartHeading,
    cartBlock,
    miniHeading,
    miniCartBlock,
    statesHeading,
    stateBlock,
  );

  const cartPresenter = createCartBookingPresenter({
    ...dependencies,
    surface: 'cart',
  });
  const miniCartPresenter = createCartBookingPresenter({
    ...dependencies,
    surface: 'mini-cart',
  });
  cartPresenter.ProductAttributes({
    appendChild: (host) => cartBlock.append(host),
    item,
  });
  miniCartPresenter.ProductAttributes({
    appendChild: (host) => miniCartBlock.append(host),
    item,
  });

  let ordinaryProductAppended = false;
  cartPresenter.ProductAttributes({
    appendChild: () => {
      ordinaryProductAppended = true;
    },
    item: {
      productAttributes: [{ code: 'Is Event Ticket', value: 'No' }],
      quantity: 1,
      uid: 'ordinary-line',
    },
  });

  await Promise.all([
    cartPresenter.handleCartData({ id: 'cart-id', items: [item] }),
    miniCartPresenter.handleCartData({ id: 'cart-id', items: [item] }),
  ]);

  stateBlock.append(
    renderCartBookingPanel({
      cartItemUid: 'missing',
      correlationStatus: 'missing',
      quantity: 1,
    }, { labels, locale: 'en', surface: 'cart' }),
    renderCartBookingPanel({
      cartItemUid: 'unavailable',
      correlationStatus: 'unavailable',
      quantity: 3,
    }, { labels, locale: 'en', surface: 'cart' }),
  );

  window.__cartBookingReport = {
    commerceCalls,
    enrichmentCalls,
    ordinaryProductAppended,
  };
})()`);

const desktop = await evaluate(`({
  ...window.__cartBookingReport,
  alerts: [...document.querySelectorAll('[role="alert"]')]
    .map((element) => element.textContent.trim()),
  cartText: document.querySelector('.commerce-cart .event-cart-booking')
    ?.innerText.trim(),
  definitionLists: document.querySelectorAll('.event-cart-booking dl').length,
  documentWidth: document.documentElement.scrollWidth,
  headings: [...document.querySelectorAll('.event-cart-booking h3')]
    .map((element) => element.textContent.trim()),
  miniCartText: document.querySelector('.commerce-mini-cart .event-cart-booking')
    ?.innerText.trim(),
  statuses: [...document.querySelectorAll('[role="status"]')]
    .map((element) => element.textContent.trim()),
  viewportWidth: window.innerWidth,
})`);

assert.equal(desktop.commerceCalls, 1);
assert.equal(desktop.enrichmentCalls, 1);
assert.equal(desktop.ordinaryProductAppended, false);
assert.match(desktop.cartText, /Organizer/);
assert.doesNotMatch(desktop.miniCartText, /Organizer/);
assert.doesNotMatch(
  `${desktop.cartText}${desktop.miniCartText}`,
  /opaque-intent-must-not-render/,
);
assert.equal(desktop.documentWidth <= desktop.viewportWidth, true);
assert.equal(desktop.definitionLists, 4);
assert.equal(desktop.alerts.length, 1);
await captureScreenshot('cart-booking-display-desktop');

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
const mobile = await evaluate(`({
  documentWidth: document.documentElement.scrollWidth,
  panelWidths: [...document.querySelectorAll('.event-cart-booking')]
    .map((element) => element.getBoundingClientRect().width),
  viewportWidth: window.innerWidth,
})`);
assert.equal(mobile.documentWidth <= mobile.viewportWidth, true);
assert.equal(mobile.panelWidths.every((width) => width <= mobile.viewportWidth), true);
await captureScreenshot('cart-booking-display-mobile');

const { nodes } = await send('Accessibility.getFullAXTree');
const accessibility = nodes
  .filter((node) => ['alert', 'heading', 'status'].includes(node.role?.value))
  .map((node) => ({
    name: node.name?.value,
    role: node.role?.value,
  }));

assert.equal(pageExceptions.length, 0);
assert.equal(consoleErrors.length, 0);

console.log(JSON.stringify({
  accessibility,
  consoleErrors,
  desktop,
  mobile,
  pageExceptions,
}, null, 2));
socket.close();
