import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

/* eslint-disable no-await-in-loop, no-console */

const DEVTOOLS_URL = 'http://127.0.0.1:9222';
const BASE_URL = 'http://localhost:3000';
const EVENT_PDP_PATH = '/products/brisbane-sculpture-festival/evt-204186505';
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
    'document.querySelector(\'.product-details__event-content\')?.innerText.trim() || \'\'',
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
await navigate(EVENT_PDP_PATH);
await waitFor('Boolean(document.querySelector(\'.product-details--event\'))');
await waitFor('Boolean(document.querySelector(\'.event-booking-accordion .event-booking__form\'))');
await waitFor(`document.querySelector(
  '.product-details--event .product-details__gallery img',
)?.getBoundingClientRect().width > 0`);
report.commerce.eventPdp = {
  desktop: await evaluate(`(() => {
    const gallery = document.querySelector(
      '.product-details--event .product-details__gallery',
    );
    const image = gallery?.querySelector('img');
    const galleryBounds = gallery?.getBoundingClientRect();
    const imageBounds = image?.getBoundingClientRect();
    const expectedImageHeight = image?.naturalWidth
      ? imageBounds.width * (image.naturalHeight / image.naturalWidth)
      : 0;
    const imageUrls = [
      ...(gallery?.querySelectorAll('img, source') || []),
    ].flatMap((element) => [element.src, element.srcset])
      .filter(Boolean);
    return {
      eventMode: Boolean(gallery),
      galleryWidth: Math.round(galleryBounds?.width || 0),
      imageWidth: Math.round(imageBounds?.width || 0),
      heightDelta: Math.round(Math.abs(
        (imageBounds?.height || 0) - expectedImageHeight,
      )),
      leftEdgeDelta: Math.round(Math.abs(
        (galleryBounds?.left || 0) - (imageBounds?.left || 0),
      )),
      rightEdgeDelta: Math.round(Math.abs(
        (galleryBounds?.right || 0) - (imageBounds?.right || 0),
      )),
      usesMainImageArrows: Boolean(
        gallery?.querySelector('.pdp-carousel--main-image-controls'),
      ),
      hasHeightInImageUrls: imageUrls.some((url) => /(?:[?&])height=/.test(url)),
      attributesText: document.querySelector(
        '.product-details--event .product-details__attributes',
      )?.innerText.trim() || '',
      hasThumbnailColumn: Boolean(
        gallery?.querySelector('.pdp-carousel--thumbnailsColumn'),
      ),
      widthDelta: Math.round(Math.abs(
        (galleryBounds?.width || 0) - (imageBounds?.width || 0),
      )),
      documentWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      bookingAccordionExpanded: document.querySelector(
        '.event-booking-accordion',
      )?.open === true,
      quantityInsideAccordion: Boolean(document.querySelector(
        '.event-booking-accordion .event-booking__quantity',
      )),
      quantityDefault: document.querySelector(
        '.event-booking-accordion input[name="quantity"]',
      )?.value,
      quantityLabel: document.querySelector(
        '.event-booking-accordion .event-booking__quantity-label',
      )?.innerText.trim() || '',
      quantityWidth: Math.round(document.querySelector(
        '.event-booking-accordion .event-booking__quantity',
      )?.getBoundingClientRect().width || 0),
      quantityContentWidth: Math.round(document.querySelector(
        '.event-booking-accordion .event-booking__quantity .dropin-incrementer__content',
      )?.getBoundingClientRect().width || 0),
      quantityContentContained: (() => {
        const content = document.querySelector(
          '.event-booking-accordion .event-booking__quantity .dropin-incrementer__content',
        );
        return Boolean(content && content.scrollWidth <= content.clientWidth);
      })(),
      quantityRightAligned: (() => {
        const quantity = document.querySelector(
          '.event-booking-accordion .event-booking__quantity',
        );
        const form = quantity?.closest('.event-booking__form');
        return Boolean(quantity && form
          && Math.abs(quantity.getBoundingClientRect().right
            - form.getBoundingClientRect().right) <= 1);
      })(),
      attendeeCount: document.querySelectorAll(
        '.event-booking-accordion .event-booking__participant',
      ).length,
      attendeeText: document.querySelector(
        '.event-booking-accordion .event-booking__participant legend',
      )?.innerText.trim() || '',
      summaryVisible: Boolean(document.querySelector(
        '.product-details--event .event-summary',
      )),
      summaryAfterDescription: (() => {
        const description = document.querySelector('.product-details__description');
        const summary = document.querySelector('.product-details--event .event-summary');
        return Boolean(description && summary && description.compareDocumentPosition(summary)
          & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
      actionsAfterSummary: (() => {
        const summary = document.querySelector('.product-details--event .event-summary');
        const actions = document.querySelector('.product-details__event-actions');
        return Boolean(summary && actions && summary.compareDocumentPosition(actions)
          & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
      consentOutsideAccordion: !document.querySelector(
        '.event-booking-accordion .event-booking__consent',
      ),
      consentBelowSummary: Boolean(document.querySelector(
        '.product-details__event-actions .event-booking__consent',
      )),
      submitBelowSummary: Boolean(document.querySelector(
        '.product-details__event-actions .event-booking__submit',
      )),
      submitDisabledAtZero: document.querySelector(
        '.product-details__event-actions .event-booking__submit',
      )?.disabled === true,
      contactEmailFullWidth: (() => {
        const email = document.querySelector(
          '.event-booking-accordion .event-booking__contact .event-booking__field:last-child',
        );
        return email ? getComputedStyle(email).gridColumn === '1 / -1' : false;
      })(),
      submitHasCartIcon: Boolean(document.querySelector(
        '.product-details__event-actions .event-booking__submit-icon',
      )),
      wishlistBesideSubmit: (() => {
        const buttons = document.querySelector(
          '.product-details__event-actions .event-booking__buttons',
        );
        const wishlist = buttons?.querySelector(
          '.product-details__buttons__add-to-wishlist',
        );
        return Boolean(buttons && wishlist && buttons.querySelector('.event-booking__submit'));
      })(),
      controlsAssociated: (() => {
        const form = document.querySelector('.event-booking-accordion .event-booking__form');
        const consent = document.querySelector('.event-booking__consent input');
        const submit = document.querySelector('.event-booking__submit');
        return Boolean(form && consent?.form === form && submit?.form === form);
      })(),
      externalControlsReset: (() => {
        const form = document.querySelector('.event-booking-accordion .event-booking__form');
        const consent = document.querySelector('.event-booking__consent input');
        if (!form || !consent) return false;
        consent.checked = true;
        form.reset();
        return consent.checked === false;
      })(),
      validationMessageRemoved: (() => {
        const form = document.querySelector('.event-booking-accordion .event-booking__form');
        const consentError = document.querySelector(
          '.product-details__event-actions .event-booking__consent .event-booking__field-error',
        );
        const fieldError = document.querySelector(
          '.event-booking-accordion .event-booking__field-error',
        );
        if (!form || !consentError || !fieldError) return null;
        form.requestSubmit();
        const consentStyle = getComputedStyle(consentError);
        const fieldStyle = getComputedStyle(fieldError);
        return {
          feedback: document.querySelector('.event-booking__feedback')?.innerText || '',
          warningFont: consentStyle.font,
          fieldWarningFont: fieldStyle.font,
          warningLetterSpacing: consentStyle.letterSpacing,
          fieldWarningLetterSpacing: fieldStyle.letterSpacing,
        };
      })(),
      summaryText: document.querySelector(
        '.product-details--event .event-summary',
      )?.innerText.trim() || '',
    };
  })()`),
};
report.commerce.eventPdp.desktop.quantityInteraction = await evaluate(`(() => {
  const input = document.querySelector(
    '.event-booking-accordion input[name="quantity"]',
  );
  if (!input) return { available: false };
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ).set;
  setter.call(input, '2');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('.event-booking-accordion').open = true;
  return { available: true, updated: input.value };
})()`);
await waitFor(`document.querySelector('.event-summary__ticket-count')
  ?.innerText.includes('2')`);
