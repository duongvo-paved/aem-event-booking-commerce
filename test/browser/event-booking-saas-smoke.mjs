import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

/* eslint-disable no-await-in-loop, no-console */

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = 'scratch/test-results';

const target = await fetch(`${DEVTOOLS_URL}/json/new?about:blank`, {
  method: 'PUT',
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function send(method, params = {}) {
  const id = nextId;
  nextId += 1;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { reject, resolve });
  });
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
await waitFor('document.readyState === "complete"');

await evaluate(`(async () => {
  const [{ renderEventBooking }, { EventAppError, EVENT_APP_ERROR_TYPES }] =
    await Promise.all([
      import('/blocks/product-details/event-booking.js'),
      import('/scripts/event-app/errors.js'),
    ]);

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/blocks/product-details/product-details.css';
  document.head.append(stylesheet);

  const container = document.createElement('div');
  container.className = 'product-details__event-booking';
  document.body.classList.add('appear');
  document.querySelector('main').replaceChildren(container);

  const event = {
    ageRequirement: '18+',
    endsAtUtc: '2026-08-01T04:00:00.000Z',
    organizer: 'Event Demo',
    startsAtUtc: '2026-08-01T02:00:00.000Z',
    tags: ['conference'],
    timezone: 'Australia/Sydney',
    venue: {
      address: '1 Market Street, Sydney',
      name: 'Demo Hall',
    },
  };
  const product = {
    name: 'SaaS Event Ticket',
    prices: {
      final: {
        amount: 49,
        currency: 'USD',
      },
    },
  };

  const fill = () => {
    document.querySelector('[name="contact-firstName"]').value = 'Ada';
    document.querySelector('[name="contact-lastName"]').value = 'Lovelace';
    document.querySelector('[name="contact-email"]').value = 'ada@example.test';
    document.querySelector('[name="participant-0-firstName"]').value = 'Ada';
    document.querySelector('[name="participant-0-lastName"]').value = 'Lovelace';
    document.querySelector('[name="consent"]').checked = true;
  };

  window.__bookingTest = {
    duplicateCalls: [],
    event,
    fill,
    product,
    renderEventBooking,
    retryCalls: [],
  };

  renderEventBooking({
    addToCart: async ({ pendingSubmission }) => {
      window.__bookingTest.duplicateCalls.push({
        sourceRequestId: pendingSubmission.sourceRequestId,
      });
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.DUPLICATE,
        'Duplicate booking',
      );
    },
    cartUrl: '/cart',
    container,
    event,
    labels: {},
    product,
  });
  fill();
  document.querySelector('.event-booking__form').requestSubmit();
})()`);

await waitFor('window.__bookingTest.duplicateCalls.length === 1');
await waitFor('Boolean(document.querySelector(".event-booking__feedback a"))');

const report = {
  duplicate: await evaluate(`({
    callCount: window.__bookingTest.duplicateCalls.length,
    emailRetained:
      document.querySelector('[name="contact-email"]').value === 'ada@example.test',
    feedback: document.querySelector('.event-booking__feedback').innerText.trim(),
    linkHref: document.querySelector('.event-booking__feedback a')
      ?.getAttribute('href'),
    linkText: document.querySelector('.event-booking__feedback a')
      ?.innerText.trim(),
    liveMode: document.querySelector('.event-booking__feedback')
      ?.getAttribute('aria-live'),
    statusRole: document.querySelector('.event-booking__feedback')
      ?.getAttribute('role'),
  })`),
};
await captureScreenshot('event-booking-saas-duplicate-desktop');

await evaluate(`(() => {
  const {
    event,
    fill,
    product,
    renderEventBooking,
  } = window.__bookingTest;
  const container = document.querySelector('.product-details__event-booking');
  let attempt = 0;

  renderEventBooking({
    addToCart: async ({ pendingSubmission }) => {
      window.__bookingTest.retryCalls.push({
        sourceRequestId: pendingSubmission.sourceRequestId,
      });
      attempt += 1;
      if (attempt === 1) {
        const error = new Error('Temporary network failure');
        error.type = 'network';
        error.retryable = true;
        throw error;
      }
      return 'intent-ref-1';
    },
    cartUrl: '/cart',
    container,
    event,
    labels: {},
    product,
  });
  fill();
  document.querySelector('.event-booking__form').requestSubmit();
})()`);
await waitFor('window.__bookingTest.retryCalls.length === 1');
await waitFor(`document.querySelector('.event-booking__feedback')
  .innerText.includes('temporarily unavailable')`);

report.retryFailure = await evaluate(`({
  emailRetained:
    document.querySelector('[name="contact-email"]').value === 'ada@example.test',
  feedback: document.querySelector('.event-booking__feedback').innerText.trim(),
})`);

