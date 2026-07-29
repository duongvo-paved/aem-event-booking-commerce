import fs from 'node:fs/promises';

/* eslint-disable no-await-in-loop, no-console */

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

function once(method, timeout = 30000) {
  return new Promise((resolve, reject) => {
    let timer;
    const handler = (params) => {
      clearTimeout(timer);
      listeners.set(
        method,
        (listeners.get(method) || []).filter((entry) => entry !== handler),
      );
      resolve(params);
    };
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${method}`)),
      timeout,
    );
    listeners.set(method, [...(listeners.get(method) || []), handler]);
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
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function navigate(path) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: new URL(path, BASE_URL).toString() });
  await loaded;
  await new Promise((resolve) => {
    setTimeout(resolve, 2500);
  });
}

async function clickAndWait(expression) {
  const previousUrl = await evaluate('window.location.href');
  await evaluate(expression);
  await waitFor(`window.location.href !== ${JSON.stringify(previousUrl)}`);
  await new Promise((resolve) => {
    setTimeout(resolve, 2500);
  });
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
const commerceResponses = [];
const failedResponses = [];
on('Runtime.consoleAPICalled', (event) => {
  if (event.type === 'error') {
    consoleErrors.push(event.args.map((arg) => arg.value || arg.description).join(' '));
  }
});
on('Runtime.exceptionThrown', (event) => {
  pageExceptions.push(event.exceptionDetails.text);
});
on('Network.responseReceived', (event) => {
  const { response } = event;
  if (response.url.includes('/graphql')) {
    commerceResponses.push({
      status: response.status,
      url: response.url.split('?')[0],
    });
  }
  if (response.status >= 400) {
    failedResponses.push({
      status: response.status,
      url: response.url,
    });
  }
});

await Promise.all([
  send('Page.enable'),
  send('Runtime.enable'),
  send('Network.enable'),
  send('Accessibility.enable'),
  send('Performance.enable'),
]);

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__cwv = { cls: 0, lcp: 0 };
    new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (!entry.hadRecentInput) window.__cwv.cls += entry.value;
      });
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__cwv.lcp = entries[entries.length - 1]?.startTime || 0;
    }).observe({ type: 'largest-contentful-paint', buffered: true });`,
});

const report = {
  pdp: {},
  plp: {},
};

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 1,
  height: 900,
  mobile: false,
  width: 1440,
});
await navigate('/');
try {
  await waitFor(`Boolean([...document.querySelectorAll('.nav-drop')]
    .find((item) => item.querySelector(':scope > p')?.textContent.trim()
      === 'Catalog')
    ?.querySelector('a[href]'))`, 8000);
} catch {
  await navigate('/drafts/agents/event-ticket-test');
  await waitFor(`Boolean([...document.querySelectorAll('.nav-drop')]
    .find((item) => item.querySelector(':scope > p')?.textContent.trim()
      === 'Catalog')
    ?.querySelector('a[href]'))`);
}

report.plp.catalogHref = await evaluate(`[
  ...document.querySelectorAll('.nav-drop')
].find((item) => item.querySelector(':scope > p')?.textContent.trim()
  === 'Catalog').querySelector('a[href]').href`);
await clickAndWait(`[
  ...document.querySelectorAll('.nav-drop')
].find((item) => item.querySelector(':scope > p')?.textContent.trim()
  === 'Catalog').querySelector('a[href]').click()`);
try {
  await waitFor(
    'Boolean(document.querySelector(\'.product-discovery-product-list__grid\'))',
  );
} catch (error) {
  report.plp.loadFailure = await evaluate(`({
    blockHtml: document.querySelector('.product-list-page')?.outerHTML || null,
    blockStatus: document.querySelector('.product-list-page')
      ?.getAttribute('data-block-status') || null,
    mainText: document.querySelector('main')?.innerText || '',
    url: window.location.href,
  })`);
  report.plp.loadFailure.error = error.message;
  report.commerceResponses = commerceResponses;
  report.failedResponses = failedResponses;
  report.consoleErrors = consoleErrors;
  report.pageExceptions = pageExceptions;
  console.log(JSON.stringify(report, null, 2));
  socket.close();
  process.exit(2);
}
await waitFor(
  'document.querySelectorAll(\'.product-discovery-product-list__grid a[href]\').length > 0',
);