report.commerce.eventPdp.desktop.quantityInteraction.summary = await evaluate(`({
  participantCount: document.querySelectorAll(
    '.event-booking-accordion .event-booking__participant',
  ).length,
  attendeeText: document.querySelector(
    '.event-booking-accordion .event-booking__participant legend',
  )?.innerText.trim(),
  summaryCount: document.querySelector('.event-summary__ticket-count')?.innerText,
  summaryTotal: document.querySelector('.event-summary__total-value')?.innerText,
  submitDisabled: document.querySelector(
    '.product-details__event-actions .event-booking__submit',
  )?.disabled,
})`);
report.commerce.eventPdp.desktop.quantityInteraction.contactFieldAlignment = await evaluate(`(() => {
  const form = document.querySelector('.event-booking-accordion .event-booking__form');
  const firstName = form?.querySelector('[name="contact-firstName"]');
  const lastName = form?.querySelector('[name="contact-lastName"]');
  const email = form?.querySelector('[name="contact-email"]');
  const consent = document.querySelector(
    '.product-details__event-actions .event-booking__consent input[name="consent"]',
  );
  if (!form || !firstName || !lastName || !email || !consent) return null;

  firstName.value = 'Duong';
  lastName.value = '';
  email.value = 'duong@example.test';
  consent.checked = true;
  form.requestSubmit();

  const firstNameTop = firstName.getBoundingClientRect().top;
  const lastNameTop = lastName.getBoundingClientRect().top;
  return {
    firstNameTop,
    inputTopDelta: Math.abs(firstNameTop - lastNameTop),
    lastNameTop,
  };
})()`);
await captureScreenshot('event-pdp-gallery-desktop');

