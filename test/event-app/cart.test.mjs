import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCorrelatedEventProduct,
  findEventCartLine,
  findNewCartItem,
} from '../../scripts/event-app/cart.js';
import { EVENT_APP_ERROR_TYPES } from '../../scripts/event-app/errors.js';

const form = Object.freeze({
  consent: true,
  contact: {
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  participants: [{ firstName: 'Ada', lastName: 'Lovelace' }],
  quantity: 1,
});

function createPending(overrides = {}) {
  return {
    cartId: null,
    cartItemUid: null,
    intentRef: null,
    sourceRequestId: 'source-request',
    stage: 'pending-intent',
    ...overrides,
  };
}

function cartLinesResponse(items = []) {
  return {
    data: {
      cart: {
        id: 'cart-id',
        itemsV2: { items },
      },
    },
  };
}

function cartLine({
  intentRef = null,
  sku = 'event-sku',
  uid = 'line-uid',
} = {}) {
  return {
    custom_attributes: intentRef
      ? [{ attribute_code: 'booking_intent_ref', value: intentRef }]
      : [],
    product: { sku },
    quantity: 1,
    uid,
  };
}

function setAttributeResponse(intentRef = 'intent-ref', uid = 'line-uid') {
  return {
    data: {
      setCustomAttributesOnCartItem: {
        cart: {
          id: 'cart-id',
          itemsV2: {
            items: [{
              custom_attributes: [{
                attribute_code: 'booking_intent_ref',
                value: intentRef,
              }],
              uid,
            }],
          },
        },
      },
    },
  };
}

test('creates one intent, adds one item, and correlates it through SaaS GraphQL', async () => {
  const calls = {
    add: 0,
    createIntent: 0,
    refresh: 0,
    setAttribute: 0,
  };
  const cartApi = {
    addProductsToCart: async () => {
      calls.add += 1;
      return {
        items: [{ sku: 'event-sku', topLevelSku: 'event-sku', uid: 'line-uid' }],
      };
    },
    createGuestCart: async () => 'unused',
    fetchGraphQl: async (query) => {
      if (query.includes('SetBookingIntent')) {
        calls.setAttribute += 1;
        return setAttributeResponse();
      }
      return cartLinesResponse();
    },
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
    refreshCart: async () => {
      calls.refresh += 1;
    },
    updateProductsFromCart: async () => null,
  };
  const pendingSubmission = createPending();

  const result = await addCorrelatedEventProduct({
    cartApi,
    createIntent: async (payload) => {
      calls.createIntent += 1;
      assert.equal(payload.commerce_cart_id, 'cart-id');
      assert.equal(payload.commerce_sku, 'event-sku');
      assert.equal(payload.source_request_id, 'source-request');
      return { intentRef: 'intent-ref' };
    },
    eventId: 'event-id',
    form,
    pendingSubmission,
    values: { quantity: 1, sku: 'event-sku' },
  });

  assert.equal(result, 'intent-ref');
  assert.deepEqual(calls, {
    add: 1,
    createIntent: 1,
    refresh: 1,
    setAttribute: 1,
  });
  assert.equal(pendingSubmission.stage, 'correlated');
  assert.equal(pendingSubmission.cartItemUid, 'line-uid');
});

test('blocks an already correlated SKU before creating another intent', async () => {
  let createIntentCalls = 0;
  let addCalls = 0;
  const cartApi = {
    addProductsToCart: async () => {
      addCalls += 1;
    },
    createGuestCart: async () => 'unused',
    fetchGraphQl: async () => cartLinesResponse([
      cartLine({ intentRef: 'existing-intent' }),
    ]),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
  };

  await assert.rejects(
    addCorrelatedEventProduct({
      cartApi,
      createIntent: async () => {
        createIntentCalls += 1;
      },
      eventId: 'event-id',
      form,
      pendingSubmission: createPending(),
      values: { quantity: 1, sku: 'event-sku' },
    }),
    (error) => error.type === EVENT_APP_ERROR_TYPES.DUPLICATE,
  );
  assert.equal(createIntentCalls, 0);
  assert.equal(addCalls, 0);
});

test('blocks an uncorrelated existing SKU before creating another intent', async () => {
  let createIntentCalls = 0;
  const cartApi = {
    createGuestCart: async () => 'unused',
    fetchGraphQl: async () => cartLinesResponse([cartLine()]),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
  };

  await assert.rejects(
    addCorrelatedEventProduct({
      cartApi,
      createIntent: async () => {
        createIntentCalls += 1;
      },
      eventId: 'event-id',
      form,
      pendingSubmission: createPending(),
      values: { quantity: 1, sku: 'event-sku' },
    }),
    (error) => error.type === EVENT_APP_ERROR_TYPES.INTEGRITY,
  );
  assert.equal(createIntentCalls, 0);
});

test('repairs an uncorrelated line on retry without creating or adding again', async () => {
  let addCalls = 0;
  let createIntentCalls = 0;
  let setAttributeCalls = 0;
  const cartApi = {
    addProductsToCart: async () => {
      addCalls += 1;
    },
    fetchGraphQl: async (query) => {
      if (query.includes('SetBookingIntent')) {
        setAttributeCalls += 1;
        return setAttributeResponse();
      }
      return cartLinesResponse([cartLine()]);
    },
    refreshCart: async () => null,
    updateProductsFromCart: async () => null,
  };
  const pendingSubmission = createPending({
    cartId: 'cart-id',
    intentRef: 'intent-ref',
    stage: 'intent-created',
  });

  await addCorrelatedEventProduct({
    cartApi,
    createIntent: async () => {
      createIntentCalls += 1;
    },
    eventId: 'event-id',
    form,
    pendingSubmission,
    values: { quantity: 1, sku: 'event-sku' },
  });

  assert.equal(createIntentCalls, 0);
  assert.equal(addCalls, 0);
  assert.equal(setAttributeCalls, 1);
  assert.equal(pendingSubmission.cartItemUid, 'line-uid');
  assert.equal(pendingSubmission.stage, 'correlated');
});

test('a network failure retains the exact cart item UID for correlation-only retry', async () => {
  let addCalls = 0;
  let setAttributeCalls = 0;
  const cartApi = {
    addProductsToCart: async () => {
      addCalls += 1;
      return {
        items: [{ sku: 'event-sku', topLevelSku: 'event-sku', uid: 'line-uid' }],
      };
    },
    fetchGraphQl: async (query) => {
      if (query.includes('SetBookingIntent')) {
        setAttributeCalls += 1;
        if (setAttributeCalls === 1) throw new TypeError('network unavailable');
        return setAttributeResponse();
      }
      return cartLinesResponse();
    },
    refreshCart: async () => null,
    updateProductsFromCart: async () => null,
  };
  const pendingSubmission = createPending({
    cartId: 'cart-id',
    intentRef: 'intent-ref',
    stage: 'intent-created',
  });
  const input = {
    cartApi,
    createIntent: async () => {
      throw new Error('must not create another intent');
    },
    eventId: 'event-id',
    form,
    pendingSubmission,
    values: { quantity: 1, sku: 'event-sku' },
  };

  await assert.rejects(
    addCorrelatedEventProduct(input),
    (error) => error.type === EVENT_APP_ERROR_TYPES.NETWORK && error.retryable,
  );
  assert.equal(pendingSubmission.cartItemUid, 'line-uid');
  assert.equal(pendingSubmission.stage, 'cart-added');

  await addCorrelatedEventProduct(input);
  assert.equal(addCalls, 1);
  assert.equal(setAttributeCalls, 2);
  assert.equal(pendingSubmission.stage, 'correlated');
});

test('a definitive correlation failure removes only the newly added cart item', async () => {
  const removedItems = [];
  const cartApi = {
    addProductsToCart: async () => ({
      items: [{ sku: 'event-sku', topLevelSku: 'event-sku', uid: 'line-uid' }],
    }),
    fetchGraphQl: async (query) => {
      if (query.includes('SetBookingIntent')) {
        return { data: null, errors: [{ message: 'Mutation is unavailable' }] };
      }
      return cartLinesResponse();
    },
    refreshCart: async () => null,
    updateProductsFromCart: async (items) => {
      removedItems.push(...items);
    },
  };
  const pendingSubmission = createPending({
    cartId: 'cart-id',
    intentRef: 'intent-ref',
    stage: 'intent-created',
  });

  await assert.rejects(
    addCorrelatedEventProduct({
      cartApi,
      createIntent: async () => {
        throw new Error('must not create another intent');
      },
      eventId: 'event-id',
      form,
      pendingSubmission,
      values: { quantity: 1, sku: 'event-sku' },
    }),
    (error) => error.type === EVENT_APP_ERROR_TYPES.CONFIGURATION,
  );

  assert.deepEqual(removedItems, [{ quantity: 0, uid: 'line-uid' }]);
  assert.equal(pendingSubmission.cartItemUid, null);
  assert.equal(pendingSubmission.intentRef, 'intent-ref');
  assert.equal(pendingSubmission.stage, 'intent-created');
});

test('cart line helpers reject ambiguous same-SKU lines and identify only new UIDs', () => {
  assert.throws(
    () => findEventCartLine([
      { sku: 'event-sku', uid: 'one' },
      { sku: 'event-sku', uid: 'two' },
    ], 'event-sku'),
    (error) => error.type === EVENT_APP_ERROR_TYPES.INTEGRITY,
  );

  assert.equal(findNewCartItem({
    items: [
      { sku: 'other', topLevelSku: 'other', uid: 'old' },
      { sku: 'event-sku', topLevelSku: 'event-sku', uid: 'new' },
    ],
  }, ['old'], 'event-sku').uid, 'new');
});