report.plp.desktop = await evaluate(`({
  cardCount: document.querySelectorAll(
    '.product-discovery-product-list__grid [class*="product-item"]'
  ).length,
  documentWidth: document.documentElement.scrollWidth,
  facetCount: document.querySelectorAll('.product-discovery-facet').length,
  imageCount: document.querySelectorAll(
    '.product-discovery-product-list__grid img'
  ).length,
  imagesMissingAlt: [...document.querySelectorAll(
    '.product-discovery-product-list__grid img'
  )].filter((image) => !image.hasAttribute('alt')).length,
  productLinks: [...new Set([
    ...document.querySelectorAll(
      '.product-discovery-product-list__grid a[href*="/products/"]'
    ),
  ].map((link) => link.href))],
  selectedSort: document.querySelector('select')?.value || null,
  sortOptions: [...(document.querySelector('select')?.options || [])]
    .map((option) => option.textContent.trim()),
  url: window.location.href,
  viewportWidth: window.innerWidth,
  visible: Boolean(
    document.querySelector('.product-discovery-product-list__grid')?.offsetParent
  ),
  webVitals: window.__cwv,
})`);
await captureScreenshot('plp-desktop');

if (report.plp.desktop.sortOptions.length > 1) {
  report.plp.sortInteraction = await evaluate(`(() => {
    const select = document.querySelector('select');
    const initial = select.value;
    select.selectedIndex = select.selectedIndex === 0 ? 1 : 0;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { initial, selected: select.value };
  })()`);
  await new Promise((resolve) => {
    setTimeout(resolve, 3000);
  });
  report.plp.sortInteraction.resultUrl = await evaluate('window.location.href');
}

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
report.plp.mobile = await evaluate(`({
  documentWidth: document.documentElement.scrollWidth,
  gridVisible: Boolean(
    document.querySelector('.product-discovery-product-list__grid')?.offsetParent
  ),
  viewportWidth: window.innerWidth,
})`);
await captureScreenshot('plp-mobile');

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 1,
  height: 900,
  mobile: false,
  width: 1440,
});
await clickAndWait(`document.querySelector(
  '.product-discovery-product-list__grid a[href*="/products/"]'
).click()`);
await waitFor('Boolean(document.querySelector(\'.product-details\'))');
await waitFor(
  'Boolean(document.querySelector(\'.product-details__header\')?.innerText.trim())',
);

report.pdp.desktop = await evaluate(`({
  addToCartText: document.querySelector(
    '.product-details__buttons__add-to-cart button'
  )?.innerText.trim() || '',
  descriptionPresent: Boolean(
    document.querySelector('.product-details__description')?.innerText.trim()
  ),
  documentWidth: document.documentElement.scrollWidth,
  galleryImages: document.querySelectorAll('.product-details__gallery img').length,
  galleryImagesMissingAlt: [...document.querySelectorAll(
    '.product-details__gallery img'
  )].filter((image) => !image.hasAttribute('alt')).length,
  name: document.querySelector('.product-details__header')?.innerText.trim() || '',
  price: document.querySelector('.product-details__price')?.innerText.trim() || '',
  quantity: document.querySelector('input[name="quantity"]')?.value || null,
  quantityVisible: Boolean(
    document.querySelector('input[name="quantity"]')?.offsetParent
  ),
  url: window.location.href,
  viewportWidth: window.innerWidth,
  webVitals: window.__cwv,
})`);
await captureScreenshot('pdp-desktop');

report.pdp.quantityInteraction = await evaluate(`(() => {
  const input = document.querySelector('input[name="quantity"]');
  if (!input) return { available: false };
  const initial = input.value;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, '2');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return { available: true, initial, updated: input.value };
})()`);

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
report.pdp.mobile = await evaluate(`({
  documentWidth: document.documentElement.scrollWidth,
  galleryVisible: Boolean(
    document.querySelector(
      '.product-details__right-column .product-details__gallery'
    )?.offsetParent
  ),
  headerVisible: Boolean(
    document.querySelector('.product-details__header')?.offsetParent
  ),
  viewportWidth: window.innerWidth,
})`);
await captureScreenshot('pdp-mobile');

const { nodes } = await send('Accessibility.getFullAXTree');
report.pdp.accessibility = {
  buttons: nodes.filter((node) => node.role?.value === 'button').length,
  headings: nodes
    .filter((node) => node.role?.value === 'heading')
    .map((node) => node.name?.value)
    .filter(Boolean),
  imagesMissingName: nodes
    .filter((node) => node.role?.value === 'image' && !node.name?.value)
    .length,
  spinButtons: nodes.filter((node) => node.role?.value === 'spinbutton').length,
};
report.commerceResponses = commerceResponses;
report.failedResponses = failedResponses;
report.consoleErrors = consoleErrors;
report.pageExceptions = pageExceptions;

console.log(JSON.stringify(report, null, 2));
socket.close();
