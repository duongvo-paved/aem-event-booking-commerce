const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOKING_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(value, fields) {
  return (
    isPlainObject(value)
    && Object.keys(value).sort().join(',') === [...fields].sort().join(',')
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateBookingReference(value) {
  return (
    typeof value === 'string'
    && BOOKING_REFERENCE_PATTERN.test(value)
  );
}

export function validateBookingForm(value, maximumQuantity = 20) {
  const errors = {};
  if (
    !Number.isInteger(value?.quantity)
    || value.quantity < 1
    || value.quantity > maximumQuantity
  ) {
    errors.quantity = `Choose between 1 and ${maximumQuantity} tickets.`;
  }

  const contactFields = ['email', 'firstName', 'lastName'];
  if (!hasExactFields(value?.contact, contactFields)) {
    errors.contact = 'Enter the required booking contact details.';
  } else {
    if (!isNonEmptyString(value.contact.firstName)) {
      errors.contactFirstName = 'Enter the contact first name.';
    }
    if (!isNonEmptyString(value.contact.lastName)) {
      errors.contactLastName = 'Enter the contact last name.';
    }
    if (
      !isNonEmptyString(value.contact.email)
      || !EMAIL_PATTERN.test(value.contact.email)
    ) {
      errors.contactEmail = 'Enter a valid contact email address.';
    }
  }

  if (
    !Array.isArray(value?.participants)
    || value.participants.length !== value?.quantity
  ) {
    errors.participants = 'Enter one participant for each ticket.';
  } else {
    value.participants.forEach((participant, index) => {
      if (!hasExactFields(participant, ['firstName', 'lastName'])) {
        errors[`participant-${index}`] = 'Enter the participant details.';
        return;
      }
      if (!isNonEmptyString(participant.firstName)) {
        errors[`participant-${index}-firstName`] = 'Enter the first name.';
      }
      if (!isNonEmptyString(participant.lastName)) {
        errors[`participant-${index}-lastName`] = 'Enter the last name.';
      }
    });
  }

  if (value?.consent !== true) {
    errors.consent = 'Consent is required to continue.';
  }

  return Object.freeze({
    errors: Object.freeze(errors),
    valid: Object.keys(errors).length === 0,
  });
}

export function normalizeBookingForm(value) {
  return Object.freeze({
    consent: true,
    contact: Object.freeze({
      email: value.contact.email.trim(),
      firstName: value.contact.firstName.trim(),
      lastName: value.contact.lastName.trim(),
    }),
    participants: Object.freeze(value.participants.map((participant) => Object.freeze({
      firstName: participant.firstName.trim(),
      lastName: participant.lastName.trim(),
    }))),
    quantity: value.quantity,
  });
}
