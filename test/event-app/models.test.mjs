import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getCommerceAttribute,
  getExternalEventId,
  isEventProduct,
  normalizeEventMap,
  normalizeIntentResponse,
  normalizePublicBooking,
  normalizePublicEvent,
} from '../../scripts/event-app/models.js';

const publicEvent = {
  age_requirement: '18+',
  ends_at_utc: '2026-08-01T04:00:00.000Z',
  event_id: 'event-1',
  organizer: 'Demo Events',
  starts_at_utc: '2026-08-01T02:00:00.000Z',
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
  allocations: [{
    allocated_capacity: 10,
    available_quantity: 8,
    commerce_sku: 'event-child-1',
    event_allocation_id: 'allocation-1',
    space: { name: 'Room A', space_id: 'space-1' },
    zone: { name: 'Front', zone_id: 'zone-1' },
  }],
};

const recurringEvent = {
  ...publicEvent,
  ends_at_utc: '2026-08-15T04:00:00.000Z',
  schedule_type: 'recurring',
  recurrence: {
    daily_end_time: '18:00',
    daily_start_time: '09:00',
    end_date: '2026-08-15',
    excluded_dates: ['2026-08-08'],
    session_duration_minutes: 120,
    start_date: '2026-08-01',
    weekdays: [1, 3, 5, 6],
  },
  allocations: [{
    ...publicEvent.allocations[0],
    occurrences: [{
      available_quantity: 4,
      end_time: '12:00',
      ends_at_utc: '2026-08-01T04:00:00.000Z',
      local_date: '2026-08-01',
      occurrence_id: 'occurrence-1',
      start_time: '10:00',
      starts_at_utc: '2026-08-01T02:00:00.000Z',
      timezone: 'Australia/Sydney',
    }],
  }],
};

test('reads event identifiers from supported Commerce attribute shapes', () => {
  const product = {
    attributes: [
      { name: 'is_event_ticket', value: 'Yes' },
      { id: 'external_event_id', value: ' event-1 ' },
    ],
  };

  assert.equal(getCommerceAttribute(product, 'is_event_ticket'), 'Yes');
  assert.equal(isEventProduct(product), true);
  assert.equal(getExternalEventId(product), 'event-1');
});

test('reads cart drop-in display codes and selected option values', () => {
  const product = {
    attributes: [
      {
        code: 'Is Event Ticket',
        selected_options: [{ label: 'Yes', value: '1' }],
      },
      { code: 'External Event Id', value: ' event-2 ' },
    ],
  };

  assert.equal(getCommerceAttribute(product, 'is_event_ticket'), '1');
  assert.equal(isEventProduct(product), true);
  assert.equal(getExternalEventId(product), 'event-2');
});

test('falls back to a selected option label when no option value is present', () => {
  const product = {
    attributes: [{
      code: 'Is Event Ticket',
      selected_options: [{ label: 'Yes' }],
    }],
  };

  assert.equal(getCommerceAttribute(product, 'is_event_ticket'), 'Yes');
  assert.equal(isEventProduct(product), true);
});

test('normalizes a strict public event and keyed enrichment map', () => {
  const event = normalizePublicEvent(publicEvent, 'event-1');
  assert.equal(event.eventId, 'event-1');
  assert.deepEqual(event.venue, {
    address: '1 Demo Street, Sydney, AU',
    addressLines: ['1 Demo Street'],
    city: 'Sydney',
    countryCode: 'AU',
    id: 'venue-1',
    name: 'Demo Hall',
  });
  assert.deepEqual(event.allocations[0], {
    allocatedCapacity: 10,
    availableQuantity: 8,
    commerceSku: 'event-child-1',
    eventAllocationId: 'allocation-1',
    space: { id: 'space-1', name: 'Room A' },
    zone: { id: 'zone-1', name: 'Front' },
  });

  const events = normalizeEventMap({
    'event-1': publicEvent,
    unexpected: { ...publicEvent, event_id: 'unexpected' },
  }, ['event-1']);
  assert.deepEqual([...events.keys()], ['event-1']);
});

test('normalizes recurring schedule metadata and occurrence availability', () => {
  const event = normalizePublicEvent(recurringEvent, 'event-1');

  assert.equal(event.scheduleType, 'recurring');
  assert.equal(event.endsAtUtc, null);
  assert.deepEqual(event.recurrence, {
    dailyEndTime: '18:00',
    dailyStartTime: '09:00',
    endDate: '2026-08-15',
    excludedDates: ['2026-08-08'],
    sessionDurationMinutes: 120,
    startDate: '2026-08-01',
    weekdays: [1, 3, 5, 6],
  });
  assert.deepEqual(event.allocations[0].occurrences, [{
    availableQuantity: 4,
    endTime: '12:00',
    endsAtUtc: '2026-08-01T04:00:00.000Z',
    localDate: '2026-08-01',
    occurrenceId: 'occurrence-1',
    startTime: '10:00',
    startsAtUtc: '2026-08-01T02:00:00.000Z',
    timezone: 'Australia/Sydney',
  }]);
});

