import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeProductSku,
  encodeProductSku,
} from '../scripts/product-url.js';

test('preserves Commerce SKU punctuation in product URL segments', () => {
  const sku = 'EV_11cba5';
  assert.equal(encodeProductSku(sku), 'EV_11cba5');
  assert.equal(decodeProductSku(encodeProductSku(sku)), sku);
});

test('encodes reserved path characters without changing the SKU', () => {
  const sku = 'event/ticket?1';
  const encoded = encodeProductSku(sku);

  assert.equal(encoded, 'event%2Fticket%3F1');
  assert.equal(decodeProductSku(encoded), sku);
});

test('returns malformed URL segments unchanged', () => {
  assert.equal(decodeProductSku('%invalid'), '%invalid');
});
