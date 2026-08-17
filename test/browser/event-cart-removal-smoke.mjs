import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax */

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

async function waitFor(expression, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error(`Timed out waiting for: ${expression}`);
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
await send('Page.navigate', { url: `${BASE_URL}/drafts/agents/event-ticket-test` });
await waitFor('document.readyState === "complete"');

await evaluate(`(async () => {
  const {
    createEventCartRemovalController,
    createEventItemRemoveAction,
    renderCancellationWarning,
  } = await import('/scripts/event-app/cart-removal.js');
  const { Icon, provider: UI } = await import('@dropins/tools/components.js');

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

  document.body.classList.add('appear');
  const main = document.querySelector('main');
  main.replaceChildren();
  const title = document.createElement('h1');
  title.textContent = 'Event cart removal verification';
  main.append(title);

  const reports = {};
  const payload = {
    commerce_cart_id: 'cart-id',
    commerce_sku: 'EVT-204186505',
    intent_ref: 'Opaque-Intent-Ref',
  };

  for (const surface of ['cart', 'mini-cart']) {
    const section = document.createElement('section');
    section.className = 'commerce-' + surface;
    const heading = document.createElement('h2');
    heading.textContent = surface;
    const actionHost = document.createElement('div');
    const warningHost = document.createElement('div');
    section.append(heading, actionHost, warningHost);
    main.append(section);

    const calls = [];
    let cancellationAttempt = 0;
    const controller = createEventCartRemovalController({
      cancelIntent: async (actualPayload) => {
        calls.push({ payload: actualPayload, type: 'cancel' });
        cancellationAttempt += 1;
        if (cancellationAttempt === 1) throw new Error('temporary failure');
      },
      fetchCartLines: async () => [{
        bookingIntentRef: payload.intent_ref,
        sku: payload.commerce_sku,
        uid: 'event-item',
      }],
      getCart: () => ({ id: payload.commerce_cart_id }),
      onCancellationError: ({ retry }) => {
        renderCancellationWarning(warningHost, {
          message: 'The event was removed, but its booking could not be cancelled.',
          retry,
          retryLabel: 'Retry cancellation',
        });
      },
      onCancellationSuccess: () => warningHost.replaceChildren(),
      removeItem: async () => {
        calls.push({ type: 'remove' });
      },
    });
    const slot = createEventItemRemoveAction({
      controller,
      label: 'Remove',
      renderIcon: (container) => UI.render(Icon, {
        'aria-hidden': 'true',
        size: '32',
        source: 'Trash',
      })(container),
    });
    const context = {
      handleItemsError() {},
      handleItemsLoading() {},
      item: {
        name: 'Case-sensitive event',
        productAttributes: [{ code: 'is_event_ticket', value: '1' }],
        uid: 'event-item',
      },
      replaceWith: (element) => actionHost.replaceChildren(element),
    };
    slot(context);
    reports[surface] = { calls, warningHost };
  }

  window.__removalReport = { payload, reports };
})()`);

await waitFor('document.querySelectorAll(".event-cart-item__remove svg").length === 2');
await evaluate(`document.querySelectorAll('.dropin-cart-item__remove')
  .forEach((button) => button.click())`);
await waitFor('document.querySelectorAll("[role=alert]").length === 2');
let report = await evaluate(`(() => {
  const entries = Object.fromEntries(Object.entries(window.__removalReport.reports)
    .map(([surface, value]) => [surface, {
      calls: value.calls,
      warning: value.warningHost.innerText.trim(),
    }]));
  return {
    documentWidth: document.documentElement.scrollWidth,
    entries,
    removeLabels: [...document.querySelectorAll('.dropin-cart-item__remove')]
      .map((button) => button.getAttribute('aria-label')),
    trashIcons: [...document.querySelectorAll('.event-cart-item__remove svg')]
      .map((icon) => ({
        ariaHidden: icon.getAttribute('aria-hidden'),
        height: icon.getAttribute('height'),
        width: icon.getAttribute('width'),
      })),
    viewportWidth: window.innerWidth,
  };
})()`);

for (const surface of ['cart', 'mini-cart']) {
  assert.deepEqual(report.entries[surface].calls, [
    { type: 'remove' },
    { payload: report.entries[surface].calls[1].payload, type: 'cancel' },
  ]);
  assert.deepEqual(
    report.entries[surface].calls[1].payload,
    {
      commerce_cart_id: 'cart-id',
      commerce_sku: 'EVT-204186505',
      intent_ref: 'Opaque-Intent-Ref',
    },
  );
  assert.match(report.entries[surface].warning, /Retry cancellation/);
}
assert.equal(report.removeLabels.every((label) => label === 'Remove Case-sensitive event'), true);
assert.deepEqual(report.trashIcons, [
  { ariaHidden: 'true', height: '32', width: '32' },
  { ariaHidden: 'true', height: '32', width: '32' },
]);
assert.equal(report.documentWidth <= report.viewportWidth, true);
await captureScreenshot('event-cart-removal-warning-desktop');

await evaluate(`(() => {
  document.querySelectorAll('[role=alert] button').forEach((button) => {
    button.focus();
    button.click();
  });
})()`);
await waitFor('document.querySelectorAll("[role=alert]").length === 0');
report = await evaluate(`Object.fromEntries(Object.entries(window.__removalReport.reports)
  .map(([surface, value]) => [surface, value.calls]))`);
for (const calls of Object.values(report)) {
  assert.equal(calls.filter((call) => call.type === 'remove').length, 1);
  assert.equal(calls.filter((call) => call.type === 'cancel').length, 2);
}

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
const mobile = await evaluate(`({
  documentWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
})`);
assert.equal(mobile.documentWidth <= mobile.viewportWidth, true);
await captureScreenshot('event-cart-removal-mobile');

const { nodes } = await send('Accessibility.getFullAXTree');
const buttons = nodes.filter((node) => node.role?.value === 'button');
assert.equal(buttons.some((node) => node.name?.value === 'Remove Case-sensitive event'), true);
assert.deepEqual(consoleErrors, []);
assert.deepEqual(pageExceptions, []);

console.log(JSON.stringify({ desktop: report, mobile, passed: true }, null, 2));
socket.close();
