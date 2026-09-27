import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_APP_ERROR_TYPES,
  mapEventAppStatusToError,
} from '../../scripts/event-app/errors.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';

test('maps create-intent HTTP 409 to a duplicate booking error', () => {
  const error = mapEventAppStatusToError(409);
  assert.equal(error.type, EVENT_APP_ERROR_TYPES.DUPLICATE);
  assert.equal(error.status, 409);
  assert.equal(error.retryable, false);
});

test('requests recurring availability for one allocation and preserves date bounds', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let requestUrl;
  globalThis.window = {
    clearTimeout: (timeoutId) => clearTimeout(timeoutId),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
  };
  globalThis.fetch = async (url) => {
    requestUrl = new URL(url);
    return {
      headers: { get: () => 'application/json' },
      json: async () => ({
        event: {
          age_requirement: '18+',
          event_id: 'event-1',
          organizer: 'Demo Events',
          tags: ['demo'],
          timezone: 'Australia/Sydney',
          venue: {
            address: {
              city: 'Sydney',
              country_code: 'AU',
              lines: ['1 Demo Street'],
            },
            name: 'Demo Hall',
            venue_id: 'venue-1',
          },
          schedule_type: 'recurring',
          recurrence: {
            daily_end_time: '18:00',
            daily_start_time: '09:00',
            end_date: '2026-08-15',
            excluded_dates: [],
            session_duration_minutes: 120,
            start_date: '2026-08-01',
            weekdays: [1, 3, 5, 6],
          },
          allocations: [{
            allocated_capacity: 10,
            available_quantity: 8,
            commerce_sku: 'event-child-1',
            event_allocation_id: 'allocation-1',
            occurrences: [],
            space: { name: 'Room A', space_id: 'space-1' },
            zone: { name: 'Front', zone_id: 'zone-1' },
          }],
        },
      }),
      ok: true,
    };
  };

  try {
    const client = createEventAppClient({
      actions: {
        availability: {
          encoding: 'query',
          method: 'GET',
          url: 'https://events.example/availability',
        },
      },
      enabled: true,
      timeout: 1000,
    });
    const event = await client.getAvailability('event-1', {
      eventAllocationId: 'allocation-1',
      from: '2026-08-01',
      to: '2026-08-15',
    });

    assert.equal(event.allocations[0].eventAllocationId, 'allocation-1');
    assert.equal(requestUrl.searchParams.get('external_event_id'), 'event-1');
    assert.equal(requestUrl.searchParams.get('event_allocation_id'), 'allocation-1');
    assert.equal(requestUrl.searchParams.get('from'), '2026-08-01');
    assert.equal(requestUrl.searchParams.get('to'), '2026-08-15');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
