import assert from 'node:assert/strict';
import test from 'node:test';

import { createEventCartRemovalController } from '../../scripts/event-app/cart-removal.js';

const eventItem = Object.freeze({
  name: 'Event ticket',
  productAttributes: [{ code: 'is_event_ticket', value: '1' }],
  sku: 'EVT-204186505',
  topLevelSku: 'EVT-204186505',
  uid: 'item-uid',
});

function createController(overrides = {}) {
  return createEventCartRemovalController({
    cancelIntent: async () => null,
    fetchCartLines: async () => [{
      bookingIntentRef: 'opaque-intent',
      sku: 'EVT-204186505',
      uid: 'item-uid',
    }],
    getCart: () => ({ id: 'cart-id' }),
    removeItem: async () => ({ id: 'cart-id', items: [] }),
    ...overrides,
  });
}

test('cancels with exact correlation values after Commerce removal succeeds', async () => {
  const calls = [];
  const controller = createController({
    cancelIntent: async (payload) => calls.push(['cancel', payload]),
    removeItem: async () => calls.push(['remove']),
  });

  await controller.remove(eventItem);

  assert.deepEqual(calls, [
    ['remove'],
    ['cancel', {
      commerce_cart_id: 'cart-id',
      commerce_sku: 'EVT-204186505',
      intent_ref: 'opaque-intent',
    }],
  ]);
});

test('does not cancel when Commerce removal fails', async () => {
  let cancellationCalls = 0;
  const controller = createController({
    cancelIntent: async () => {
      cancellationCalls += 1;
    },
    removeItem: async () => {
      throw new Error('Commerce removal failed');
    },
  });

  await assert.rejects(controller.remove(eventItem), /Commerce removal failed/);
  assert.equal(cancellationCalls, 0);
});

test('ordinary products use standard removal without correlation lookup', async () => {
  let fetchCalls = 0;
  let removeCalls = 0;
  const controller = createController({
    fetchCartLines: async () => {
      fetchCalls += 1;
      return [];
    },
    removeItem: async () => {
      removeCalls += 1;
    },
  });

  await controller.remove({
    productAttributes: [],
    sku: 'ordinary-sku',
    uid: 'ordinary-uid',
  });

  assert.equal(fetchCalls, 0);
  assert.equal(removeCalls, 1);
});

test('cancellation retry never removes the cart item a second time', async () => {
  let cancellationCalls = 0;
  let removeCalls = 0;
  let retry;
  const controller = createController({
    cancelIntent: async () => {
      cancellationCalls += 1;
      if (cancellationCalls === 1) throw new Error('temporary failure');
    },
    onCancellationError: (state) => {
      retry = state.retry;
    },
    removeItem: async () => {
      removeCalls += 1;
    },
  });

  await controller.remove(eventItem);
  assert.equal(typeof retry, 'function');
  await retry();

  assert.equal(removeCalls, 1);
  assert.equal(cancellationCalls, 2);
});

test('event items without a booking reference are removed without cancellation', async () => {
  let cancellationCalls = 0;
  const controller = createController({
    cancelIntent: async () => {
      cancellationCalls += 1;
    },
    fetchCartLines: async () => [{
      bookingIntentRef: null,
      sku: 'EVT-204186505',
      uid: 'item-uid',
    }],
  });

  await controller.remove(eventItem);
  assert.equal(cancellationCalls, 0);
});
