import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBookingForm,
  validateBookingForm,
  validateBookingReference,
} from '../../scripts/event-app/validation.js';

const validForm = {
  consent: true,
  contact: {
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
  attendees: [
    { firstName: 'Ada', lastName: 'Lovelace' },
    { firstName: 'Grace', lastName: 'Hopper' },
  ],
  quantity: 2,
};

test('validates and normalizes the exact booking form shape', () => {
  assert.equal(validateBookingForm(validForm).valid, true);
  assert.deepEqual(normalizeBookingForm({
    ...validForm,
    contact: {
      email: ' ada@example.com ',
      firstName: ' Ada ',
      lastName: ' Lovelace ',
    },
  }).contact, {
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
  });
});

test('rejects attendee mismatch, extra contact fields, and missing consent', () => {
  const result = validateBookingForm({
    ...validForm,
    consent: false,
    contact: {
      ...validForm.contact,
      telephone: 'not-approved',
    },
    attendees: validForm.attendees.slice(0, 1),
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.contact);
  assert.ok(result.errors.consent);
  assert.ok(result.errors.attendees);
});

test('requires a high-entropy base64url-style booking reference', () => {
  assert.equal(validateBookingReference('short'), false);
  assert.equal(validateBookingReference('a'.repeat(43)), true);
  assert.equal(validateBookingReference(`${'a'.repeat(42)}!`), false);
});
