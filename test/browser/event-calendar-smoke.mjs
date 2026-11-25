import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

/* eslint-disable no-await-in-loop, no-console, no-restricted-syntax */

const DEVTOOLS_URL = process.env.DEVTOOLS_URL || 'http://127.0.0.1:9222';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const head = (await fs.readFile('head.html', 'utf8'))
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/g, '');
await fs.mkdir('drafts/agents', { recursive: true });
await fs.writeFile('drafts/agents/event-calendar-test.html', '<!doctype html><html lang="en"><head>'
  + `<meta charset="utf-8">${head}<title>Recurring event calendar check</title>`
  + '<link rel="stylesheet" href="/styles/styles.css">'
  + '<link rel="stylesheet" href="/blocks/product-details/product-details.css"></head>'
  + '<body class="appear"><header></header><main></main>'
  + '<footer></footer></body></html>');

const target = await fetch(`${DEVTOOLS_URL}/json/new?about:blank`, { method: 'PUT' })
  .then((response) => response.json());
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
    awaitPromise: true, expression, returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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

await Promise.all([send('Page.enable'), send('Runtime.enable')]);
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
});
await send('Page.navigate', { url: `${BASE_URL}/drafts/agents/event-calendar-test` });
await send('Page.bringToFront');
await waitFor('document.readyState === "complete"');
await evaluate(`(async () => {
  const { default: createSessionSelector } = await import('/blocks/product-details/event-session-selector.js');
  const dateKey = (date) => date.toISOString().slice(0, 10);
  const addDays = (value, amount) => {
    const date = new Date(value + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + amount);
    return dateKey(date);
  };
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Australia/Brisbane',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const today = todayParts.year + '-' + todayParts.month + '-' + todayParts.day;
  const startDate = addDays(today, 2);
  let firstSession = startDate;
  while (new Date(firstSession + 'T12:00:00Z').getUTCDay() !== 1) {
    firstSession = addDays(firstSession, 1);
  }
  const excludedDate = addDays(firstSession, 7);
  let endDate = addDays(firstSession, 35);
  const [endYear, endMonth] = endDate.split('-').map(Number);
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0, 12)).getUTCDate();
  if (Number(endDate.slice(-2)) === lastDay) endDate = addDays(endDate, -1);
  const calls = [];
  const changes = [];
  window.__calendarTest = { today, startDate, firstSession, excludedDate, endDate, calls, changes };
  const selector = createSessionSelector({
    event: {
      timezone: 'Australia/Brisbane',
      recurrence: {
        startDate, endDate, weekdays: [1], excludedDates: [excludedDate],
      },
    },
    labels: { Global: {} },
    onDateChange: (date) => calls.push(date),
    onChange: (session) => changes.push(session),
  });
  window.__calendarTest.selector = selector;
  const block = document.createElement('div');
  block.className = 'block product-details product-details--paid-event';
  block.append(selector.fieldset);
  document.querySelector('main').append(block);
})()`);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-panel").hidden'), true);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-trigger").getAttribute("aria-expanded")'), 'false');
await evaluate('document.querySelector("#event-occurrence-date-trigger").click()');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-panel").hidden'), false);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-trigger").getAttribute("aria-expanded")'), 'true');
await send('Input.dispatchKeyEvent', {
  type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
});
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-panel").hidden'), true);
assert.equal(await evaluate('document.activeElement.id'), 'event-occurrence-date-trigger');
await evaluate('document.querySelector("#event-occurrence-date-trigger").click()');
await evaluate('document.querySelector(".event-booking__occurrence-availability").click()');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-panel").hidden'), true);
await evaluate('document.querySelector("#event-occurrence-date-trigger").click()');

