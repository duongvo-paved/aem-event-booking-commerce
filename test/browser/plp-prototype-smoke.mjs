/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const SCREENSHOT_DIR = 'scratch/test-results/plp-prototype';
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

const runtimeErrors = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.bringToFront');
// Supply only public event metadata; Commerce search and wishlist remain real.
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, options) => {
      if (String(input).includes('/event-api/enrich')) {
        const ids = JSON.parse(options.body).external_event_ids;
        window.eventEnrichmentCalls ||= [];
        window.eventEnrichmentCalls.push(ids);
        if (window.failEventEnrichment) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Unavailable' }), {
            status: 503, headers: { 'Content-Type': 'application/json' }
          }));
        }
        const events = Object.fromEntries(ids.map(id => [id, {
          event_id: id, organizer: 'Demo Events', tags: [],
          starts_at_utc: '2026-09-12T07:00:00Z',
          ends_at_utc: '2026-09-12T09:00:00Z', timezone: 'Australia/Brisbane',
          venue: { name: 'Riverstage', venue_id: 'venue-test',
            address: { lines: ['1 Demo Street'], city: 'Brisbane', country_code: 'AU' } },
          allocations: [{ allocated_capacity: 10, available_quantity: 8,
            commerce_sku: 'test-ticket', event_allocation_id: 'test-allocation',
            space: { name: 'Main room', space_id: 'test-space' },
            zone: { name: 'Main zone', zone_id: 'test-zone' } }]
        }]));
        return Promise.resolve(new Response(JSON.stringify({ events }), {
          headers: { 'Content-Type': 'application/json' }
        }));
      }
      return originalFetch(input, options);
    };
  `,
});
await send('Page.navigate', { url: 'http://localhost:3000/events' });
await waitFor(`document.querySelector('.event-card-wishlist button')
  && document.querySelector('.dropin-product-item-card').getBoundingClientRect().width > 0`, 30000);
await waitFor("document.querySelector('.event-card-metadata__schedule svg')", 30000);
assert.equal(
  await evaluate("document.querySelector('.event-card-metadata__schedule').textContent"),
  'Sat 12 Sep, 5:00pm – 7:00pm',
);
for (const width of [1440, 1024, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  if (width === 390) await evaluate("document.querySelector('.search__view-facets button').click()");
  const report = await evaluate(`(() => {
    const card = document.querySelector('.dropin-product-item-card');
    const image = card.querySelector('.dropin-product-item-card__image-container')
      .getBoundingClientRect();
    const wishlist = card.querySelector('.event-card-wishlist button').getBoundingClientRect();
    return {
      columns: getComputedStyle(document.querySelector('.product-discovery-product-list__grid'))
        .gridTemplateColumns.split(' ').length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      wishlistInside: wishlist.top >= image.top && wishlist.right <= image.right,
      titleAlign: getComputedStyle(card.querySelector('.dropin-product-item-card__title')).textAlign,
      count: document.querySelector('.search__result-info').textContent,
    };
  })()`);
  let expectedColumns = 1;
  if (width >= 768) expectedColumns = 2;
  if (width >= 1200) expectedColumns = 3;
  assert.equal(report.columns, expectedColumns);
  assert.equal(report.overflow, false);
  assert.equal(report.wishlistInside, true);
  assert.equal(report.titleAlign, 'left');
  assert.match(report.count, /Showing 1–3 of 3 events/);
  await captureScreenshot(`listing-${width}`);
}

assert.notEqual(await evaluate(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  return events.lastPayload('authenticated');
})()`), true, 'Wishlist check requires an unsigned-in browser session');
await evaluate("document.querySelector('.event-card-wishlist button').click()");
await waitFor(`document.querySelector('.event-card-wishlist button')
  ?.getAttribute('aria-label').startsWith('remove ')`, 10000);
await evaluate("document.querySelector('.event-card-wishlist button').click()");
await waitFor(`document.querySelector('.event-card-wishlist button')
  ?.getAttribute('aria-label').startsWith('add ')`, 10000);

