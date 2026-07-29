import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_APP_ERROR_TYPES,
  mapEventAppStatusToError,
} from '../../scripts/event-app/errors.js';

test('maps create-intent HTTP 409 to a duplicate booking error', () => {
  const error = mapEventAppStatusToError(409);
  assert.equal(error.type, EVENT_APP_ERROR_TYPES.DUPLICATE);
  assert.equal(error.status, 409);
  assert.equal(error.retryable, false);
});