const dates = await evaluate(`(({ today, startDate, firstSession, excludedDate, endDate }) => ({
  today, startDate, firstSession, excludedDate, endDate,
}))(window.__calendarTest)`);
const scheduleState = await evaluate(`(() => {
  const state = window.__calendarTest;
  const dateButton = (date) => document.querySelector('[data-date="' + date + '"]');
  const unscheduledDate = new Date(state.firstSession + 'T12:00:00Z');
  unscheduledDate.setUTCDate(unscheduledDate.getUTCDate() + 1);
  const pastDate = new Date(state.today + 'T12:00:00Z');
  pastDate.setUTCDate(pastDate.getUTCDate() - 1);
  return {
    past: dateButton(dateKey(pastDate))?.disabled,
    scheduled: dateButton(state.firstSession)?.disabled,
  };
  function dateKey(date) { return date.toISOString().slice(0, 10); }
})()`);
assert.deepEqual(scheduleState, {
  past: true, scheduled: false,
}, JSON.stringify({ dates, scheduleState }));
await evaluate('document.querySelector(".event-booking__calendar-nav[aria-label^=Next]").click()');
assert.equal(await evaluate(`(() => {
  const state = window.__calendarTest;
  const unscheduledDate = new Date(state.firstSession + 'T12:00:00Z');
  unscheduledDate.setUTCDate(unscheduledDate.getUTCDate() + 1);
  const dateKey = (date) => date.toISOString().slice(0, 10);
  return document.querySelector('[data-date="' + dateKey(unscheduledDate) + '"]')?.disabled
    && document.querySelector('[data-date="' + state.excludedDate + '"]')?.disabled;
})()`), true);
await evaluate(`document.querySelector('[data-date="${dates.excludedDate}"]').click()`);
assert.deepEqual(await evaluate('window.__calendarTest.calls'), []);
await evaluate('document.querySelector(".event-booking__calendar-nav[aria-label^=Next]").click()');
assert.equal(await evaluate(`(() => {
  const state = window.__calendarTest;
  const afterEnd = new Date(state.endDate + 'T12:00:00Z');
  afterEnd.setUTCDate(afterEnd.getUTCDate() + 1);
  return document.querySelector('[data-date="' + afterEnd.toISOString().slice(0, 10) + '"]')
    ?.disabled === true;
})()`), true);
await evaluate('document.querySelector(".event-booking__calendar-nav[aria-label^=Previous]").click()');
await evaluate('document.querySelector(".event-booking__calendar-nav[aria-label^=Previous]").click()');
await evaluate('window.scrollTo(0, 0)');
await new Promise((resolve) => {
  setTimeout(resolve, 250);
});
const screenshot = await send('Page.captureScreenshot', { format: 'png' });
await fs.mkdir('scratch/test-results/event-calendar', { recursive: true });
await fs.writeFile(
  'scratch/test-results/event-calendar/calendar.png',
  Buffer.from(screenshot.data, 'base64'),
);

await evaluate(`document.querySelector('[data-date="${dates.firstSession}"]').click()`);
assert.deepEqual(await evaluate('window.__calendarTest.calls'), [dates.firstSession]);
assert.equal(await evaluate('window.__calendarTest.changes.length'), 1);
assert.equal(await evaluate(`document.querySelector('[data-date="${dates.firstSession}"]').getAttribute('aria-pressed')`), 'true');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-panel").hidden'), true);
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-trigger").getAttribute("aria-expanded")'), 'false');
assert.equal(await evaluate('document.querySelector("#event-occurrence-date-trigger").innerText'), '30/11/2026');

const originalMonth = await evaluate('document.querySelector(".event-booking__calendar-month").textContent');
await evaluate('document.querySelector("#event-occurrence-date-trigger").click()');
await evaluate('document.querySelector(".event-booking__calendar-nav[aria-label^=Next]").click()');
assert.notEqual(await evaluate('document.querySelector(".event-booking__calendar-month").textContent'), originalMonth);
await evaluate('document.querySelector(".event-booking__calendar-nav[aria-label^=Previous]").click()');
await evaluate(`document.querySelector('[data-date="${dates.firstSession}"]').focus()`);
assert.equal(await evaluate('document.activeElement.dataset.date'), dates.firstSession);
await send('Input.dispatchKeyEvent', {
  type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
});
await send('Input.dispatchKeyEvent', {
  type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39,
});
const nextSession = await evaluate(`(() => {
  const date = new Date('${dates.firstSession}T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + 14);
  return date.toISOString().slice(0, 10);
})()`);
const keyboardState = await evaluate(`(() => ({
  activeDate: document.activeElement.dataset.date || '',
  focusableDate: document.querySelector('#event-occurrence-date [tabindex="0"]')?.dataset.date,
  month: document.querySelector('.event-booking__calendar-month').textContent,
}))()`);
assert.equal(
  keyboardState.activeDate,
  nextSession,
  JSON.stringify({ dates, nextSession, keyboardState }),
);
assert.equal(keyboardState.focusableDate, nextSession);
assert.match(keyboardState.month, /December/);
for (const width of [390, 768, 1200]) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 844, deviceScaleFactor: 1, mobile: width < 600,
  });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
}
socket.close();
console.log('Recurring calendar browser checks passed: past/range/weekday/excluded dates are disabled; valid selection, availability callback, month controls, keyboard movement and mobile width work.');
