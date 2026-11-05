import assert from 'node:assert/strict';
import test from 'node:test';
import { toAccountOrder } from '../../scripts/event-app/order-line-items.js';

test('adapts the order drop-in without losing historical values or item details', () => {
  const item = { id: 'line-1', productSku: 'historical-sku', productName: 'Original event name',
    quantityOrdered: 3, thumbnail: { url: '/historical.jpg' },
    product: { sku: 'current-sku', name: 'Renamed event', image: '/current.jpg' },
    configurableOptions: { Session: 'Evening' }, giftMessage: { message: 'Enjoy!' } };
  const total = { value: 66, currency: 'AUD' };
  const result = toAccountOrder({ number: '000000041', status: 'Pending',
    orderDate: '2026-07-11T12:00:00Z', grandTotal: total, items: [item] }, 'en-AU');
  assert.equal(result.number, '000000041');
  assert.match(result.orderDate, /11\/07\/2026/);
  assert.deepEqual(result.total.grandTotal, total);
  assert.equal(result.items[0].sku, 'historical-sku');
  assert.equal(result.items[0].topLevelSku, 'current-sku');
  assert.equal(result.items[0].productName, 'Original event name');
  assert.equal(result.items[0].product.smallImage.url, '/historical.jpg');
  assert.equal(result.items[0].lineDetails, item);
});

test('retains deleted product lines and handles missing dates and items', () => {
  const result = toAccountOrder({ number: '42', orderDate: 'invalid',
    items: [{ id: 'deleted', productSku: 'gone', productName: 'Deleted product', quantityOrdered: 1 }] });
  assert.equal(result.orderDate, '');
  assert.equal(result.items[0].productName, 'Deleted product');
  assert.equal(result.items[0].sku, 'gone');
  assert.equal(result.items[0].product.smallImage.url, '');
  assert.deepEqual(toAccountOrder({}).items, []);
});