await send('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 844,
  mobile: true,
  width: 390,
});
await navigate(EVENT_PDP_PATH);
await waitFor(`(() => {
  const image = document.querySelector(
    '.product-details--event .product-details__right-column .product-details__gallery img',
  );
  return image?.complete && image.naturalWidth > 0;
})()`);
await waitFor('Boolean(document.querySelector(\'.event-booking-accordion .event-booking__form\'))');
report.commerce.eventPdp.mobile = await evaluate(`(() => {
  const gallery = document.querySelector(
    '.product-details--event .product-details__right-column .product-details__gallery',
  );
  const image = gallery?.querySelector('img');
  const galleryBounds = gallery?.getBoundingClientRect();
  const imageBounds = image?.getBoundingClientRect();
    const expectedImageHeight = image?.naturalWidth
      ? imageBounds.width * (image.naturalHeight / image.naturalWidth)
      : 0;
    const imageUrls = [
      ...(gallery?.querySelectorAll('img, source') || []),
    ].flatMap((element) => [element.src, element.srcset])
      .filter(Boolean);
    return {
    galleryWidth: Math.round(galleryBounds?.width || 0),
    imageWidth: Math.round(imageBounds?.width || 0),
    heightDelta: Math.round(Math.abs(
      (imageBounds?.height || 0) - expectedImageHeight,
    )),
    leftEdgeDelta: Math.round(Math.abs(
      (galleryBounds?.left || 0) - (imageBounds?.left || 0),
    )),
      rightEdgeDelta: Math.round(Math.abs(
        (galleryBounds?.right || 0) - (imageBounds?.right || 0),
      )),
      hasHeightInImageUrls: imageUrls.some((url) => /(?:[?&])height=/.test(url)),
    documentWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      bookingAccordionExpanded: document.querySelector(
        '.event-booking-accordion',
      )?.open === true,
      bookingAfterEventDetails: (() => {
        const details = document.querySelector('.product-details__event-details-mobile');
        const booking = document.querySelector('.event-booking-accordion');
        return Boolean(details && booking && details.contains(booking));
      })(),
      summaryAfterDescription: (() => {
        const description = document.querySelector('.product-details__description');
        const summary = document.querySelector('.product-details--event .event-summary');
        return Boolean(description && summary && description.compareDocumentPosition(summary)
          & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
      actionsAfterSummary: (() => {
        const summary = document.querySelector('.product-details--event .event-summary');
        const actions = document.querySelector('.product-details__event-actions');
        return Boolean(summary && actions && summary.compareDocumentPosition(actions)
          & Node.DOCUMENT_POSITION_FOLLOWING);
      })(),
    };
})()`);
await captureScreenshot('event-pdp-gallery-mobile');