await evaluate("document.querySelector('#event_type-Art-label').click()");
await waitFor("document.querySelector('.search__filter-chip') && location.search.includes('event_type')", 30000);
assert.equal(await evaluate(`(() => {
  const applied = document.querySelector('.search__applied-filters').getBoundingClientRect();
  const toolbar = document.querySelector('.search__toolbar').getBoundingClientRect();
  return applied.bottom <= toolbar.top;
})()`), true);
await evaluate("document.querySelector('.search__filter-chip').focus(); document.activeElement.click()");
await waitFor("document.querySelector('.search__applied-filters').hidden", 30000);
assert.equal(await evaluate('document.activeElement.className'), 'search__facets-heading');

// Multi-value filters must lose only the selected chip, then clear all user filters.
await send('Page.navigate', {
  url: 'http://localhost:3000/events?filter=event_type%3AArt%7Cevent_type%3ATours%7Cevent_status%3AOpen',
});
await waitFor("document.querySelectorAll('.search__filter-chip').length === 3", 30000);
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
});
await captureScreenshot('selected-filters-desktop');
await evaluate('document.querySelector(\'[aria-label="Remove Event Type filter: Art"]\').click()');
await waitFor("document.querySelectorAll('.search__filter-chip').length === 2", 30000);
assert.equal(await evaluate("document.querySelector('#event_type-Tours').checked"), true);
await evaluate("document.querySelector('.search__applied-filters .search__clear-filters').click()");
await waitFor("document.querySelector('.search__applied-filters').hidden", 30000);
assert.equal(await evaluate("document.querySelector('.search__facets-header button')"), null);

await evaluate("document.querySelector('#event_type-Art-label').click()");
await waitFor("document.querySelector('.search__filter-chip')", 30000);
await evaluate("document.querySelector('.search__applied-filters .search__clear-filters').click()");
await waitFor("document.querySelector('.search__applied-filters').hidden", 30000);
await evaluate(`(() => {
  const select = document.querySelector('.search__product-sort select');
  select.value = 'price_ASC'; select.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await waitFor("location.search.includes('price_ASC')", 30000);
await evaluate('history.back()');
await waitFor(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  return !location.search.includes('price_ASC')
    && !events.lastPayload('search/result').request.sort?.some(s => s.attribute === 'price');
})()`, 30000);
await evaluate('history.forward()');
await waitFor(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  return location.search.includes('price_ASC')
    && events.lastPayload('search/result').request.sort?.some(s => s.attribute === 'price');
})()`, 30000);

// Keep the real product schema, varying price, missing images and title length.
assert.equal(await evaluate(`(async () => {
  const { isFreeProduct } = await import('/blocks/product-list-page/product-list-page.js');
  const price = value => ({ final: { amount: { value } } });
  return isFreeProduct({ price: price(0) })
    && !isFreeProduct({}) && !isFreeProduct({ price: price(1) })
    && isFreeProduct({ priceRange: { minimum: price(0), maximum: price(0) } })
    && !isFreeProduct({ priceRange: { minimum: price(0), maximum: price(10) } });
})()`), true);
await evaluate(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  const payload = structuredClone(events.lastPayload('search/result'));
  window.plpOriginalPayload = payload;
  const products = payload.result.items;
  products[0].name = 'A long event title that wraps across multiple lines in a narrow card';
  products[0].priceRange = undefined;
  products[0].price = { final: { amount: { value: 0, currency: 'AUD' } },
    regular: { amount: { value: 0, currency: 'AUD' } } };
  products[0].images = [];
  // Unique keys exercise fresh slot rendering rather than reusing existing cards.
  products.forEach(product => { product.sku += '-fixture'; product.id += '-fixture'; });
  events.emit('search/result', payload);
})()`);
await waitFor("document.querySelector('.event-card-free-badge')", 10000);
assert.equal(await evaluate("document.querySelector('.event-card-free-price').textContent"), 'Free');
assert.equal(await evaluate("document.querySelectorAll('.event-card-free-badge').length"), 1);
assert.equal(await evaluate("document.querySelector('.event-card-image-placeholder img')"), null);
await captureScreenshot('free-long-title-missing-image');

