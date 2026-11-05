import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCustomerOrders, loadUpcomingBookings, selectUpcomingBookings } from '../../scripts/event-app/upcoming-bookings.js';

const now = Date.parse('2026-10-01T00:00:00Z');
const product = (id) => ({ attributes: [
  { name: 'is_event_ticket', value: 'true' },
  { name: 'external_event_id', value: id },
] });
const event = (date, extra = {}) => ({ scheduleType: 'one_time', startsAtUtc: date, ...extra });
const item = (sku, extra = {}) => ({ id: sku, sku, productName: sku, quantityOrdered: 2, ...extra });
const order = (number, items, extra = {}) => ({ number, items, status: 'Complete', ...extra });

test('reads every order page without a purchase-date filter and rejects failed pages', async () => {
  const calls = [];
  const result = await loadCustomerOrders(async (...args) => {
    calls.push(args);
    return { items: [order(String(args[2]), [])], pageInfo: { totalPages: 2 } };
  });
  assert.deepEqual(calls, [[20, 'viewAll', 1], [20, 'viewAll', 2]]);
  assert.equal(result.length, 2);
  await assert.rejects(loadCustomerOrders(async () => null), /unavailable/);
});

test('keeps only future confirmed event items, sorted across separate purchases', () => {
  const products = new Map(['later', 'soon', 'past', 'now', 'recurring'].map(sku => [sku, product(sku)]));
  const events = new Map([
    ['later', event('2026-12-01T00:00:00Z')],
    ['soon', event('2026-10-02T00:00:00Z')],
    ['past', event('2026-09-01T00:00:00Z')],
    ['now', event('2026-10-01T00:00:00Z')],
    ['recurring', event('2026-12-01T00:00:00Z', { scheduleType: 'recurring' })],
  ]);
  const orders = [
    order('A', ['later', 'past', 'now', 'recurring', 'non-event'].map(sku => item(sku))),
    order('B', [item('soon')]),
    order('C', [item('soon')]),
    order('D', [item('soon')], { status: 'Canceled' }),
    order('E', [item('soon', { status: 'Cancelled' })]),
  ];
  const result = selectUpcomingBookings(orders, products, events, now);
  assert.deepEqual(result.bookings.map(b => b.orderNumber), ['B', 'C', 'A']);
  assert.equal(result.bookings[0].quantity, 2);
  assert.equal(result.unavailable, false);
});

test('missing and invalid event dates produce unavailable state without false bookings', () => {
  const products = new Map([['missing', product('missing')], ['invalid', product('invalid')]]);
  const result = selectUpcomingBookings([order('A', [item('missing'), item('invalid')])], products,
    new Map([['invalid', event('bad date')]]), now);
  assert.deepEqual(result, { bookings: [], unavailable: true });
});

test('resolves child SKUs and deduplicates enrichment while preserving each order item', async () => {
  const catalog = { fetchGraphQl: async () => ({ data: { productSearch: {
    page_info: { total_pages: 1 },
    items: [{ productView: { sku: 'parent', urlKey: 'event', ...product('event'),
      options: [{ values: [{ product: { sku: 'child' } }] }] } }],
  } } }) };
  const calls = [];
  const result = await loadUpcomingBookings({
    fetchOrders: async () => ({ items: [order('A', [item('child'), item('parent')])], pageInfo: {} }),
    catalog,
    client: { config: { enabled: true }, enrich: async ids => {
      calls.push(ids);
      return new Map([['event', event('2026-12-01T00:00:00Z')]]);
    } },
    now,
  });
  assert.deepEqual(calls, [['event']]);
  assert.equal(result.bookings.length, 2);
});

test('empty accounts avoid catalog calls; service failures are propagated', async () => {
  assert.deepEqual(await loadUpcomingBookings({ fetchOrders: async () => ({ items: [], pageInfo: {} }) }),
    { bookings: [], unavailable: false });
  await assert.rejects(loadUpcomingBookings({
    fetchOrders: async () => ({ items: [order('A', [])], pageInfo: {} }),
    client: { config: { enabled: false } },
  }), /unavailable/);
});