test('allows recurring events to omit top-level schedule timestamps', () => {
  const eventWithoutTopLevelSchedule = Object.fromEntries(
    Object.entries(recurringEvent).filter(
      ([key]) => !['starts_at_utc', 'ends_at_utc'].includes(key),
    ),
  );
  const event = normalizePublicEvent(eventWithoutTopLevelSchedule, 'event-1');

  assert.equal(event.startsAtUtc, null);
  assert.equal(event.endsAtUtc, null);
  assert.equal(event.allocations[0].occurrences[0].startsAtUtc, '2026-08-01T02:00:00.000Z');
});

test('rejects public events without schema-v2 allocations', () => {
  const legacyEvent = Object.fromEntries(
    Object.entries(publicEvent).filter(([key]) => key !== 'allocations'),
  );

  assert.throws(() => normalizePublicEvent(legacyEvent, 'event-1'));
});

test('allows recurring events to source their end timestamp from occurrences', () => {
  const eventWithoutTopLevelEnd = Object.fromEntries(
    Object.entries(recurringEvent).filter(([key]) => key !== 'ends_at_utc'),
  );
  const event = normalizePublicEvent(eventWithoutTopLevelEnd, 'event-1');

  assert.equal(event.endsAtUtc, null);
  assert.equal(event.allocations[0].occurrences[0].endsAtUtc, '2026-08-01T04:00:00.000Z');
});

test('requires the persisted event end timestamp for one-time events', () => {
  const eventWithoutTopLevelEnd = Object.fromEntries(
    Object.entries(publicEvent).filter(([key]) => key !== 'ends_at_utc'),
  );

  assert.throws(() => normalizePublicEvent(eventWithoutTopLevelEnd, 'event-1'));
});

test('allows the public event organizer to be omitted', () => {
  const { organizer, ...eventWithoutOrganizer } = publicEvent;
  const event = normalizePublicEvent(eventWithoutOrganizer, 'event-1');

  assert.equal(organizer, 'Demo Events');
  assert.equal(event.organizer, null);
});

test('rejects unexpected event and intent response fields', () => {
  assert.throws(() => normalizePublicEvent({
    ...publicEvent,
    description: 'Commerce owns this field',
  }));
  assert.throws(() => normalizePublicEvent({
    ...publicEvent,
    allocations: [],
  }));
  assert.throws(() => normalizePublicEvent({
    ...publicEvent,
    venue: {
      address: 'legacy address',
      name: 'Demo Hall',
    },
  }));
  assert.throws(() => normalizePublicEvent({
    ...publicEvent,
    allocations: [
      publicEvent.allocations[0],
      publicEvent.allocations[0],
    ],
  }));
  assert.throws(() => normalizeIntentResponse({
    intent_ref: 'intent',
    internal_id: 'forbidden',
    status: 'awaiting_order',
  }));
  assert.throws(() => normalizePublicEvent({
    ...recurringEvent,
    recurrence: {
      ...recurringEvent.recurrence,
      excluded_dates: ['2026-08-16'],
    },
  }));
  assert.throws(() => normalizePublicEvent({
    ...recurringEvent,
    allocations: [{
      ...recurringEvent.allocations[0],
      occurrences: [
        recurringEvent.allocations[0].occurrences[0],
        recurringEvent.allocations[0].occurrences[0],
      ],
    }],
  }));
  assert.throws(() => normalizePublicEvent({
    ...recurringEvent,
    allocations: [{
      ...recurringEvent.allocations[0],
      occurrences: [{
        ...recurringEvent.allocations[0].occurrences[0],
        timezone: 'UTC',
      }],
    }],
  }));
});

test('accepts only the approved public booking projection', () => {
  const booking = normalizePublicBooking({
    booking_ref: 'booking-reference',
    order_increment_id: '000001',
    status: 'confirmed',
    tickets: [{
      qr_render_url: 'https://tickets.example/qr/opaque',
      status: 'active',
      ticket_ref: 'ticket-reference',
    }],
  }, ['https://tickets.example']);

  assert.equal(booking.tickets[0].qrRenderUrl, 'https://tickets.example/qr/opaque');

  assert.throws(() => normalizePublicBooking({
    booking_ref: 'booking-reference',
    intent_ref: 'must-not-be-public',
    status: 'confirmed',
    tickets: [],
  }, ['https://tickets.example']));
});

test('rejects QR URLs outside the approved HTTPS origins', () => {
  assert.throws(() => normalizePublicBooking({
    booking_ref: 'booking-reference',
    status: 'confirmed',
    tickets: [{
      qr_render_url: 'https://unapproved.example/qr/opaque',
      status: 'active',
      ticket_ref: 'ticket-reference',
    }],
  }, ['https://tickets.example']));
});
