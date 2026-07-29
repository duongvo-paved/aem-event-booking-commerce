import { formatEventDateRange } from '../../scripts/event-app/dates.js';
import {
  EVENT_APP_ERROR_TYPES,
  getSafeErrorMessage,
} from '../../scripts/event-app/errors.js';
import {
  normalizeBookingForm,
  validateBookingForm,
} from '../../scripts/event-app/validation.js';

const MAXIMUM_DEMO_QUANTITY = 20;

function getLabel(labels, key, fallback) {
  return labels.Global?.[key] || fallback;
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createField({
  autocomplete,
  id,
  label,
  name,
  required = true,
  type = 'text',
}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'event-booking__field';

  const labelElement = document.createElement('label');
  labelElement.htmlFor = id;
  labelElement.textContent = label;

  const input = document.createElement('input');
  input.autocomplete = autocomplete;
  input.id = id;
  input.name = name;
  input.required = required;
  input.type = type;

  const error = document.createElement('span');
  error.className = 'event-booking__field-error';
  error.id = `${id}-error`;
  error.setAttribute('aria-live', 'polite');

  input.setAttribute('aria-describedby', error.id);
  wrapper.append(labelElement, input, error);
  return { error, input, wrapper };
}

function setInputError(field, message) {
  field.error.textContent = message || '';
  field.input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function readPrice(product) {
  const amount = product?.prices?.final?.amount
    ?? product?.price?.final?.amount?.value;
  const currency = product?.prices?.final?.currency
    ?? product?.price?.final?.amount?.currency;
  if (!Number.isFinite(amount) || typeof currency !== 'string') return null;
  return { amount, currency };
}

function formatPrice(price, quantity = 1) {
  if (!price) return '';
  return new Intl.NumberFormat(document.documentElement.lang || 'en', {
    currency: price.currency,
    style: 'currency',
  }).format(price.amount * quantity);
}

function createMetadata(event, labels) {
  const section = document.createElement('section');
  section.className = 'event-booking__metadata';
  section.setAttribute('aria-labelledby', 'event-details-heading');

  const heading = createTextElement(
    'h2',
    'event-booking__heading',
    getLabel(labels, 'EventDetailsHeading', 'Event details'),
  );
  heading.id = 'event-details-heading';

  const list = document.createElement('dl');
  const rows = [
    [getLabel(labels, 'EventDateLabel', 'Date and time'), formatEventDateRange(event)],
    [getLabel(labels, 'EventVenueLabel', 'Venue'), event.venue.name],
    [getLabel(labels, 'EventAddressLabel', 'Address'), event.venue.address],
    [getLabel(labels, 'EventOrganizerLabel', 'Organizer'), event.organizer],
  ];
  if (event.ageRequirement) {
    rows.push([
      getLabel(labels, 'EventAgeRequirementLabel', 'Age requirement'),
      event.ageRequirement,
    ]);
  }
  if (event.tags.length) {
    rows.push([
      getLabel(labels, 'EventTagsLabel', 'Tags'),
      event.tags.join(', '),
    ]);
  }

  rows.forEach(([term, description]) => {
    list.append(
      createTextElement('dt', 'event-booking__metadata-label', term),
      createTextElement('dd', 'event-booking__metadata-value', description),
    );
  });

  section.append(heading, list);
  return section;
}

function createOrderSummary(product, event, labels) {
  const price = readPrice(product);
  const section = document.createElement('section');
  section.className = 'event-booking__summary';
  section.setAttribute('aria-labelledby', 'event-order-summary-heading');

  const heading = createTextElement(
    'h2',
    'event-booking__heading',
    getLabel(labels, 'EventOrderSummaryHeading', 'Order summary'),
  );
  heading.id = 'event-order-summary-heading';

  const list = document.createElement('dl');
  const values = {
    product: createTextElement('dd', 'event-booking__summary-value', product.name),
    quantity: createTextElement('dd', 'event-booking__summary-value', '1'),
    schedule: createTextElement(
      'dd',
      'event-booking__summary-value',
      formatEventDateRange(event),
    ),
    total: createTextElement(
      'dd',
      'event-booking__summary-value',
      formatPrice(price),
    ),
    unitPrice: createTextElement(
      'dd',
      'event-booking__summary-value',
      formatPrice(price),
    ),
    venue: createTextElement(
      'dd',
      'event-booking__summary-value',
      `${event.venue.name}, ${event.venue.address}`,
    ),
  };

  [
    [getLabel(labels, 'EventProductLabel', 'Event'), values.product],
    [getLabel(labels, 'EventDateLabel', 'Date and time'), values.schedule],
    [getLabel(labels, 'EventVenueLabel', 'Venue'), values.venue],
    [getLabel(labels, 'EventQuantityLabel', 'Tickets'), values.quantity],
    [getLabel(labels, 'EventUnitPriceLabel', 'Price per ticket'), values.unitPrice],
    [getLabel(labels, 'EventTotalLabel', 'Total'), values.total],
  ].forEach(([term, value]) => {
    list.append(
      createTextElement('dt', 'event-booking__summary-label', term),
      value,
    );
  });

  section.append(heading, list);
  return {
    element: section,
    update(quantity) {
      values.quantity.textContent = String(quantity);
      values.total.textContent = formatPrice(price, quantity);
    },
  };
}

function createParticipantFields(index, labels) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'event-booking__participant';
  const legend = document.createElement('legend');
  legend.textContent = `${getLabel(labels, 'EventParticipantLabel', 'Participant')} ${index + 1}`;

  const firstName = createField({
    autocomplete: 'off',
    id: `event-participant-${index}-first-name`,
    label: getLabel(labels, 'EventFirstNameLabel', 'First name'),
    name: `participant-${index}-firstName`,
  });
  const lastName = createField({
    autocomplete: 'off',
    id: `event-participant-${index}-last-name`,
    label: getLabel(labels, 'EventLastNameLabel', 'Last name'),
    name: `participant-${index}-lastName`,
  });

  fieldset.append(legend, firstName.wrapper, lastName.wrapper);
  return {
    element: fieldset,
    firstName,
    lastName,
    read() {
      return {
        firstName: firstName.input.value,
        lastName: lastName.input.value,
      };
    },
  };
}

export function renderEventUnavailable(container, labels, message) {
  container.replaceChildren();
  const status = createTextElement(
    'p',
    'event-booking__unavailable',
    message || getLabel(
      labels,
      'EventBookingUnavailable',
      'Event booking is not available right now.',
    ),
  );
  status.setAttribute('role', 'status');
  container.append(status);
}

export function renderEventBooking({
  addToCart,
  cartUrl,
  container,
  event,
  labels,
  product,
}) {
  let quantity = 1;
  let participants = [];
  let pendingSubmission = null;

  const metadata = createMetadata(event, labels);
  const form = document.createElement('form');
  form.className = 'event-booking__form';
  form.noValidate = true;

  const formHeading = createTextElement(
    'h2',
    'event-booking__heading',
    getLabel(labels, 'EventBookingHeading', 'Booking details'),
  );
  formHeading.id = 'event-booking-heading';
  form.setAttribute('aria-labelledby', formHeading.id);

  const feedback = createTextElement('div', 'event-booking__feedback', '');
  feedback.setAttribute('aria-live', 'assertive');
  feedback.setAttribute('role', 'status');

  const contact = document.createElement('fieldset');
  contact.className = 'event-booking__contact';
  const contactLegend = document.createElement('legend');
  contactLegend.textContent = getLabel(
    labels,
    'EventBookingContactHeading',
    'Booking contact',
  );
  const contactFirstName = createField({
    autocomplete: 'given-name',
    id: 'event-contact-first-name',
    label: getLabel(labels, 'EventFirstNameLabel', 'First name'),
    name: 'contact-firstName',
  });
  const contactLastName = createField({
    autocomplete: 'family-name',
    id: 'event-contact-last-name',
    label: getLabel(labels, 'EventLastNameLabel', 'Last name'),
    name: 'contact-lastName',
  });
  const contactEmail = createField({
    autocomplete: 'email',
    id: 'event-contact-email',
    label: getLabel(labels, 'EventEmailLabel', 'Email'),
    name: 'contact-email',
    type: 'email',
  });
  contact.append(
    contactLegend,
    contactFirstName.wrapper,
    contactLastName.wrapper,
    contactEmail.wrapper,
  );

  const participantsContainer = document.createElement('div');
  participantsContainer.className = 'event-booking__participants';
  participantsContainer.setAttribute('aria-live', 'polite');

  const consentWrapper = document.createElement('div');
  consentWrapper.className = 'event-booking__consent';
  const consent = document.createElement('input');
  consent.id = 'event-booking-consent';
  consent.name = 'consent';
  consent.required = true;
  consent.type = 'checkbox';
  const consentLabel = document.createElement('label');
  consentLabel.htmlFor = consent.id;
  consentLabel.textContent = getLabel(
    labels,
    'EventConsentLabel',
    'I consent to the use of these details to process this demo booking.',
  );
  const consentError = createTextElement(
    'span',
    'event-booking__field-error',
    '',
  );
  consentError.id = 'event-booking-consent-error';
  consentError.setAttribute('aria-live', 'polite');
  consent.setAttribute('aria-describedby', consentError.id);
  consentWrapper.append(consent, consentLabel, consentError);

  const summary = createOrderSummary(product, event, labels);

  const submit = document.createElement('button');
  submit.className = 'button event-booking__submit';
  submit.type = 'submit';
  submit.textContent = getLabel(labels, 'EventAddToCartLabel', 'Book and add to cart');

  function renderParticipants(nextQuantity) {
    const previousValues = participants.map((participant) => participant.read());
    participants = Array.from(
      { length: nextQuantity },
      (_, index) => createParticipantFields(index, labels),
    );
    participants.forEach((participant, index) => {
      const previous = previousValues[index];
      if (previous) {
        participant.firstName.input.value = previous.firstName;
        participant.lastName.input.value = previous.lastName;
      }
    });
    participantsContainer.replaceChildren(
      ...participants.map((participant) => participant.element),
    );
  }

  function readForm() {
    return {
      consent: consent.checked,
      contact: {
        email: contactEmail.input.value,
        firstName: contactFirstName.input.value,
        lastName: contactLastName.input.value,
      },
      participants: participants.map((participant) => participant.read()),
      quantity,
    };
  }

  function clearErrors() {
    feedback.textContent = '';
    setInputError(contactFirstName, '');
    setInputError(contactLastName, '');
    setInputError(contactEmail, '');
    participants.forEach((participant) => {
      setInputError(participant.firstName, '');
      setInputError(participant.lastName, '');
    });
    consentError.textContent = '';
    consent.setAttribute('aria-invalid', 'false');
  }

  function showSubmissionError(error) {
    feedback.textContent = getSafeErrorMessage(error);
    if (
      cartUrl
      && [
        EVENT_APP_ERROR_TYPES.DUPLICATE,
        EVENT_APP_ERROR_TYPES.INTEGRITY,
      ].includes(error?.type)
    ) {
      const separator = document.createTextNode(' ');
      const link = document.createElement('a');
      link.href = cartUrl;
      link.textContent = getLabel(labels, 'EventViewCartLabel', 'View cart');
      feedback.append(separator, link);
    }
  }

  function showErrors(errors) {
    setInputError(contactFirstName, errors.contactFirstName);
    setInputError(contactLastName, errors.contactLastName);
    setInputError(contactEmail, errors.contactEmail);
    participants.forEach((participant, index) => {
      setInputError(
        participant.firstName,
        errors[`participant-${index}-firstName`]
          || errors[`participant-${index}`],
      );
      setInputError(
        participant.lastName,
        errors[`participant-${index}-lastName`]
          || errors[`participant-${index}`],
      );
    });
    consentError.textContent = errors.consent || '';
    consent.setAttribute('aria-invalid', errors.consent ? 'true' : 'false');

    const firstInvalid = form.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
  }

  function clearForm() {
    form.reset();
    quantity = 1;
    renderParticipants(quantity);
    summary.update(quantity);
    pendingSubmission = null;
  }

  form.addEventListener('input', () => {
    const currentSignature = JSON.stringify(readForm());
    if (pendingSubmission?.signature !== currentSignature) {
      pendingSubmission = null;
    }
  });

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    clearErrors();

    const rawForm = readForm();
    const validation = validateBookingForm(rawForm, MAXIMUM_DEMO_QUANTITY);
    if (!validation.valid) {
      feedback.textContent = getLabel(
        labels,
        'EventBookingValidationError',
        'Check the highlighted booking details.',
      );
      showErrors(validation.errors);
      return;
    }

    const normalizedForm = normalizeBookingForm(rawForm);
    const signature = JSON.stringify(normalizedForm);
    if (!pendingSubmission || pendingSubmission.signature !== signature) {
      pendingSubmission = {
        cartId: null,
        cartItemUid: null,
        intentRef: null,
        signature,
        sourceRequestId: window.crypto.randomUUID(),
        stage: 'pending-intent',
      };
    }

    submit.disabled = true;
    submit.textContent = getLabel(
      labels,
      'EventBookingSubmitting',
      'Adding to cart…',
    );

    try {
      const intentRef = await addToCart({
        form: normalizedForm,
        pendingSubmission,
      });
      pendingSubmission.intentRef = intentRef;
      feedback.textContent = getLabel(
        labels,
        'EventBookingAdded',
        'The event tickets were added to your cart.',
      );
      clearForm();
    } catch (error) {
      showSubmissionError(error);
    } finally {
      submit.disabled = false;
      submit.textContent = getLabel(
        labels,
        'EventAddToCartLabel',
        'Book and add to cart',
      );
    }
  });

  renderParticipants(quantity);
  form.append(
    formHeading,
    feedback,
    contact,
    participantsContainer,
    consentWrapper,
    summary.element,
    submit,
  );
  container.replaceChildren(metadata, form);

  return Object.freeze({
    setQuantity(nextQuantity) {
      if (
        !Number.isInteger(nextQuantity)
        || nextQuantity < 1
        || nextQuantity > MAXIMUM_DEMO_QUANTITY
      ) {
        feedback.textContent = `Choose between 1 and ${MAXIMUM_DEMO_QUANTITY} tickets.`;
        return;
      }
      quantity = nextQuantity;
      pendingSubmission = null;
      renderParticipants(quantity);
      summary.update(quantity);
      feedback.textContent = '';
    },
  });
}