assert.equal(report.commerce.eventPdp.desktop.eventMode, true);
assert.equal(report.commerce.eventPdp.desktop.hasThumbnailColumn, false);
assert.equal(report.commerce.eventPdp.desktop.usesMainImageArrows, true);
assert.equal(report.commerce.eventPdp.desktop.hasHeightInImageUrls, false);
assert.equal(report.commerce.eventPdp.desktop.attributesText.includes('External Event ID'), false);
assert.equal(report.commerce.eventPdp.desktop.attributesText.includes('Is Event Ticket'), false);
assert.ok(report.commerce.eventPdp.desktop.widthDelta <= 2);
assert.ok(report.commerce.eventPdp.desktop.leftEdgeDelta <= 2);
assert.ok(report.commerce.eventPdp.desktop.rightEdgeDelta <= 2);
assert.ok(report.commerce.eventPdp.desktop.heightDelta <= 2);
assert.equal(
  report.commerce.eventPdp.desktop.documentWidth,
  report.commerce.eventPdp.desktop.clientWidth,
);
assert.equal(report.commerce.eventPdp.desktop.bookingAccordionExpanded, true);
assert.equal(report.commerce.eventPdp.desktop.quantityInsideAccordion, true);
assert.equal(report.commerce.eventPdp.desktop.quantityDefault, '0');
assert.equal(report.commerce.eventPdp.desktop.quantityLabel, 'Number of attendees');
assert.equal(report.commerce.eventPdp.desktop.attendeeCount, 0);
assert.equal(report.commerce.eventPdp.desktop.attendeeText, '');
assert.ok(report.commerce.eventPdp.desktop.quantityWidth <= 160);
assert.ok(report.commerce.eventPdp.desktop.quantityContentWidth <= 160);
assert.equal(report.commerce.eventPdp.desktop.quantityContentContained, true);
assert.equal(report.commerce.eventPdp.desktop.quantityRightAligned, true);
assert.equal(report.commerce.eventPdp.desktop.summaryVisible, true);
assert.equal(report.commerce.eventPdp.desktop.summaryAfterDescription, true);
assert.equal(report.commerce.eventPdp.desktop.actionsAfterSummary, true);
assert.equal(report.commerce.eventPdp.desktop.consentOutsideAccordion, true);
assert.equal(report.commerce.eventPdp.desktop.consentBelowSummary, true);
assert.equal(report.commerce.eventPdp.desktop.submitBelowSummary, true);
assert.equal(report.commerce.eventPdp.desktop.submitDisabledAtZero, true);
assert.equal(report.commerce.eventPdp.desktop.contactEmailFullWidth, true);
assert.equal(report.commerce.eventPdp.desktop.submitHasCartIcon, true);
assert.equal(report.commerce.eventPdp.desktop.wishlistBesideSubmit, true);
assert.equal(report.commerce.eventPdp.desktop.controlsAssociated, true);
assert.equal(report.commerce.eventPdp.desktop.externalControlsReset, true);
assert.deepEqual(report.commerce.eventPdp.desktop.validationMessageRemoved, {
  feedback: '',
  warningFont: report.commerce.eventPdp.desktop.validationMessageRemoved.fieldWarningFont,
  fieldWarningFont: report.commerce.eventPdp.desktop.validationMessageRemoved.fieldWarningFont,
  warningLetterSpacing: report.commerce.eventPdp.desktop.validationMessageRemoved.fieldWarningLetterSpacing,
  fieldWarningLetterSpacing: report.commerce.eventPdp.desktop.validationMessageRemoved.fieldWarningLetterSpacing,
});
assert.match(report.commerce.eventPdp.desktop.summaryText, /Summary/i);
assert.match(report.commerce.eventPdp.desktop.summaryText, /Tickets/i);
assert.equal(report.commerce.eventPdp.desktop.quantityInteraction.available, true);
assert.equal(report.commerce.eventPdp.desktop.quantityInteraction.updated, '2');
assert.equal(
  report.commerce.eventPdp.desktop.quantityInteraction.summary.participantCount,
  2,
);
assert.equal(
  report.commerce.eventPdp.desktop.quantityInteraction.summary.attendeeText,
  'Attendee 1',
);
assert.match(
  report.commerce.eventPdp.desktop.quantityInteraction.summary.summaryCount,
  /2/,
);
assert.equal(report.commerce.eventPdp.desktop.quantityInteraction.summary.submitDisabled, false);
assert.ok(
  report.commerce.eventPdp.desktop.quantityInteraction.contactFieldAlignment.inputTopDelta <= 1,
);
assert.ok(report.commerce.eventPdp.mobile.leftEdgeDelta <= 2);
assert.ok(report.commerce.eventPdp.mobile.rightEdgeDelta <= 2);
assert.ok(report.commerce.eventPdp.mobile.heightDelta <= 2);
assert.equal(report.commerce.eventPdp.mobile.hasHeightInImageUrls, false);
assert.equal(
  report.commerce.eventPdp.mobile.documentWidth,
  report.commerce.eventPdp.mobile.clientWidth,
);
assert.equal(report.commerce.eventPdp.mobile.bookingAccordionExpanded, true);
assert.equal(report.commerce.eventPdp.mobile.bookingAfterEventDetails, true);
assert.equal(report.commerce.eventPdp.mobile.summaryAfterDescription, true);
assert.equal(report.commerce.eventPdp.mobile.actionsAfterSummary, true);

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
