import { formatEventDateRange } from '../../scripts/event-app/dates.js';
import {
  EVENT_APP_ERROR_TYPES,
  getSafeErrorMessage,
} from '../../scripts/event-app/errors.js';
import {
  normalizeBookingForm,
  validateBookingForm,
} from '../../scripts/event-app/validation.js';
import createModal from '../modal/modal.js';

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

export function renderEventMetadata(container, event, labels) {
  container.replaceChildren(createMetadata(event, labels));
}

export function renderEventBooking({
  addToCart,
  cartUrl,
  container,
  event,
  labels,
  inline = true,
  onClose,
  onSuccess,
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
  feedback.tabIndex = -1;

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

  const submit = document.createElement('button');
  submit.className = 'button event-booking__submit';
  submit.type = 'submit';
  submit.textContent = getLabel(labels, 'EventAddToCartLabel', 'Add to Cart');

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

    let successMessage = null;
    try {
      const intentRef = await addToCart({
        form: normalizedForm,
        pendingSubmission,
      });
      pendingSubmission.intentRef = intentRef;
      successMessage = getLabel(
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
        'Add to Cart',
      );
    }

    if (!successMessage) return;

    if (inline) {
      feedback.textContent = successMessage;
      setTimeout(() => feedback.focus(), 0);
    } else {
      close();
    }

    try {
      onSuccess?.(successMessage);
    } catch (error) {
      console.error('Failed to notify booking success:', error);
    }
  });

  renderParticipants(quantity);
  form.append(
    formHeading,
    feedback,
    contact,
    participantsContainer,
    consentWrapper,
    submit,
  );

  if (inline) {
    container.replaceChildren(metadata, form);
  } else {
    container.replaceChildren(metadata);
  }

  let modal = null;

  async function open() {
    if (modal?.block?.isConnected) {
      modal.showModal();
      setTimeout(() => form.querySelector('input')?.focus(), 0);
      return;
    }

    modal = await createModal([form], {
      onClose: () => {
        modal = null;
        onClose?.();
      },
    });
    modal.block.id = 'event-booking-modal';
    modal.block.classList.add('event-booking-modal');
    modal.showModal();
    setTimeout(() => form.querySelector('input')?.focus(), 0);
  }

  function close() {
    modal?.removeModal();
  }

  return Object.freeze({
    open,
    close,
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
      feedback.textContent = '';
    },
  });
}