await evaluate(
  'document.querySelector(\'.event-booking__form\').requestSubmit()',
);
await waitFor('window.__bookingTest.retryCalls.length === 2');
await waitFor(`document.querySelector('.event-booking__feedback')
  .innerText.includes('added to your cart')`);

report.retrySuccess = await evaluate(`({
  callCount: window.__bookingTest.retryCalls.length,
  feedback: document.querySelector('.event-booking__feedback').innerText.trim(),
  formCleared: document.querySelector('[name="contact-email"]').value === '',
  sourceRequestIdReused:
    window.__bookingTest.retryCalls[0].sourceRequestId
      === window.__bookingTest.retryCalls[1].sourceRequestId,
})`);

await evaluate(`(async () => {
  const container = document.createElement('div');
  container.className = 'product-details__event-booking';
  document.querySelector('main').replaceChildren(container);
  const popupBooking = window.__bookingTest.renderEventBooking({
    addToCart: async () => 'intent-ref-popup',
    cartUrl: '/cart',
    container,
    event: window.__bookingTest.event,
    inline: false,
    labels: {},
    onClose: () => {
      window.__bookingTest.popupClosed = true;
    },
  });
  window.__bookingTest.popupBooking = popupBooking;
  await popupBooking.open();
})()`);
await waitFor('Boolean(document.querySelector("#event-booking-modal"))');

report.popup = await evaluate(`({
  dialogOpen: document.querySelector('#event-booking-modal dialog')?.open === true,
  formInDialog: Boolean(document.querySelector(
    '#event-booking-modal .event-booking__form',
  )),
  formInline: Boolean(document.querySelector(
    '.product-details__event-booking > .event-booking__form',
  )),
  firstInputFocused:
    document.activeElement?.name === 'contact-firstName',
  noHorizontalOverflow: (() => {
    const content = document.querySelector('#event-booking-modal .modal-content');
    return content ? content.scrollWidth <= content.clientWidth : false;
  })(),
  fieldLayout: (() => {
    const input = document.querySelector(
      '#event-booking-modal [name="contact-firstName"]',
    );
    const field = input?.closest('.event-booking__field');
    const contact = field?.closest('.event-booking__contact');
    return {
      contactColumns: contact ? getComputedStyle(contact).gridTemplateColumns : null,
      fieldColumns: field ? getComputedStyle(field).gridTemplateColumns : null,
      inputContained: input && field
        ? input.getBoundingClientRect().right <= field.getBoundingClientRect().right
        : false,
      labelAboveInput: input && field
        ? field.firstElementChild?.getBoundingClientRect().bottom
          <= input.getBoundingClientRect().top
        : false,
    };
  })(),
})`);
await evaluate('window.__bookingTest.popupBooking.close()');
await waitFor('!document.querySelector("#event-booking-modal")');
report.popup.closed = await evaluate('window.__bookingTest.popupClosed === true');

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
report.mobile = await evaluate(`({
  documentWidth: document.documentElement.scrollWidth,
  labelledControls: [...document.querySelectorAll('input')]
    .every((input) => Boolean(document.querySelector(
      'label[for="' + input.id + '"]',
    ))),
  viewportWidth: window.innerWidth,
})`);
await captureScreenshot('event-booking-saas-retry-mobile');

const { nodes } = await send('Accessibility.getFullAXTree');
report.accessibility = nodes
  .filter((node) => ['heading', 'status'].includes(node.role?.value))
  .map((node) => ({
    name: node.name?.value,
    role: node.role?.value,
  }))
  .filter((node) => node.name);

assert.deepEqual(report.duplicate, {
  callCount: 1,
  emailRetained: true,
  feedback: 'This event is already being booked in your cart. View cart',
  linkHref: '/cart',
  linkText: 'View cart',
  liveMode: 'assertive',
  statusRole: 'status',
});
assert.equal(report.retryFailure.emailRetained, true);
assert.match(report.retryFailure.feedback, /temporarily unavailable/i);
assert.deepEqual(report.retrySuccess, {
  callCount: 2,
  feedback: 'The event tickets were added to your cart.',
  formCleared: true,
  sourceRequestIdReused: true,
});
const popupAssertions = { ...report.popup };
delete popupAssertions.fieldLayout;
assert.deepEqual(popupAssertions, {
  dialogOpen: true,
  formInDialog: true,
  formInline: false,
  firstInputFocused: true,
  noHorizontalOverflow: true,
  closed: true,
});
assert.equal(report.popup.fieldLayout.contactColumns, '1fr 1fr');
assert.match(report.popup.fieldLayout.fieldColumns, /px$/);
assert.equal(report.popup.fieldLayout.inputContained, true);
assert.equal(report.popup.fieldLayout.labelAboveInput, true);
assert.deepEqual(report.mobile, {
  documentWidth: 390,
  labelledControls: true,
  viewportWidth: 390,
});

console.log(JSON.stringify(report, null, 2));
socket.close();
