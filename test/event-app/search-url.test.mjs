import assert from 'node:assert/strict';
import test from 'node:test';
import { getSearchStateFromUrl, applySearchStateToUrl } from '../../blocks/product-list-page/search-url.js';

test('legacy preset dates are removed while standard listing state is preserved', () => {
  const url = new URL('https://store.test/events?q=music&page=2&filter=event_date:2026-09-12|event_type:Music');
  const state = getSearchStateFromUrl(url);
  assert.equal(state.phrase, 'music');
  assert.equal(state.currentPage, 2);
  assert.deepEqual(state.filter, [{ attribute: 'event_type', in: ['Music'] }]);
  applySearchStateToUrl(url, state);
  assert.equal(url.searchParams.get('filter'), 'event_type:Music');
});

test('standard filters, underscore sorts and percent values round-trip', () => {
  const url = new URL('https://store.test/events?q=music');
  applySearchStateToUrl(url, {
    currentPage: 1,
    sort: [{ attribute: 'product_name', direction: 'ASC' }],
    filter: [
      { attribute: 'price', range: { from: 0, to: 100 } },
      { attribute: 'offer', in: ['50% off'] },
      { attribute: 'inStock', eq: 'false' },
      { attribute: 'event_date', in: ['2026-09-12'] },
    ],
  });
  const state = getSearchStateFromUrl(url);
  assert.equal(state.phrase, 'music');
  assert.equal(state.currentPage, 1);
  assert.deepEqual(state.sort, [{ attribute: 'product_name', direction: 'ASC' }]);
  assert.deepEqual(state.filter, [
    { attribute: 'price', range: { from: 0, to: 100 } },
    { attribute: 'offer', in: ['50% off'] },
  ]);
});
