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
