import assert from 'node:assert/strict';
import test from 'node:test';

import { createCartProductLinkResolver } from '../../scripts/event-app/cart-product-links.js';

const eventAttributes = [{ name: 'is_event_ticket', value: 'yes' }];
const child = {
  sku: 'child-SKU', topLevelSku: 'child-SKU', url: { urlKey: 'child-title' },
  productAttributes: eventAttributes,
};
const parent = {
  sku: 'Parent-SKU', urlKey: 'parent-title', attributes: eventAttributes,
  options: [{ values: [{ product: { sku: 'child-SKU' } }] }],
};
const getProductLink = (urlKey, sku) => `${urlKey}/${sku}`;
const anchor = () => ({
  attributes: new Map(),
  setAttribute(key, value) { this.attributes.set(key, value); },
  removeAttribute(key) { this.attributes.delete(key); },
});
const response = (products, pages = 1) => ({
  data: {
    productSearch: {
      page_info: { total_pages: pages },
      items: products.map((productView) => ({ productView })),
    },
  },
});

test('cart and mini-cart share a parent lookup and use the exact parent URL key and SKU', async () => {
  let calls = 0;
  const catalog = { fetchGraphQl: async () => { calls += 1; return response([parent]); } };
  const cart = createCartProductLinkResolver({ catalog, getProductLink });
  const miniCart = createCartProductLinkResolver({ catalog, getProductLink });
  const title = anchor();
  const image = anchor();
  const binding = cart.bind(title, child);
  assert.equal(title.href, undefined);
  await Promise.all([binding, miniCart.bind(image, child)]);
  assert.equal(calls, 1);
  assert.equal(title.href, 'parent-title/Parent-SKU');
  assert.equal(image.href, title.href);
  assert.equal(cart.routeProduct(child), title.href);
  assert.equal(title.attributes.has('aria-busy'), false);
});

test('finds parents on later catalog pages and does not infer relationships from SKU prefixes', async () => {
  const pages = [];
  const catalog = {
    fetchGraphQl: async (_query, { variables }) => {
      pages.push(variables.page);
      return response(variables.page === 1 ? [] : [parent], 2);
    },
  };
  const resolver = createCartProductLinkResolver({ catalog, getProductLink });
  const link = anchor();
  await resolver.bind(link, child);
  assert.deepEqual(pages, [1, 2]);
  assert.equal(link.href, 'parent-title/Parent-SKU');
  const unmatched = anchor();
  await resolver.bind(unmatched, { ...child, sku: 'child-sku' });
  assert.equal(unmatched.href, 'child-title/child-SKU');
});

test('ordinary products do not query the catalog', async () => {
  const resolver = createCartProductLinkResolver({
    catalog: { fetchGraphQl: () => assert.fail('Unexpected catalog query') }, getProductLink,
  });
  const link = anchor();
  await resolver.bind(link, { ...child, productAttributes: [] });
  assert.equal(link.href, 'child-title/child-SKU');
});

test('ignores unrelated options and retries after a catalog failure', async () => {
  let calls = 0;
  const catalog = {
    fetchGraphQl: async () => {
      calls += 1;
      return calls === 1 ? { errors: [{ message: 'Unavailable' }] }
        : response([{ ...parent, attributes: [] }, { ...parent, sku: 'Actual-Parent' }]);
    },
  };
  const resolver = createCartProductLinkResolver({ catalog, getProductLink });
  const first = anchor();
  await resolver.bind(first, child);
  assert.equal(first.href, 'child-title/child-SKU');
  assert.equal(first.attributes.has('aria-busy'), false);
  const retry = anchor();
  await resolver.bind(retry, child);
  assert.equal(retry.href, 'parent-title/Actual-Parent');
});
