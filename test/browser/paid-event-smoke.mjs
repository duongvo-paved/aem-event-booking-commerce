import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax */

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = 'scratch/test-results/paid-event';

const head = (await fs.readFile('head.html', 'utf8'))
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '');
await fs.mkdir('drafts/agents', { recursive: true });
await fs.writeFile('drafts/agents/paid-event-test.html', '<!doctype html><html lang="en"><head>'
  + `<meta charset="utf-8">${head}<title>Event UI review</title></head>`
  + '<link rel="stylesheet" href="/styles/styles.css"><body><header></header><main><div><h1>Event UI review</h1></div></main>'
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

async function captureCard(name) {
  const panel = await evaluate(`(() => {
    const panel = document.querySelector('.event-booking-panel');
    const footer = panel.querySelector('.event-booking__actions');
    const saved = {maxHeight: panel.style.maxHeight, overflow: panel.style.overflow,
      footerPosition: footer?.style.position, scrollTop: panel.scrollTop};
    window.__savedCardStyles = saved;
    panel.style.maxHeight = 'none'; panel.style.overflow = 'visible'; panel.scrollTop = 0;
    if (footer) footer.style.position = 'static';
    const rect = panel.getBoundingClientRect();
    return {x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, scale: 1};
  })()`);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true, clip: panel,
  });
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.writeFile(`${SCREENSHOT_DIR}/${name}.png`, Buffer.from(data, 'base64'));
  await evaluate(`(() => {
    const panel = document.querySelector('.event-booking-panel');
    const footer = panel.querySelector('.event-booking__actions');
    const saved = window.__savedCardStyles;
    panel.style.maxHeight = saved.maxHeight; panel.style.overflow = saved.overflow;
    if (footer) footer.style.position = saved.footerPosition;
    panel.scrollTop = saved.scrollTop;
  })()`);
}

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Accessibility.enable')]);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `${BASE_URL}/drafts/agents/paid-event-test` });
await send('Page.bringToFront');
await waitFor('document.readyState === "complete"');
await evaluate(`(async () => {
  const {default: mount} = await import('/test/browser/fixtures/event-uiux.js');
  window.__uiux = await mount({ paid: true, deferPrices: true });
})()`);
assert.equal(await evaluate('document.querySelector(".event-booking__contact").hidden'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__checkout-note").hidden'), true);
assert.match(await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent'), /Loading/);
assert.equal(await evaluate('document.querySelector("details.event-summary")'), null);
// Resolve the batch after changing allocation: the first selection must not win.
await evaluate('window.__uiux.booking.setAllocation(window.__uiux.event.allocations[1]); window.__uiux.releasePrices()');
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("120")');
assert.equal(await evaluate('window.__uiux.getPriceCalls()'), 1);
await captureCard('prototype-empty');
await evaluate('window.__uiux.booking.setQuantity(2)');
assert.match(await evaluate('document.querySelector(".event-summary__total-value").textContent'), /240/);
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 2);
assert.match(await evaluate('document.querySelector(".event-booking__section-heading").textContent'), /Who/);
assert.equal(await evaluate('document.querySelector(".event-booking__attendee-title").textContent'), 'Ticket 1');
await captureCard('prototype-selected');
await evaluate(`(() => {
  document.querySelector('[name="attendee-1-firstName"]').value = 'Grace';
  window.__uiux.booking.setQuantity(1);
  window.__uiux.booking.setQuantity(2);
})()`);
assert.equal(await evaluate('document.querySelector(\'[name="attendee-1-firstName"]\').value'), 'Grace');
await evaluate('document.querySelector(".event-booking__form").requestSubmit()');
assert.equal(await evaluate('document.activeElement.name'), 'attendee-0-firstName');
assert.equal(await evaluate('window.__uiux.getCalls()'), 0);
await evaluate(`(() => {
  const form = document.querySelector('.event-booking__form');
  form.querySelectorAll('input[type="text"]').forEach(input => input.value = 'Test');
  form.querySelector('[name="contact-email"]').value = 'local@example.test';
  form.querySelector('[name="consent"]').checked = true;
  window.__uiux.failBooking(true);
  window.__uiux.holdSubmission(true);
  form.requestSubmit();
})()`);
assert.equal(await evaluate('document.querySelector(".event-booking__form").inert'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
await evaluate('document.querySelector(".event-booking__form").requestSubmit()');
assert.equal(await evaluate('window.__uiux.getCalls()'), 1);
await evaluate('window.__uiux.releaseSubmission()');
await waitFor('!document.querySelector(".event-booking__form").inert');
assert.equal(await evaluate('document.querySelector(\'[name="contact-email"]\').value'), 'local@example.test');
assert.equal(await evaluate('document.querySelector(".event-booking__success").hidden'), true);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  const metrics = await evaluate(`(() => {
    const rect = name => document.querySelector('.product-details__' + name).getBoundingClientRect();
    const gallery = rect('gallery'); const title = rect('header');
    const eventFacts = rect('event-facts');
    const facts = rect('event-details'); const booking = rect('event-actions');
    const info = rect('event-information');
    return { width: innerWidth, scroll: document.documentElement.scrollWidth,
      positions: { gallery: gallery.toJSON(), booking: booking.toJSON() },
      ordered: title.bottom <= eventFacts.top && eventFacts.bottom <= gallery.top
        && (innerWidth >= 900 ? booking.left > gallery.left
          : gallery.bottom <= booking.top && booking.bottom <= info.top && info.bottom <= facts.top),
      forms: document.querySelectorAll('.event-booking__form').length,
      sticky: getComputedStyle(document.querySelector('.event-booking__actions')).position };
  })()`);
  assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics));
  assert.equal(metrics.ordered, true, JSON.stringify(metrics));
  assert.equal(metrics.forms, 1);
  assert.equal(metrics.sticky, width >= 900 ? 'sticky' : 'static');
  await evaluate('document.querySelector(\'[name="contact-email"]\').focus()');
  if (width >= 900) {
    const focusMetrics = await evaluate(`({
      fieldBottom: document.activeElement.closest('.event-booking__field')
        .getBoundingClientRect().bottom,
      footerTop: document.querySelector('.event-booking__actions').getBoundingClientRect().top,
      panelBottom: document.querySelector('.event-booking-panel').getBoundingClientRect().bottom,
      viewportHeight: innerHeight,
    })`);
    assert.ok(focusMetrics.fieldBottom < focusMetrics.footerTop, JSON.stringify(focusMetrics));
    assert.ok(
      focusMetrics.panelBottom <= focusMetrics.viewportHeight,
      JSON.stringify(focusMetrics),
    );
  }
  await captureScreenshot(`selected-${width}`);
}
await evaluate('window.__uiux.failBooking(false); window.__uiux.holdSubmission(false); document.querySelector(".event-booking__form").requestSubmit()');
await waitFor('!document.querySelector(".event-booking__success").hidden');
const success = await evaluate('document.querySelector(".event-booking__success").innerText');
assert.match(success, /Second space/);
assert.match(success, /Test Test/);
assert.match(success, /240/);
assert.match(success, /not confirmed until/);
assert.equal(await evaluate('getComputedStyle(document.querySelector(".event-booking-panel__header")).display'), 'none');
assert.equal(await evaluate('getComputedStyle(document.querySelector(".event-booking__success-summary")).backgroundColor'), 'rgb(244, 247, 250)');
assert.doesNotMatch(success, /local@example.test/);
await captureScreenshot('success-mobile');
await captureCard('prototype-success');
await evaluate('document.querySelector(".event-booking__book-again").click()');
assert.equal(await evaluate('document.querySelector(".event-booking__contact").hidden'), true);
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
assert.match(await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent'), /89/);
await evaluate(`(async () => {
  const {default: mount} = await import('/test/browser/fixtures/event-uiux.js');
  window.__uiux = await mount({ paid: true, missingPrice: true });
})()`);
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("unavailable")');
await evaluate('window.__uiux.booking.setQuantity(1); document.querySelector(".event-booking__form").requestSubmit()');
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
assert.equal(await evaluate('window.__uiux.getCalls()'), 0);
await evaluate(`(async () => {
  const {default: mount} = await import('/test/browser/fixtures/event-uiux.js');
  window.__uiux = await mount({ paid: true, recurring: true });
})()`);
await evaluate(`(() => {
  const date = document.querySelector('#event-occurrence-date');
  date.value = window.__uiux.event.recurrence.startDate;
  date.dispatchEvent(new Event('change', {bubbles:true}));
})()`);
await waitFor('document.querySelector("#event-occurrence-time").options.length === 2');
await evaluate(`(() => {
  const time = document.querySelector('#event-occurrence-time');
  time.selectedIndex = 1; time.dispatchEvent(new Event('change', {bubbles:true}));
  document.querySelector('.event-booking__allocations input[type=radio]').click();
})()`);
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("89")');
await evaluate('window.__uiux.booking.setQuantity(5)');
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 2);
await evaluate(`(() => {
  const form = document.querySelector('.event-booking__form');
  form.querySelectorAll('input[type=text]').forEach(input => input.value = 'Test');
  form.querySelector('[name=contact-email]').value = 'local@example.test';
  form.querySelector('[name=consent]').checked = true;
  form.requestSubmit();
})()`);
await waitFor('window.__uiux.getCalls() === 1');
assert.equal(await evaluate('window.__uiux.getLastSubmission().occurrence.occurrenceId'), 'session-1');
await evaluate('document.querySelector(".event-booking__book-again").click()');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date").value'), '');
assert.equal(await evaluate('document.querySelector(".event-booking__allocations").hidden'), true);
await evaluate(`(async () => {
  const {default: mount} = await import('/test/browser/fixtures/event-uiux.js');
  window.__uiux = await mount({ paid: true, rejectPrices: true });
})()`);
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("unavailable")');
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp();
})()`);
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price")?.textContent.includes("120")');
assert.equal(await evaluate('window.__pdp.getBatchRequests()'), 1);
assert.equal(await evaluate('document.querySelectorAll(".product-details--paid-event .event-booking__form").length'), 1);
assert.equal(await evaluate('document.querySelector(".event-booking-panel").tagName'), 'SECTION');
assert.equal(
  await evaluate('document.querySelector(".event-booking-panel__date").textContent'),
  'Saturday 12 September, 5:00pm',
);
assert.equal(await evaluate('document.querySelectorAll(".event-booking__quantity-wrapper").length'), 0);
assert.equal(await evaluate('document.querySelector(".event-booking__submit-icon")'), null);
assert.equal(await evaluate('document.querySelector(".product-details__gallery .product-details__buttons__add-to-wishlist") !== null'), true);
assert.match(await evaluate('document.querySelector(".product-details__event-details").textContent'), /2026|Brisbane/);
assert.equal(await evaluate('document.querySelector(".product-details__header .pdp-header__sku")'), null);
assert.match(await evaluate('document.querySelector(".product-details__event-details").textContent'), /Event code.*fixture-parent/);
assert.match(await evaluate('document.querySelector(".product-details__event-facts").textContent'), /2026.*Riverstage/);
assert.equal(await evaluate('getComputedStyle(document.querySelector(".product-details__breadcrumbs")).paddingTop'), '24px');
assert.equal(
  await evaluate('document.querySelector(".product-details__event-date span").textContent'),
  'Saturday 12 September 2026, 5:00pm – 10:00pm',
);
assert.equal(
  await evaluate('document.querySelector(".product-details__event-address span").textContent'),
  'Riverstage, Brisbane',
);
assert.equal(await evaluate('document.querySelectorAll(".product-details__event-facts svg[aria-hidden=true]").length'), 2);
await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__quantity-increase").click()');
await waitFor('document.querySelectorAll(".event-booking__attendee").length === 1');
assert.match(await evaluate('document.querySelector(".event-summary__total-value").textContent'), /120/);
assert.equal(await evaluate('document.querySelector(".event-booking__field input").getBoundingClientRect().height'), 46);
assert.equal(await evaluate('document.querySelector(".event-booking__submit").getBoundingClientRect().height'), 54);
for (let index = 0; index < 12; index += 1) {
  await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__quantity-increase").click()');
  await waitFor(`document.querySelectorAll(".event-booking__attendee").length === ${Math.min(index + 2, 10)}`);
}
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 10);
assert.equal(await evaluate('Number(document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-quantity input").value)'), 10);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  const metrics = await evaluate(`(() => {
    const rect = name => document.querySelector('.product-details__' + name).getBoundingClientRect();
    const gallery = rect('gallery'); const booking = rect('event-actions');
    return { width: innerWidth, scroll: document.documentElement.scrollWidth,
      ordered: rect('header').bottom <= rect('event-facts').top
        && rect('event-facts').bottom <= gallery.top
        && (innerWidth >= 900 ? booking.left > gallery.right
          : rect('event-information').top >= booking.bottom),
      forms: document.querySelectorAll('.event-booking__form').length };
  })()`);
  assert.equal(metrics.ordered, true, JSON.stringify(metrics));
  assert.ok(metrics.scroll <= metrics.width, JSON.stringify(metrics));
  assert.equal(metrics.forms, 1);
  await evaluate('document.querySelector(".product-details__breadcrumbs").scrollIntoView()');
  await captureScreenshot(`decorated-${width}`);
  await evaluate('document.querySelector(".event-booking__metadata--prototype").scrollIntoView()');
  const detailsStyle = await evaluate(`(() => {
    const section = document.querySelector('.event-booking__metadata--prototype');
    return {border: getComputedStyle(section).borderTopWidth,
      rowPadding: getComputedStyle(section.querySelector('dt')).paddingTop,
      rowBorder: getComputedStyle(section.querySelector('dd')).borderBottomWidth};
  })()`);
  assert.deepEqual(detailsStyle, { border: '0px', rowPadding: '14px', rowBorder: '1px' });
  await captureScreenshot(`event-details-${width}`);
}
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp({ amount: 0 });
})()`);
await waitFor('document.querySelector(".event-booking__form")');
assert.equal(await evaluate('document.querySelector(".product-details--paid-event")'), null);
assert.equal(await evaluate('document.querySelector(".event-booking-accordion").tagName'), 'DETAILS');
assert.equal(await evaluate('window.__pdp.getBatchRequests()'), 0);
// Category text and destinations must come from Commerce, independent of the prototype.
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp({ categories: [
    {name: 'Other branch', slug: 'other', level: 1, parents: []},
    {name: 'Live music', slug: 'arts/live-music', level: 2,
      parents: [{name: 'Arts & culture', slug: 'arts', level: 1}]},
  ] });
})()`);
await waitFor('document.querySelectorAll(".product-details__breadcrumbs a").length === 3');
const breadcrumbs = await evaluate(`(() => {
  const nav = document.querySelector('.product-details__breadcrumbs');
  return {links: [...nav.querySelectorAll('a')].map(link => [link.textContent, new URL(link.href).pathname]),
    current: nav.querySelector('[aria-current="page"]').textContent,
    font: getComputedStyle(nav).fontSize,
    separators: [...nav.querySelectorAll('[aria-hidden="true"]')].map(element => element.textContent)};
})()`);
assert.deepEqual(breadcrumbs, {
  links: [
    ['Home', '/'], ['Arts & culture', '/arts'], ['Live music', '/arts/live-music'],
  ],
  current: 'Live music at Riverstage',
  font: '15px',
  separators: ['/', '/', '/'],
});
assert.deepEqual(await evaluate('window.__pdp.getBreadcrumbRequests()'), [{ sku: 'fixture-parent' }]);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await evaluate('document.querySelector(".product-details__breadcrumbs").scrollIntoView()');
  await captureScreenshot(`backend-breadcrumbs-${width}`);
}
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp({ categoryError: true });
})()`);
await waitFor('window.__pdp.getBreadcrumbRequests().length === 1');
assert.deepEqual(await evaluate(`(() => {
  const nav = document.querySelector('.product-details__breadcrumbs');
  return {links: [...nav.querySelectorAll('a')].map(link => link.textContent),
    current: nav.querySelector('[aria-current="page"]').textContent};
})()`), { links: ['Home'], current: 'Live music at Riverstage' });
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp({ eventProduct: false });
})()`);
assert.equal(await evaluate('document.querySelector(".product-details--paid-event")'), null);
assert.equal(await evaluate('document.querySelector(".event-booking__form")'), null);
assert.equal(await evaluate('window.__pdp.getBatchRequests()'), 0);
// Regression: HTTP 200 omits direct children but exposes their prices in parent options.
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp({groupedPricesOnly: true});
})()`);
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("22.00")');
assert.deepEqual(await evaluate('window.__pdp.getPriceRequests()'), [
  ['ticket-a', 'ticket-b', 'fixture-parent'],
]);
await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__quantity-increase").click()');
await waitFor('document.querySelectorAll(".event-booking__attendee").length === 1');
assert.match(await evaluate('document.querySelector(".event-summary__total-value").textContent'), /22.00/);
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), false);
await evaluate(`(() => {
  document.querySelector('[name="attendee-0-firstName"]').value = 'Alex';
  document.querySelector('[name="contact-email"]').value = 'kept@example.test';
})()`);
await evaluate('document.querySelectorAll(".event-booking__allocations input[type=radio]")[1].click()');
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 0);
assert.equal(await evaluate('document.querySelector(".event-booking__ticket-quantity input").value'), '0');
assert.equal(await evaluate("document.querySelector('[name=contact-email]').value"), 'kept@example.test');
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("35.00")');
await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__quantity-increase").click()');
await waitFor('document.querySelectorAll(".event-booking__attendee").length === 1');
assert.match(await evaluate('document.querySelector(".event-summary__total-value").textContent'), /35.00/);
assert.equal(await evaluate('window.__pdp.getBatchRequests()'), 1);
await evaluate(`(async () => {
  const { mountDecoratedPdp } = await import('/test/browser/fixtures/event-uiux.js');
  window.__pdp = await mountDecoratedPdp({groupedPricesOnly: true, omitGroupedPrices: true});
})()`);
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("unavailable")');
await evaluate('document.querySelector(".event-booking__allocation-option--selected .event-booking__quantity-increase").click()');
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 0);
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
assert.doesNotMatch(await evaluate('document.querySelector(".event-summary__total-value").textContent'), /999/);
// Paid recurring events load all spaces only after an explicit calendar choice.
async function mountRecurring(options = {}) {
  await evaluate(`(async () => {
    const {mountDecoratedPdp} = await import('/test/browser/fixtures/event-uiux.js');
    window.__pdp = await mountDecoratedPdp(${JSON.stringify({ recurring: true, ...options })});
  })()`);
}
async function chooseDate(key = 'first') {
  await evaluate(`(() => {
    const date = document.querySelector('#event-occurrence-date');
    date.value = window.__pdp.getSessionDates()['${key}'];
    date.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
}
async function chooseTime(index = 1) {
  await waitFor('!document.querySelector("#event-occurrence-time").disabled');
  await evaluate(`(() => {
    const time = document.querySelector('#event-occurrence-time');
    time.selectedIndex = ${index}; time.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
}
const visibleSpaces = () => evaluate(`Array.from(document.querySelectorAll(
  '.event-booking__allocation-option')).filter(row => !row.hidden).length`);
await mountRecurring({ deferDetails: true, deferAvailability: true });
assert.equal(await evaluate('document.querySelector(".event-booking__form")'), null);
await captureScreenshot('ticket-detail-loading');
await evaluate('window.__pdp.releaseDetails()');
await waitFor('document.querySelector("#event-occurrence-date") !== null');
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 0);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date").value'), '');
assert.equal(await evaluate('document.querySelector(".event-booking__allocations").hidden'), true);
await chooseDate();
await chooseDate(); // Duplicate in-flight choices share one request.
await waitFor('window.__pdp.getAvailabilityRequests().length === 1');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date").disabled'), false);
assert.equal(await evaluate('document.querySelector("#event-occurrence-time").disabled'), true);
await evaluate('window.__pdp.releaseAvailability()');
await waitFor('document.querySelector("#event-occurrence-time").options.length === 3');
assert.equal(await evaluate('document.querySelector("#event-occurrence-time").value'), '');
const dates = await evaluate('window.__pdp.getSessionDates()');
assert.deepEqual(await evaluate('window.__pdp.getAvailabilityRequests()'), [
  { allocationId: null, from: dates.first, to: dates.first },
]);
await chooseTime();
assert.equal(await visibleSpaces(), 2);
assert.equal(await evaluate('document.querySelector(".event-booking__allocations input:checked")'), null);
assert.match(await evaluate('document.querySelector(".event-booking-panel__date").textContent'), /9:00am/);
await evaluate('document.querySelectorAll(".event-booking__allocations input[type=radio]")[1].click()');
await waitFor('document.querySelector(".event-booking__allocation-option--selected .event-booking__ticket-price").textContent.includes("90")');
assert.equal(await evaluate(`(async () => {
  const api = await import('/scripts/__dropins__/storefront-pdp/api.js');
  return api.getProductConfigurationValues().occurrenceId;
})()`), `allocation-b-${dates.first}-session-1`);
await evaluate(`(() => {
  document.querySelector('.event-booking__allocation-option--selected .event-booking__quantity-increase').click();
  document.querySelector('[name=contact-email]').value = 'kept@example.test';
  document.querySelector('[name=attendee-0-firstName]').value = 'Draft';
})()`);
await chooseTime(2);
assert.equal(await visibleSpaces(), 1);
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 0);
assert.equal(await evaluate("document.querySelector('[name=contact-email]').value"), 'kept@example.test');
assert.match(await evaluate('document.querySelector(".event-booking-panel__date").textContent'), /10:00am/);
await chooseDate('second');
await chooseTime();
assert.equal(await visibleSpaces(), 1);
await evaluate("document.querySelectorAll('.event-booking__allocations input[type=radio]')[1].click()");
await waitFor('!document.querySelector(".event-booking__allocation-option--selected .event-booking__quantity-increase").disabled');
await evaluate(`(() => {
  for (let i=0;i<6;i++) document.querySelector(
    '.event-booking__allocation-option--selected .event-booking__quantity-increase').click();
})()`);
assert.equal(await evaluate('document.querySelectorAll(".event-booking__attendee").length'), 4);
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 2);
await chooseDate('excluded');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date").getAttribute("aria-invalid")'), 'true');
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 2);
assert.equal(await evaluate('document.querySelector(".event-booking__allocations").hidden'), true);
await evaluate(`(() => {
  const date = document.querySelector('#event-occurrence-date');
  date.value = '2000-01-01'; date.dispatchEvent(new Event('change', {bubbles:true}));
})()`);
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 2);
await mountRecurring({ scheduledWeekdays: [1] });
const nonMonday = new Date(`${dates.first}T12:00:00Z`).getUTCDay() === 1 ? 'second' : 'first';
await chooseDate(nonMonday);
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 0);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date").getAttribute("aria-invalid")'), 'true');
await mountRecurring({ failAvailabilityOnce: true });
await chooseDate();
await waitFor('!document.querySelector(".event-booking__availability-retry").hidden');
await evaluate('document.querySelector(".event-booking__availability-retry").click()');
await chooseTime();
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 2);
await mountRecurring({ emptyAvailability: true });
await chooseDate();
await waitFor('document.querySelector("#event-occurrence-time").textContent.includes("No available times")');
assert.equal(await evaluate('document.querySelector(".event-booking__submit").disabled'), true);
await mountRecurring({ deferAvailability: true });
await chooseDate();
await chooseDate('second');
await waitFor('window.__pdp.getAvailabilityRequests().length === 2');
await evaluate('window.__pdp.releaseAvailability()');
await chooseTime();
assert.equal(await visibleSpaces(), 1);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date").value'), dates.second);
await chooseDate();
await chooseTime();
assert.equal(await evaluate('window.__pdp.getAvailabilityRequests().length'), 3);
assert.equal(await visibleSpaces(), 2);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  assert.equal(await evaluate(`(() => {
    const date = document.querySelector('#event-occurrence-date');
    date.focus();
    return document.activeElement === date && !!date.labels.length
      && document.documentElement.scrollWidth <= innerWidth;
  })()`), true);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
  });
  await captureScreenshot(`recurring-date-first-${width}`);
}
await captureScreenshot('recurring-date-first');
console.log('Date-first recurring checks passed: no automatic selection, one-day all-space query, canonical IDs, filtering, reset, retry, stale responses and fresh revisits.');
console.log('Grouped child pricing passed: parent-only response, allocation-specific prices, missing-price guard.');
console.log('Real PDP decorator and Commerce batch API wiring passed.');
console.log('Paid event browser checks passed: child pricing, stale selection, validation, quantity drafts, submitting, retry, success, reset, missing price and 3 viewports.');
socket.close();
