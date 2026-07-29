import assert from 'node:assert/strict';
import test from 'node:test';

import { formatEventDateRange } from '../../scripts/event-app/dates.js';

test('formats the event range in the supplied event timezone', () => {
  const formatted = formatEventDateRange({
    endsAtUtc: '2026-08-01T04:00:00.000Z',
    startsAtUtc: '2026-08-01T02:00:00.000Z',
    timezone: 'Australia/Sydney',
  }, 'en-AU');

  assert.match(formatted, /1 Aug 2026/);
  assert.match(formatted, /12:00/);
  assert.match(formatted, /2:00/);
});
