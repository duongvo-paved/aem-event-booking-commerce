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
let nextEventBookingFormId = 0;

function getLabel(labels, key, fallback) {
  return labels.Global?.[key] || fallback;
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function createCartIcon() {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.classList.add(
    'dropin-icon',
    'dropin-icon--shape-stroke-2',
    'event-booking__submit-icon',
  );
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');

  const paths = [
    'M18.3601 18.16H6.5601L4.8801 3H2.3501M19.6701 19.59C19.6701 20.3687 19.0388 21 18.2601 21C17.4814 21 16.8501 20.3687 16.8501 19.59C16.8501 18.8113 17.4814 18.18 18.2601 18.18C19.0388 18.18 19.6701 18.8113 19.6701 19.59ZM7.42986 19.59C7.42986 20.3687 6.79858 21 6.01986 21C5.24114 21 4.60986 20.3687 4.60986 19.59C4.60986 18.8113 5.24114 18.18 6.01986 18.18C6.79858 18.18 7.42986 18.8113 7.42986 19.59Z',
    'M5.25 6.37L20.89 8.06L20.14 14.8H6.19',
  ];
  paths.forEach((pathData) => {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(path);
  });

  return svg;
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
  ];
  if (event.organizer) {
    rows.push([
      getLabel(labels, 'EventOrganizerLabel', 'Organizer'),
      event.organizer,
    ]);
  }
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
  legend.textContent = `${getLabel(labels, 'EventAttendeeLabel', 'Attendee')} ${index + 1}`;

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

function getProductPrice(product) {
  const finalPrice = product?.prices?.final;
  const value = finalPrice?.minimumAmount ?? finalPrice?.amount;
  const amount = typeof value === 'number' ? value : value?.value;
  const currency = typeof value === 'object' ? value.currency : finalPrice?.currency;

  if (!Number.isFinite(amount) || !currency) return null;
  return { amount, currency };
}

function formatPrice(price) {
  if (!price) return '—';

  try {
    return new Intl.NumberFormat(
      document.documentElement.lang || 'en-US',
      { currency: price.currency, style: 'currency' },
    ).format(price.amount);
  } catch (error) {
    return `${price.amount.toFixed(2)} ${price.currency}`;
  }
}

/**
 * Renders a live, pre-cart event ticket summary.
 * @param {Element} container Summary mount element
 * @param {object} options Summary options
 * @returns {{setProduct: (product: object) => void, setQuantity: (quantity: number) => void}}
 */
export function renderEventSummary(container, {
  labels = {},
  product,
  quantity = 0,
}) {
  let currentProduct = product;
  let currentQuantity = quantity;

  const summary = document.createElement('details');
  summary.className = 'event-summary';
  summary.open = true;

  const header = document.createElement('summary');
  header.className = 'event-summary__header';
  const heading = createTextElement(
    'span',
    'event-summary__heading',
    getLabel(labels, 'EventSummaryHeading', 'Summary'),
  );
  const ticketCount = document.createElement('span');
  ticketCount.className = 'event-summary__ticket-count';
  header.append(heading, ticketCount);

  const content = document.createElement('div');
  content.className = 'event-summary__content';
  const ticketsHeading = createTextElement(
    'h3',
    'event-summary__tickets-heading',
    getLabel(labels, 'EventSummaryTicketsHeading', 'Tickets'),
  );
  const line = document.createElement('div');
  line.className = 'event-summary__line';
  const lineName = document.createElement('span');
  lineName.className = 'event-summary__line-name';
  const linePrice = document.createElement('span');
  linePrice.className = 'event-summary__line-price';
  line.append(lineName, linePrice);

  const total = document.createElement('div');
  total.className = 'event-summary__total';
  const totalLabel = createTextElement(
    'span',
    'event-summary__total-label',
    getLabel(labels, 'EventSummaryTotalLabel', 'Total'),
  );
  const totalValue = document.createElement('strong');
  totalValue.className = 'event-summary__total-value';
  total.append(totalLabel, totalValue);
  content.append(ticketsHeading, line, total);
  summary.append(header, content);
  container.replaceChildren(summary);

  function renderValues() {
    const name = currentProduct?.name || getLabel(labels, 'EventTicketLabel', 'Event ticket');
    const price = getProductPrice(currentProduct);
    const unitPrice = formatPrice(price);
    const lineTotal = price
      ? formatPrice({ ...price, amount: price.amount * currentQuantity })
      : '—';
    const countLabel = currentQuantity === 1
      ? getLabel(labels, 'EventSummaryTicketSingular', 'ticket')
      : getLabel(labels, 'EventSummaryTicketPlural', 'tickets');

    ticketCount.textContent = `${currentQuantity} ${countLabel}`;
    lineName.textContent = `${currentQuantity} × ${name}`;
    linePrice.textContent = `(${unitPrice}) ${lineTotal}`;
    totalValue.textContent = lineTotal;
  }

  renderValues();

  return Object.freeze({
    setProduct(nextProduct) {
      currentProduct = nextProduct;
      renderValues();
    },
    setQuantity(nextQuantity) {
      if (Number.isInteger(nextQuantity) && nextQuantity >= 0) {
        currentQuantity = nextQuantity;
        renderValues();
      }
    },
  });
}

export function renderEventBooking({
  addToCart,
  cartUrl,
  container,
  event,
  includeMetadata = true,
  labels,
  inline = true,
  initialQuantity = 1,
  onClose,
  onQuantityChange,
  onQuantityReset,
  onSuccess,
  actionsContainer,
  quantityElement,
}) {
  let quantity = initialQuantity;
  let participants = [];
  let pendingSubmission = null;

  const metadata = createMetadata(event, labels);
  const form = document.createElement('form');
  form.className = 'event-booking__form';
  form.noValidate = true;

  if (actionsContainer) {
    nextEventBookingFormId += 1;
    form.id = `event-booking-form-${nextEventBookingFormId}`;
  }

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
  const submitLabel = createTextElement(
    'span',
    'event-booking__submit-label',
    getLabel(labels, 'EventAddToCartLabel', 'Add to Cart'),
  );
  submit.append(createCartIcon(), submitLabel);

  const setSubmitLabel = (label) => {
    submitLabel.textContent = label;
  };

  const updateSubmitDisabled = () => {
    submit.disabled = quantity <= 0;
  };

  updateSubmitDisabled();

  const actionButtons = document.createElement('div');
  actionButtons.className = 'event-booking__buttons';
  actionButtons.append(submit);

  const actions = document.createElement('div');
  actions.className = 'event-booking__actions';
  actions.append(consentWrapper, actionButtons);

  if (actionsContainer) {
    consent.setAttribute('form', form.id);
    submit.setAttribute('form', form.id);
  }

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

    const firstInvalid = form.querySelector('[aria-invalid="true"]')
      || actionsContainer?.querySelector('[aria-invalid="true"]');
    firstInvalid?.focus();
  }

  function clearForm() {
    form.reset();
    quantity = initialQuantity;
    renderParticipants(quantity);
    updateSubmitDisabled();
    onQuantityChange?.(quantity);
    onQuantityReset?.();
    pendingSubmission = null;
  }

  form.addEventListener('input', () => {
    const currentSignature = JSON.stringify(readForm());
    if (pendingSubmission?.signature !== currentSignature) {
      pendingSubmission = null;
    }
  });

  consent.addEventListener('input', () => {
    pendingSubmission = null;
  });

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    clearErrors();

    const rawForm = readForm();
    const validation = validateBookingForm(rawForm, MAXIMUM_DEMO_QUANTITY);
    if (!validation.valid) {
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
    setSubmitLabel(getLabel(
      labels,
      'EventBookingSubmitting',
      'Adding to cart…',
    ));

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
      updateSubmitDisabled();
      setSubmitLabel(getLabel(
        labels,
        'EventAddToCartLabel',
        'Add to Cart',
      ));
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
  const formChildren = [formHeading, feedback];
  if (quantityElement) {
    quantityElement.classList.add('event-booking__quantity');
    const quantityWrapper = document.createElement('div');
    quantityWrapper.className = 'event-booking__quantity-wrapper';
    const quantityLabel = document.createElement('label');
    quantityLabel.className = 'event-booking__quantity-label';
    quantityLabel.htmlFor = 'event-booking-quantity';
    quantityLabel.textContent = getLabel(
      labels,
      'EventQuantityLabel',
      'Number of attendees',
    );
    quantityWrapper.append(quantityLabel, quantityElement);
    formChildren.push(quantityWrapper);
  }
  formChildren.push(
    contact,
    participantsContainer,
  );
  form.append(...formChildren);

  if (actionsContainer) {
    actionsContainer.replaceChildren(actions);
  } else {
    form.append(actions);
  }

  if (inline) {
    container.replaceChildren(
      ...(includeMetadata ? [metadata] : []),
      form,
    );
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
        || nextQuantity < 0
        || nextQuantity > MAXIMUM_DEMO_QUANTITY
      ) {
        feedback.textContent = `Choose between 1 and ${MAXIMUM_DEMO_QUANTITY} tickets.`;
        return;
      }
      quantity = nextQuantity;
      pendingSubmission = null;
      renderParticipants(quantity);
      updateSubmitDisabled();
      onQuantityChange?.(quantity);
      feedback.textContent = '';
    },
  });
}