await evaluate(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  const payload = structuredClone(window.plpOriginalPayload);
  payload.request.currentPage = 2;
  payload.request.pageSize = 3;
  payload.result.totalCount = 6;
  payload.result.pageInfo = { currentPage: 2, pageSize: 3, totalPages: 2, totalItems: 6 };
  events.emit('search/result', payload);
})()`);
assert.equal(
  await evaluate("document.querySelector('.search__result-info').textContent"),
  'Showing 4–6 of 6 events',
);
await evaluate(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  const payload = structuredClone(window.plpOriginalPayload);
  payload.result.items = []; payload.result.totalCount = 0;
  events.emit('search/result', payload);
})()`);
assert.equal(
  await evaluate("document.querySelector('.search__result-info').textContent"),
  'Showing 0–0 of 0 events',
);

// Wishlist uses the same card metadata without replacing its Commerce controls.
await send('Page.navigate', { url: 'http://localhost:3000/events' });
await waitFor("document.querySelector('.event-card-wishlist button')", 30000);
await evaluate(`(async () => {
  const { addProductsToWishlist } = await import('/scripts/__dropins__/storefront-wishlist/api.js');
  await addProductsToWishlist([
    { sku: 'BaX34', quantity: 1 }, { sku: 'LJN7887', quantity: 1 }, { sku: 'auod', quantity: 1 },
  ]);
})()`);
await send('Page.navigate', { url: 'http://localhost:3000/wishlist' });
await waitFor(`document.querySelectorAll('.wishlist-event-info .event-card-metadata__schedule')
  .length === 3`, 30000);
assert.equal(await evaluate('window.eventEnrichmentCalls.length'), 1);
assert.equal(await evaluate('window.eventEnrichmentCalls[0].length'), 3);
for (const width of [1440, 768, 390]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 1000, deviceScaleFactor: 1, mobile: width < 600,
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
  assert.equal(await evaluate(`document.querySelector('.wishlist-event-info '
    + '.event-card-metadata__schedule').textContent`), 'Sat 12 Sep, 5:00pm – 7:00pm');
  assert.equal(await evaluate(`document.querySelectorAll('.wishlist-event-info '
    + '.event-card-metadata__venue svg').length`), 3);
  assert.equal(await evaluate(`document.querySelectorAll('.wishlist-event-info '
    + '.event-card-metadata__organizer svg').length`), 3);
  await captureScreenshot(`wishlist-metadata-${width}`);
}
await evaluate("document.querySelector('[data-testid=wishlist-product-item-remove-button]').click()");
await waitFor("document.querySelectorAll('.wishlist-event-info').length === 2", 30000);
await evaluate(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  window.failEventEnrichment = true;
  events.emit('wishlist/data', events.lastPayload('wishlist/data'));
})()`);
await waitFor(`document.querySelectorAll('.wishlist-event-info.event-card-metadata--unavailable')
  .length === 2`, 30000);
assert.equal(await evaluate("document.querySelectorAll('.wishlist-product-item').length"), 2);
assert.equal(await evaluate(`document.querySelectorAll(
  '[data-testid=wishlist-product-item-customize-button]').length`), 2);
await evaluate(`(async () => {
  const { events } = await import('/scripts/__dropins__/tools/event-bus.js');
  window.failEventEnrichment = false;
  events.emit('wishlist/data', events.lastPayload('wishlist/data'));
})()`);
await waitFor(`document.querySelectorAll('.wishlist-event-info .event-card-metadata__schedule')
  .length === 2`, 30000);
assert.equal(await evaluate("document.querySelectorAll('.wishlist-event-info').length"), 2);
for (const remaining of [1, 0]) {
  await evaluate("document.querySelector('[data-testid=wishlist-product-item-remove-button]').click()");
  await waitFor(`document.querySelectorAll('.wishlist-product-item').length === ${remaining}`, 30000);
}
await waitFor("document.querySelector('[data-testid=empty-wishlist]')", 30000);
assert.deepEqual(runtimeErrors, []);
console.log('PLP prototype checks passed: four viewports, filters, clear actions, sorting, '
  + 'metadata icons, free prices, missing images, page ranges and wishlist event metadata.');
socket.close();
