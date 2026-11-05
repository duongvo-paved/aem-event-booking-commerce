import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/* eslint-disable no-console */
const target = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/config.json', {
  method: 'PUT',
}).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  id += 1;
  pending.set(id, resolve);
  socket.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => {
  const message = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (message.result.exceptionDetails) throw new Error(JSON.stringify(message.result.exceptionDetails));
  return message.result.result.value;
};

try {
  await send('Page.enable');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await run(`(async () => {
    const viewport = document.createElement('meta');
    viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
    document.head.append(viewport);
    document.body.replaceChildren(); document.body.className = 'appear';
    for (const href of ['/styles/styles.css', '/blocks/commerce-orders-list/commerce-orders-list.css']) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
      document.head.append(link); await new Promise(resolve => link.onload = resolve);
    }
    const main = document.createElement('main'); document.body.append(main);
    const section = document.createElement('div'); section.className = 'section'; main.append(section);
    const wrapper = document.createElement('div'); section.append(wrapper);
    const block = document.createElement('div'); block.className = 'commerce-orders-list'; wrapper.append(block);
    const { default: render } = await import('/blocks/commerce-orders-list/upcoming-bookings.js');
    const product = id => ({ sku: id, urlKey: id, attributes: [
      { name: 'is_event_ticket', value: 'true' }, { name: 'external_event_id', value: id },
    ] });
    const event = (id, start) => ({ eventId: id, scheduleType: 'one_time', startsAtUtc: start,
      endsAtUtc: start.replace('10:00', '12:00'), timezone: 'Australia/Brisbane',
      venue: { name: 'Riverstage', address: 'Brisbane City' } });
    const items = ['later', 'soon', 'past', 'recurring'].map(sku => ({
      id: sku, sku, productName: sku === 'soon' ? 'The Dark Side of the Moon' : 'Electric Callboy — TANZNEID World Tour',
      quantityOrdered: sku === 'soon' ? 1 : 2,
      product: { smallImage: { url: '/missing-booking-image.png' } },
    }));
    const options = {
      fetchOrders: async () => ({ items: [{ number: '100000123', status: 'Complete', items }], pageInfo: {} }),
      catalog: { fetchGraphQl: async () => ({ data: { productSearch: {
        page_info: { total_pages: 1 }, items: items.map(item => ({ productView: product(item.sku) })),
      } } }) },
      client: { config: { enabled: true }, enrich: async () => new Map([
        ['later', event('later', '2030-12-01T10:00:00Z')],
        ['soon', event('soon', '2030-11-01T10:00:00Z')],
        ['past', event('past', '2020-01-01T10:00:00Z')],
        ['recurring', { ...event('recurring', '2030-12-01T10:00:00Z'), scheduleType: 'recurring' }],
      ]) },
      now: Date.parse('2030-10-01T00:00:00Z'),
      ordersLink: '/customer/orders', orderLink: number => '/customer/order-details?orderRef=' + number,
    };
    window.bookingTest = { block, render, options };
    await render(block, options);
  })()`);
  const content = await run(`({
    heading: document.querySelector('h2').textContent,
    rows: document.querySelectorAll('.upcoming-booking').length,
    first: document.querySelector('h3').textContent,
    link: document.querySelector('.upcoming-booking__details').getAttribute('href'),
    calendar: document.querySelectorAll('.event-calendar-button').length,
    busy: document.querySelector('ul').getAttribute('aria-busy'),
    singleTicket: document.querySelector('.upcoming-booking__reference').textContent,
    eventDate: document.querySelector('.upcoming-booking__date').textContent,
  })`);
  assert.equal(content.heading, 'Coming up');
  assert.equal(content.rows, 2);
  assert.equal(content.first, 'The Dark Side of the Moon');
  assert.equal(content.link, '/customer/order-details?orderRef=100000123');
  assert.equal(content.calendar, 2);
  assert.equal(content.busy, 'false');
  assert.match(content.singleTicket, /^1 ticket · Order /);
  assert.match(content.eventDate, /2030/);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/upcoming-bookings-download' });
  await run(`document.querySelector('.event-calendar-button').click()`);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const calendar = await fs.readFile('/tmp/upcoming-bookings-download/event.ics', 'utf8');
  assert.match(calendar, /DTSTART:20301101T100000Z/);
  assert.doesNotMatch(calendar, /100000123/);
  for (const width of [390, 768, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height: 900, deviceScaleFactor: 1, mobile: width < 600,
    });
    const layout = await run(`({
      overflow: document.documentElement.scrollWidth > innerWidth,
      heading: getComputedStyle(document.querySelector('h2')).fontSize,
      color: getComputedStyle(document.querySelector('h2')).color,
      name: getComputedStyle(document.querySelector('h3')).fontSize,
      rows: [...document.querySelectorAll('.upcoming-booking')].every(row => row.getBoundingClientRect().width > 0),
    })`);
    assert.equal(layout.overflow, false);
    assert.equal(layout.heading, '22px');
    assert.equal(layout.color, 'rgb(16, 46, 90)');
    assert.equal(layout.name, '18px');
    assert.equal(layout.rows, true);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(`/tmp/upcoming-bookings-${width}.png`, Buffer.from(shot.result.data, 'base64'));
  }
  await run(`document.querySelector('.upcoming-booking__details').focus()`);
  assert.equal(await run(`document.activeElement.textContent`), 'View order');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await run(`document.activeElement.textContent`), 'Add to calendar');
  const states = await run(`(async () => {
    const { block, render, options } = window.bookingTest;
    let release;
    const loading = render(block, { ...options, fetchOrders: () => new Promise(resolve => release = resolve) });
    const loadingText = block.querySelector('[role=status]').textContent;
    release({ items: [], pageInfo: {} }); await loading;
    const empty = block.querySelector('.upcoming-bookings__empty-title').textContent;
    const emptyDescription = block.querySelector('.upcoming-bookings__empty-description').textContent;
    const emptyButtons = block.querySelector('[role=status]').querySelectorAll('button, a').length;
    const emptyBackground = getComputedStyle(block.querySelector('[role=status]')).backgroundColor;
    await render(block, { ...options, fetchOrders: async () => { throw new Error('Fixture error'); } });
    const failed = block.querySelector('[role=status]').textContent;
    const historyLink = block.querySelector('.upcoming-bookings__all-orders').getAttribute('href');
    return { loadingText, empty, emptyDescription, emptyButtons, emptyBackground, failed, historyLink };
  })()`);
  assert.match(states.loadingText, /Loading/);
  assert.equal(states.empty, 'No bookings yet');
  assert.equal(states.emptyDescription, "When you book an event, your tickets will show up here so you don't have to search your email for them.");
  assert.equal(states.emptyButtons, 0);
  assert.equal(states.emptyBackground, 'rgb(244, 247, 250)');
  assert.match(states.failed, /temporarily unavailable/);
  assert.equal(states.historyLink, '/customer/orders');
  console.log('Upcoming bookings browser checks passed: rows, dates, calendar download, links, keyboard, responsive layout, loading, empty, and error states.');
} finally {
  socket.close();
  await fetch(`http://127.0.0.1:9222/json/close/${target.id}`);
}
