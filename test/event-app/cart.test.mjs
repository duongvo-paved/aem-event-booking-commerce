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
  attendees: [{ firstName: 'Ada', lastName: 'Lovelace' }],
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

function setAttributeResponse(intentRef = 'intent-ref', uid = 'line-uid', occurrence) {
  const customAttributes = [
    {
      attribute_code: 'booking_intent_ref',
      value: intentRef,
    },
  ];
  if (occurrence) {
    customAttributes.push(
      { attribute_code: 'event_occurrence_id', value: occurrence.occurrenceId },
      { attribute_code: 'event_occurrence_date', value: occurrence.localDate },
      { attribute_code: 'event_occurrence_start_time', value: occurrence.startTime },
      { attribute_code: 'event_occurrence_end_time', value: occurrence.endTime },
      { attribute_code: 'event_occurrence_timezone', value: occurrence.timezone },
    );
  }
  return {
    data: {
      setCustomAttributesOnCartItem: {
        cart: {
          id: 'cart-id',
          itemsV2: {
            items: [{
              custom_attributes: customAttributes,
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
    commerceSku: 'event-sku',
    createIntent: async (payload) => {
      calls.createIntent += 1;
      assert.equal(payload.commerce_cart_id, 'cart-id');
      assert.equal(payload.commerce_sku, 'event-sku');
      assert.equal(payload.event_allocation_id, 'allocation-1');
      assert.equal(payload.occurrence_id, undefined);
      assert.deepEqual(payload.attendees, form.attendees);
      assert.equal(payload.source_request_id, 'source-request');
      return { intentRef: 'intent-ref' };
    },
    eventId: 'event-id',
    eventAllocationId: 'allocation-1',
    form,
    pendingSubmission,
    values: { quantity: 1, sku: 'parent-sku', parentSku: 'parent-sku' },
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

test('includes the selected recurring occurrence in the intent payload', async () => {
  let intentPayload;
  const occurrence = {
    occurrenceId: 'occurrence-1',
    localDate: '2026-08-01',
    startTime: '10:00',
    endTime: '12:00',
    timezone: 'Australia/Sydney',
  };
  const cartApi = {
    addProductsToCart: async () => ({
      items: [{ sku: 'event-sku', topLevelSku: 'event-sku', uid: 'line-uid' }],
    }),
    fetchGraphQl: async (query) => query.includes('SetBookingIntent')
      ? setAttributeResponse('intent-ref', 'line-uid', occurrence)
      : cartLinesResponse(),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
    refreshCart: async () => null,
    updateProductsFromCart: async () => null,
  };

  await addCorrelatedEventProduct({
    cartApi,
    commerceSku: 'event-sku',
    createIntent: async (payload) => {
      intentPayload = payload;
      return { intentRef: 'intent-ref' };
    },
    eventAllocationId: 'allocation-1',
    eventId: 'event-id',
    form,
    occurrence,
    occurrenceId: occurrence.occurrenceId,
    pendingSubmission: createPending(),
    values: { quantity: 1, sku: 'event-sku' },
  });

  assert.equal(intentPayload.occurrence_id, 'occurrence-1');
});

test('fails closed when a recurring occurrence shares an existing child SKU line', async () => {
  let createIntentCalls = 0;
  const occurrence = {
    occurrenceId: 'occurrence-2',
    localDate: '2026-08-08',
    startTime: '10:00',
    endTime: '12:00',
    timezone: 'Australia/Sydney',
  };
  const cartApi = {
    fetchGraphQl: async () => cartLinesResponse([
      cartLine({ intentRef: 'existing-intent' }),
    ]),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
  };

  await assert.rejects(
    addCorrelatedEventProduct({
      cartApi,
      commerceSku: 'event-sku',
      createIntent: async () => {
        createIntentCalls += 1;
        return { intentRef: 'unexpected' };
      },
      eventAllocationId: 'allocation-1',
      eventId: 'event-id',
      form,
      occurrence,
      occurrenceId: occurrence.occurrenceId,
      pendingSubmission: createPending(),
      values: { quantity: 1, sku: 'event-sku' },
    }),
    (error) => error.type === EVENT_APP_ERROR_TYPES.INTEGRITY,
  );
  assert.equal(createIntentCalls, 0);
});

test('preserves the canonical Commerce SKU case in the create-intent payload', async () => {
  let addedItem;
  const cartApi = {
    addProductsToCart: async ([item]) => {
      addedItem = item;
      return {
        items: [{
          sku: 'Event-SKU',
          topLevelSku: 'Event-SKU',
          uid: 'line-uid',
        }],
      };
    },
    fetchGraphQl: async (query) => (
      query.includes('SetBookingIntent')
        ? setAttributeResponse()
        : cartLinesResponse()
    ),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
    refreshCart: async () => null,
    updateProductsFromCart: async () => null,
  };

  await addCorrelatedEventProduct({
    cartApi,
    commerceSku: 'event-sku',
    commerceSku: 'Event-SKU',
    createIntent: async (payload) => {
      assert.equal(payload.commerce_sku, 'Event-SKU');
      return { intentRef: 'intent-ref' };
    },
    eventId: 'event-id',
    eventAllocationId: 'allocation-1',
    form,
    pendingSubmission: createPending(),
    values: { quantity: 1, sku: 'event-sku' },
  });

  assert.equal(addedItem.sku, 'Event-SKU');
});

test('merges an existing correlated allocation and increases its cart quantity', async () => {
  let createIntentCalls = 0;
  const updatedItems = [];
  const cartApi = {
    addProductsToCart: async () => { throw new Error('must not add'); },
    createGuestCart: async () => 'unused',
    fetchGraphQl: async (query) => query.includes('SetBookingIntent')
      ? setAttributeResponse('existing-intent')
      : cartLinesResponse([cartLine({ intentRef: 'existing-intent' })]),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
    refreshCart: async () => null,
    updateProductsFromCart: async (items) => { updatedItems.push(...items); },
  };

  const pendingSubmission = createPending();
  await addCorrelatedEventProduct({
    cartApi,
    commerceSku: 'event-sku',
    createIntent: async (payload) => {
      createIntentCalls += 1;
      assert.equal(payload.event_allocation_id, 'allocation-1');
      return { intentRef: 'existing-intent' };
    },
    eventAllocationId: 'allocation-1',
    eventId: 'event-id',
    form,
    pendingSubmission,
    values: { quantity: 1, sku: 'event-sku' },
  });
  assert.equal(createIntentCalls, 1);
  assert.deepEqual(updatedItems, [{ quantity: 2, uid: 'line-uid' }]);
  assert.equal(pendingSubmission.stage, 'correlated');
});

test('repairs merged cart quantity without replaying the intent request', async () => {
  let createIntentCalls = 0;
  let updateCalls = 0;
  const cartApi = {
    fetchGraphQl: async (query) => query.includes('SetBookingIntent')
      ? setAttributeResponse('existing-intent')
      : cartLinesResponse([cartLine({ intentRef: 'existing-intent' })]),
    initializeCart: async () => ({ id: 'cart-id', items: [] }),
    refreshCart: async () => null,
    updateProductsFromCart: async () => {
      updateCalls += 1;
      if (updateCalls === 1) throw new Error('cart unavailable');
    },
  };
  const pendingSubmission = createPending();
  const input = {
    cartApi,
    commerceSku: 'event-sku',
    createIntent: async () => {
      createIntentCalls += 1;
      return { intentRef: 'existing-intent' };
    },
    eventAllocationId: 'allocation-1',
    eventId: 'event-id',
    form,
    pendingSubmission,
    values: { quantity: 1, sku: 'event-sku' },
  };

  await assert.rejects(
    addCorrelatedEventProduct(input),
    (error) => error.type === EVENT_APP_ERROR_TYPES.UNAVAILABLE
      && error.retryable,
  );
  await addCorrelatedEventProduct(input);

  assert.equal(createIntentCalls, 1);
  assert.equal(updateCalls, 2);
  assert.equal(pendingSubmission.targetCartQuantity, 2);
  assert.equal(pendingSubmission.stage, 'correlated');
});

test('blocks an uncorrelated existing child line before creating an intent', async () => {
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
      eventAllocationId: 'allocation-1',
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
    commerceSku: 'event-sku',
    createIntent: async () => {
      createIntentCalls += 1;
    },
    eventId: 'event-id',
    eventAllocationId: 'allocation-1',
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
  let lineReads = 0;
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
      lineReads += 1;
      return lineReads <= 2 ? cartLinesResponse() : cartLinesResponse([cartLine()]);
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
    commerceSku: 'event-sku',
    createIntent: async () => {
      throw new Error('must not create another intent');
    },
    eventId: 'event-id',
    eventAllocationId: 'allocation-1',
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
      commerceSku: 'event-sku',
      createIntent: async () => {
        throw new Error('must not create another intent');
      },
    eventId: 'event-id',
    eventAllocationId: 'allocation-1',
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
