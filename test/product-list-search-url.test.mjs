import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySearchStateToUrl,
  getSearchStateFromUrl,
} from '../blocks/product-list-page/search-url.js';

test('ignores storefront-owned filters supplied through the URL', () => {
  const url = new URL(
    'https://example.com/search?filter=inStock:false|visibility:Catalog|categoryPath:men|color:blue',
  );

  assert.deepEqual(getSearchStateFromUrl(url).filter, [
    { attribute: 'color', in: ['blue'] },
  ]);
});

test('does not persist storefront-owned filters in the URL', () => {
  const url = new URL('https://example.com/search');

  applySearchStateToUrl(url, {
    filter: [
      { attribute: 'visibility', in: ['Search'] },
      { attribute: 'inStock', eq: 'true' },
      { attribute: 'categoryPath', eq: 'men' },
      { attribute: 'color', in: ['blue'] },
    ],
  });

  assert.equal(url.searchParams.get('filter'), 'color:blue');
});
