import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax */

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = 'scratch/test-results/event-uiux';

const head = await fs.readFile('head.html', 'utf8');
await fs.mkdir('drafts/agents', { recursive: true });
await fs.writeFile('drafts/agents/event-uiux-test.html', '<!doctype html><html lang="en"><head>'
  + `<meta charset="utf-8">${head}<title>Event UI review</title></head>`
  + '<body><header></header><main><div><h1>Event UI review</h1></div></main>'
  + '<footer></footer></body></html>');

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

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Accessibility.enable')]);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `${BASE_URL}/drafts/agents/event-uiux-test` });
await send('Page.bringToFront');
await waitFor('document.readyState === "complete"');
await evaluate(`(async () => {
  const {default: mount} = await import('/test/browser/fixtures/event-uiux.js');
  window.__uiux = await mount();
})()`);
const runtimeErrors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails.exception?.description
      || message.params.exceptionDetails.text);
  }
});
assert.equal(await evaluate('document.querySelector(".event-booking__contact").hidden'), true);
assert.equal(await evaluate('getComputedStyle(document.querySelector(".event-booking__contact")).display'), 'none');
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__availability-warning").hidden'), false);

await evaluate(`(() => {
  const input = document.querySelector('#event-booking-quantity');
  input.value = '2'; input.dispatchEvent(new Event('input', {bubbles: true}));
})()`);
assert.equal(await evaluate('document.querySelector(".event-booking__contact").hidden'), false);
assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".event-booking__contact")).display'), 'none');
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 2);
await evaluate('document.querySelector(".event-booking__form").requestSubmit()');
assert.equal(await evaluate('document.activeElement.name'), 'contact-firstName');
assert.equal(await evaluate('window.__uiux.getCalls()'), 0);
await evaluate(`(() => {
  const form = document.querySelector('.event-booking__form');
  form.querySelectorAll('input[type="text"]').forEach(input => input.value = 'Test');
  form.querySelector('[name="contact-email"]').value = 'local@example.test';
  form.querySelector('[name="consent"]').checked = true;
  window.__uiux.failBooking(true);
  form.requestSubmit();
})()`);
await waitFor('document.querySelector(".event-booking__feedback").textContent.length > 0');
assert.equal(await evaluate('document.querySelector(".event-booking__success").hidden'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__form").hidden'), false);
await evaluate('window.__uiux.failBooking(false); document.querySelector(".event-booking__form").requestSubmit()');
await waitFor('!document.querySelector(".event-booking__success").hidden');
const success = await evaluate('document.querySelector(".event-booking__success").innerText');
assert.match(success, /Added to your cart/);
assert.match(success, /2 tickets/);
assert.match(success, /178/);
assert.doesNotMatch(success, /local@example.test|local-test-ref/);
assert.equal(await evaluate('document.querySelector(".event-booking__form").hidden'), true);
await captureScreenshot('success-desktop');
await evaluate('document.querySelector(".event-booking__book-again").click()');
assert.equal(await evaluate('document.querySelector(".event-booking__success").hidden'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__contact").hidden'), true);
assert.equal(await evaluate('getComputedStyle(document.querySelector(".event-booking__contact")).display'), 'none');

await evaluate(`(() => {
  window.__uiux.booking.setAllocation(window.__uiux.event.allocations[1]);
})()`);
assert.equal(await evaluate('document.querySelector(".event-booking__availability-warning").hidden'), true);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  const metrics = await evaluate('({width:innerWidth, scroll:document.documentElement.scrollWidth})');
  assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics));
  await captureScreenshot(`booking-${width}`);
}
const { nodes } = await send('Accessibility.getFullAXTree');
assert.ok(nodes.some((node) => node.role?.value === 'button' && node.name?.value === 'Add to calendar'));
const downloadDirectory = `/tmp/event-uiux-downloads-${Date.now()}`;
await fs.mkdir(downloadDirectory, { recursive: true });
await send('Browser.setDownloadBehavior', {
  behavior: 'allow', downloadPath: downloadDirectory,
});
await evaluate('document.querySelector(".event-calendar-button").click()');
let calendarFile;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const files = await fs.readdir(downloadDirectory);
  calendarFile = files.find((name) => name.endsWith('.ics'));
  if (calendarFile) break;
  await new Promise((resolve) => { setTimeout(resolve, 100); });
}
assert.ok(calendarFile, 'Calendar click downloads an ICS file');
assert.match(await fs.readFile(`${downloadDirectory}/${calendarFile}`, 'utf8'), /DTSTART:20260912T070000Z/);
await send('Browser.setDownloadBehavior', { behavior: 'default' });
await evaluate('window.__uiux.renderConfirmation()');
await waitFor('document.querySelector(".order-confirmation__event-introduction")');
assert.equal(await evaluate('document.querySelectorAll(".order-confirmation__booking-information .event-calendar-button").length'), 1);
assert.match(await evaluate('document.querySelector(".order-confirmation__booking-information").innerText'), /Live music at Riverstage/);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  await evaluate('document.querySelector(".commerce-checkout-success").scrollIntoView()');
  const metrics = await evaluate('({width:innerWidth, scroll:document.documentElement.scrollWidth})');
  assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics));
  await captureScreenshot(`confirmation-${width}`);
}
await evaluate('window.__uiux.renderAccount()');
assert.ok(await evaluate('document.querySelectorAll(".commerce-account-sidebar a[href]").length > 0'));
await evaluate('document.querySelector(".commerce-account-header").scrollIntoView()');
await captureScreenshot('account-mobile');
await evaluate('window.__uiux.renderConfirmation(false)');
assert.equal(await evaluate('document.querySelectorAll(".order-confirmation__event-introduction").length'), 0);
assert.equal(await evaluate('document.querySelector(".commerce-checkout-success").classList.contains("event-order-confirmation")'), false);
assert.match(await evaluate('document.querySelector(".order-confirmation__footer").innerText'), /Continue shopping/);
assert.deepEqual(runtimeErrors, []);
console.log('Event UI browser checks passed: validation, success, availability, 3 viewports, accessibility.');
socket.close();
