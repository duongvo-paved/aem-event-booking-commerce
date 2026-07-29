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

async function navigate(path) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${BASE_URL}${path}` });
  await loaded;
  await new Promise((resolve) => {
    setTimeout(resolve, 2500);
  });
}

async function waitFor(expression, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
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
const graphqlResponses = [];
on('Runtime.consoleAPICalled', (event) => {
  if (event.type === 'error') {
    consoleErrors.push(event.args.map((arg) => arg.value || arg.description).join(' '));
  }
});
on('Runtime.exceptionThrown', (event) => {
  pageExceptions.push(event.exceptionDetails.text);
});
on('Network.responseReceived', (event) => {
  if (event.response.url.includes('/graphql')) {
    graphqlResponses.push({
      status: event.response.status,
      url: event.response.url,
    });
  }
});

await Promise.all([
  send('Page.enable'),
  send('Runtime.enable'),
  send('Network.enable'),
  send('Accessibility.enable'),
]);

const report = {
  commerce: {},
  runtimeConfiguration: {},
  ticketFallback: {},
};

await navigate('/');
report.runtimeConfiguration = await evaluate(`fetch('/config.json')
  .then((response) => response.json())
  .then((config) => ({
    commerceEndpoint: config.public?.default?.['commerce-endpoint'] || null,
    eventAppConfigured: Boolean(config.public?.default?.['event-app']),
  }))`);

let searchReady = false;
try {
  await waitFor('Boolean(document.querySelector(\'#search\'))', 5000);
  searchReady = true;
} catch {
  report.commerce.homeText = await evaluate(
    'document.querySelector(\'main\')?.innerText.slice(0, 1200) || \'\'',
  );
}

if (searchReady) {
  await evaluate(`(() => {
    const input = document.querySelector('#search');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set;
    input.focus();
    setter.call(input, 'event');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await send('Input.dispatchKeyEvent', {
    code: 'Enter',
    key: 'Enter',
    type: 'keyDown',
    windowsVirtualKeyCode: 13,
  });
  await send('Input.dispatchKeyEvent', {
    code: 'Enter',
    key: 'Enter',
    type: 'keyUp',
    windowsVirtualKeyCode: 13,
  });
} else {
  // This route is verified by the project's product-list block README and tests.
  await navigate('/search?q=event');
}
await new Promise((resolve) => {
  setTimeout(resolve, 6000);
});

report.commerce.searchUrl = await evaluate('window.location.href');
report.commerce.productLinks = await evaluate(`[
  ...new Set(
    [...document.querySelectorAll('a[href*="/products/"]')]
      .map((link) => link.href)
  )
]`);
report.commerce.pageText = await evaluate(
  'document.querySelector(\'main\')?.innerText.slice(0, 1200) || \'\'',
);
report.commerce.graphqlResponses = graphqlResponses;

if (report.commerce.productLinks.length > 0) {
  await navigate(new URL(report.commerce.productLinks[0]).pathname);
  try {
    await waitFor('Boolean(document.querySelector(\'.product-details\'))');
  } catch {
    report.commerce.productPageText = await evaluate(
      'document.querySelector(\'main\')?.innerText.slice(0, 1200) || \'\'',
    );
  }
  report.commerce.productUrl = await evaluate('window.location.href');
  report.commerce.bookingText = await evaluate(
    'document.querySelector(\'.product-details__event-booking\')?.innerText.trim() || \'\'',
  );
  report.commerce.bookingFormPresent = await evaluate(
    'Boolean(document.querySelector(\'.event-booking__form\'))',
  );
}

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 1,
  height: 900,
  mobile: false,
  width: 1440,
});
await navigate(`/drafts/agents/event-ticket-test?booking_ref=${'a'.repeat(43)}`);
await waitFor('Boolean(document.querySelector(\'.event-ticket__message\'))');
report.ticketFallback.desktop = await evaluate(`({
  busy: document.querySelector('.event-ticket__result')?.getAttribute('aria-busy'),
  message: document.querySelector('.event-ticket__message')?.innerText,
  role: document.querySelector('.event-ticket__message')?.getAttribute('role'),
  visible: Boolean(document.querySelector('.event-ticket__message')?.offsetParent),
})`);
await captureScreenshot('event-ticket-runtime-unavailable-desktop');

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
report.ticketFallback.mobile = await evaluate(`({
  documentWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  messageVisible: Boolean(document.querySelector('.event-ticket__message')?.offsetParent),
})`);
await captureScreenshot('event-ticket-runtime-unavailable-mobile');

const { nodes } = await send('Accessibility.getFullAXTree');
report.ticketFallback.accessibility = nodes
  .filter((node) => ['alert', 'heading', 'link'].includes(node.role?.value))
  .map((node) => ({
    name: node.name?.value,
    role: node.role?.value,
  }));
report.consoleErrors = consoleErrors;
report.pageExceptions = pageExceptions;

console.log(JSON.stringify(report, null, 2));
socket.close();
