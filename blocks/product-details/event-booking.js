import { formatEventDateRange, formatEventHeadlineDate } from '../../scripts/event-app/dates.js';
import {
  EVENT_APP_ERROR_TYPES,
  getSafeErrorMessage,
} from '../../scripts/event-app/errors.js';
import {
  normalizeBookingForm,
  validateBookingForm,
} from '../../scripts/event-app/validation.js';
import createModal from '../modal/modal.js';
import createSessionSelector from './event-session-selector.js';

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

function getEventVenueText(event) {
  const name = event.venue.name || '';
  const address = event.venue.address || '';
  if (address === name || address.startsWith(`${name},`)) return address;
  return [name, address].filter(Boolean).join(', ');
}

function createMetadata(event, labels, { product } = {}) {
  const section = document.createElement('section');
  section.className = 'event-booking__metadata';
  if (product) section.classList.add('event-booking__metadata--prototype');
  section.setAttribute('aria-labelledby', 'event-details-heading');

  const heading = createTextElement(
    'h2',
    'event-booking__heading',
    getLabel(labels, 'EventDetailsHeading', 'Event details'),
  );
  heading.id = 'event-details-heading';

  const list = document.createElement('dl');
  const eventDateLabel = event.scheduleType === 'recurring'
    ? getLabel(labels, 'EventAvailableDatesLabel', 'Available dates')
    : getLabel(labels, 'EventDateLabel', 'Date and time');
  const eventDateValue = event.scheduleType === 'recurring' && event.recurrence
    ? `${formatLocalDate(event.recurrence.startDate, event.timezone)} – ${formatLocalDate(event.recurrence.endDate, event.timezone)}`
    : formatEventDateRange(event);
  const rows = [[eventDateLabel, eventDateValue]];
  const venue = product
    ? getEventVenueText(event) : event.venue.name;
  if (venue) rows.push([getLabel(labels, 'EventVenueLabel', 'Venue'), venue]);
  if (!product && event.venue.address) {
    rows.push([getLabel(labels, 'EventAddressLabel', 'Address'), event.venue.address]);
  }
  const ageRow = event.ageRequirement
    ? [getLabel(labels, 'EventAgeRequirementLabel', product ? 'Age' : 'Age requirement'), event.ageRequirement] : null;
  if (product && ageRow) rows.push(ageRow);
  if (event.organizer) {
    rows.push([getLabel(labels, 'EventOrganizerLabel', product ? 'Organiser' : 'Organizer'), event.organizer]);
  }
  if (!product && ageRow) rows.push(ageRow);
  if (product?.sku) {
    rows.push([getLabel(labels, 'EventCodeLabel', 'Event code'), product.sku]);
  }
  if (event.tags.length) {
    rows.push([getLabel(labels, 'EventTagsLabel', 'Tags'), event.tags.join(', ')]);
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

function formatLocalDate(value, timezone) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(
    document.documentElement.lang || 'en-US',
    {
      day: 'numeric',
      month: 'short',
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
    },
  ).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function createOccurrenceSelector(event, getAllocation, labels, onRetry) {
  if (event.scheduleType !== 'recurring') return null;

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'event-booking__occurrences';
  const legend = document.createElement('legend');
  legend.textContent = getLabel(
    labels,
    'EventOccurrenceHeading',
    'Choose a date and time',
  );

  const dateWrapper = document.createElement('div');
  dateWrapper.className = 'event-booking__occurrence-field';
  const dateLabel = document.createElement('label');
  dateLabel.htmlFor = 'event-occurrence-date';
  dateLabel.textContent = getLabel(labels, 'EventOccurrenceDateLabel', 'Date');
  const dateSelect = document.createElement('select');
  dateSelect.id = 'event-occurrence-date';
  dateSelect.name = 'occurrence-date';
  dateSelect.required = true;
  dateWrapper.append(dateLabel, dateSelect);

  const timeWrapper = document.createElement('div');
  timeWrapper.className = 'event-booking__occurrence-field';
  const timeLabel = document.createElement('label');
  timeLabel.htmlFor = 'event-occurrence-time';
  timeLabel.textContent = getLabel(labels, 'EventOccurrenceTimeLabel', 'Start time');
  const timeSelect = document.createElement('select');
  timeSelect.id = 'event-occurrence-time';
  timeSelect.name = 'occurrence-time';
  timeSelect.required = true;
  timeWrapper.append(timeLabel, timeSelect);

  const availability = createTextElement(
    'p',
    'event-booking__occurrence-availability',
    '',
  );
  availability.setAttribute('aria-live', 'polite');
  const retry = createTextElement(
    'button',
    'event-booking__availability-retry',
    getLabel(labels, 'EventAvailabilityRetryLabel', 'Retry loading dates'),
  );
  retry.type = 'button';
  retry.hidden = true;
  retry.addEventListener('click', () => onRetry?.());
  fieldset.append(legend, dateWrapper, timeWrapper, availability);
  if (onRetry) fieldset.append(retry);

  let selectedOccurrence = null;
  let changeHandler = () => {};
  let availabilityState = 'ready';

  function getOccurrences() {
    return getAllocation()?.occurrences || [];
  }

  function renderAvailability() {
    if (availabilityState === 'loading') {
      availability.textContent = getLabel(
        labels,
        'EventAvailabilityLoadingLabel',
        'Loading available dates and times…',
      );
      return;
    }
    if (availabilityState === 'error') {
      availability.textContent = getLabel(
        labels,
        'EventAvailabilityErrorLabel',
        'Availability could not be loaded.',
      );
      return;
    }
    if (!selectedOccurrence) {
      availability.textContent = getLabel(
        labels,
        'EventOccurrenceUnavailableLabel',
        'No available dates or times for this space.',
      );
      return;
    }
    const quantity = selectedOccurrence.availableQuantity;
    availability.textContent = quantity > 0
      ? `${quantity} ${getLabel(labels, 'EventAllocationAvailableLabel', 'available')}`
      : getLabel(labels, 'EventAllocationUnavailableLabel', 'Unavailable');
  }

  function renderTimes(preferredOccurrenceId) {
    const occurrences = getOccurrences().filter(
      (occurrence) => occurrence.localDate === dateSelect.value,
    );
    timeSelect.replaceChildren();
    occurrences.forEach((occurrence) => {
      const option = document.createElement('option');
      option.value = occurrence.occurrenceId;
      option.textContent = `${occurrence.startTime} – ${occurrence.endTime}`;
      option.disabled = occurrence.availableQuantity < 1;
      timeSelect.append(option);
    });

    const preferred = occurrences.find(
      (occurrence) => occurrence.occurrenceId === preferredOccurrenceId
        && occurrence.availableQuantity > 0,
    );
    const firstAvailable = occurrences.find(
      (occurrence) => occurrence.availableQuantity > 0,
    );
    selectedOccurrence = preferred || firstAvailable || null;
    timeSelect.value = selectedOccurrence?.occurrenceId || '';
    timeSelect.disabled = !firstAvailable;
    if (!occurrences.length) addPlaceholder(timeSelect, 'No available times');
    renderAvailability();
  }

  function addPlaceholder(select, text) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = text;
    select.replaceChildren(option);
  }

  function renderDates(preferredDate) {
    if (availabilityState !== 'ready') return;
    const occurrences = getOccurrences();
    const dates = [...new Set(occurrences.map((occurrence) => occurrence.localDate))];
    dateSelect.replaceChildren();
    dateSelect.disabled = !occurrences.some((occurrence) => occurrence.availableQuantity > 0);
    if (!dates.length) addPlaceholder(dateSelect, 'No available dates');
    dates.forEach((date) => {
      const option = document.createElement('option');
      option.value = date;
      option.textContent = formatLocalDate(date, event.timezone);
      option.disabled = !occurrences.some(
        (occurrence) => occurrence.localDate === date
          && occurrence.availableQuantity > 0,
      );
      dateSelect.append(option);
    });

    const preferredOption = dates.includes(preferredDate)
      && !dateSelect.querySelector(`option[value="${preferredDate}"]:disabled`)
      ? preferredDate
      : dates.find((date) => occurrences.some(
        (occurrence) => occurrence.localDate === date
          && occurrence.availableQuantity > 0,
      )) || dates[0] || '';
    dateSelect.value = preferredOption;
    renderTimes(selectedOccurrence?.occurrenceId);
  }

  dateSelect.addEventListener('change', () => {
    const previous = selectedOccurrence?.occurrenceId;
    renderTimes(previous);
    changeHandler(selectedOccurrence);
  });
  timeSelect.addEventListener('change', () => {
    selectedOccurrence = getOccurrences().find(
      (occurrence) => occurrence.occurrenceId === timeSelect.value,
    ) || null;
    renderAvailability();
    changeHandler(selectedOccurrence);
  });

  renderDates();
  return Object.freeze({
    fieldset,
    getSelected: () => selectedOccurrence,
    onChange(handler) {
      changeHandler = typeof handler === 'function' ? handler : () => {};
    },
    refresh() {
      renderDates(selectedOccurrence?.localDate);
    },
    setAvailabilityState(state) {
      availabilityState = state;
      const isReady = state === 'ready';
      fieldset.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
      retry.hidden = state !== 'error';
      dateSelect.disabled = !isReady;
      timeSelect.disabled = !isReady;
      if (!isReady) {
        selectedOccurrence = null;
        addPlaceholder(dateSelect, state === 'loading' ? 'Loading dates…' : 'Dates unavailable');
        addPlaceholder(timeSelect, state === 'loading' ? 'Loading times…' : 'Times unavailable');
      } else {
        renderDates();
      }
      renderAvailability();
    },
  });
}

function createAttendeeFields(index, labels, paid = false) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'event-booking__attendee';
  const legend = document.createElement('legend');
  legend.textContent = `${getLabel(labels, paid ? 'EventTicketHeadingLabel' : 'EventAttendeeLabel', paid ? 'Ticket' : 'Attendee')} ${index + 1}`;

  const firstName = createField({
    autocomplete: 'off',
    id: `event-attendee-${index}-first-name`,
    label: getLabel(labels, 'EventFirstNameLabel', 'First name'),
    name: `attendee-${index}-firstName`,
  });
  const lastName = createField({
    autocomplete: 'off',
    id: `event-attendee-${index}-last-name`,
    label: getLabel(labels, 'EventLastNameLabel', 'Last name'),
    name: `attendee-${index}-lastName`,
  });

  fieldset.append(legend);
  if (paid) {
    const title = createTextElement('p', 'event-booking__attendee-title', legend.textContent);
    title.setAttribute('aria-hidden', 'true');
    fieldset.append(title);
  }
  fieldset.append(firstName.wrapper, lastName.wrapper);
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

function getAllocationName(allocation) {
  return [allocation?.space?.name, allocation?.zone?.name].filter(Boolean).join(' · ');
}

export function formatBookingDate(event, occurrence, compact = false) {
  if (event.scheduleType === 'recurring' && !occurrence) return '';
  if (!occurrence && !event.startsAtUtc) return '';
  const date = new Date(occurrence
    ? `${occurrence.localDate}T${occurrence.startTime}:00Z` : event.startsAtUtc);
  const timeZone = occurrence ? 'UTC' : event.timezone;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    weekday: compact ? 'short' : 'long',
    day: 'numeric',
    month: compact ? 'short' : 'long',
    timeZone,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const time = new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  }).format(date).replace(/\s/g, '').toLowerCase();
  return `${parts.weekday} ${parts.day} ${parts.month}, ${time}`;
}

function createAllocationSelector(allocations, labels, scheduleType, paid = false) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'event-booking__allocations';
  const legend = document.createElement('legend');
  legend.textContent = getLabel(
    labels,
    paid ? 'EventChooseTicketsHeading' : 'EventAllocationHeading',
    paid ? 'Choose your tickets' : 'Choose a space',
  );
  fieldset.append(legend);

  const options = allocations.map((allocation, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'event-booking__allocation-option';
    const input = document.createElement('input');
    input.id = `event-allocation-${index}`;
    input.name = 'event-allocation';
    input.type = 'radio';
    input.value = allocation.eventAllocationId;
    input.disabled = !canSelectAllocation(allocation, scheduleType);

    const label = document.createElement('label');
    label.htmlFor = input.id;
    const location = getAllocationName(allocation);
    label.textContent = location;

    if (!paid) {
      wrapper.append(input, label);
      return { allocation, input, wrapper };
    }
    const details = document.createElement('div');
    details.className = 'event-booking__ticket-details';
    const name = document.createElement('div');
    name.className = 'event-booking__ticket-name';
    name.append(input, label);
    const price = createTextElement('p', 'event-booking__ticket-price', 'Loading price…');
    price.setAttribute('role', 'status');
    const availability = createTextElement('p', 'event-booking__ticket-availability', '');
    availability.hidden = true;
    details.append(name, price, availability);
    const controls = document.createElement('div');
    controls.className = 'event-booking__ticket-quantity';
    const decrease = createTextElement('button', 'event-booking__quantity-decrease', '−');
    decrease.type = 'button';
    decrease.setAttribute('aria-label', `Decrease tickets for ${location}`);
    const value = document.createElement('input');
    value.type = 'number';
    value.min = '0';
    value.step = '1';
    value.value = '0';
    value.name = `quantity-${allocation.eventAllocationId}`;
    value.setAttribute('aria-label', `Number of tickets for ${location}`);
    const increase = createTextElement('button', 'event-booking__quantity-increase', '+');
    increase.type = 'button';
    increase.setAttribute('aria-label', `Increase tickets for ${location}`);
    controls.append(decrease, value, increase);
    wrapper.append(details, controls);
    return {
      allocation, input, wrapper, price, availability, decrease, value, increase,
    };
  });

  const firstAvailable = options.find(
    ({ allocation }) => canSelectAllocation(allocation, scheduleType),
  );
  if (firstAvailable) firstAvailable.input.checked = true;
  options.forEach(({ wrapper }) => fieldset.append(wrapper));
  return { fieldset, options };
}

function canSelectAllocation(allocation, scheduleType) {
  return scheduleType === 'recurring'
    ? allocation?.allocatedCapacity > 0 : hasAvailableAllocation(allocation);
}

function hasAvailableAllocation(allocation) {
  return Boolean(
    allocation?.availableQuantity > 0
      || allocation?.occurrences?.some((occurrence) => occurrence.availableQuantity > 0),
  );
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

export function renderEventMetadata(container, event, labels, options = {}) {
  container.replaceChildren(createMetadata(event, labels, options));
}

function createEventFactIcon(type) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shapes = type === 'date'
    ? [['rect', {
      x: 3, y: 5, width: 18, height: 16, rx: 2,
    }],
    ['path', { d: 'M8 3v4M16 3v4M3 10h18' }]]
    : [['path', { d: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z' }],
      ['circle', { cx: 12, cy: 11, r: 2.2 }]];
  shapes.forEach(([tag, attributes]) => {
    const shape = document.createElementNS(namespace, tag);
    Object.entries(attributes).forEach(([key, value]) => shape.setAttribute(key, value));
    svg.append(shape);
  });
  return svg;
}

export function renderEventFacts(container, event) {
  const facts = [
    ['date', formatEventHeadlineDate(event)],
    ['address', event.venue.city
      ? [event.venue.name, event.venue.city].filter(Boolean).join(', ') : getEventVenueText(event)],
  ].filter(([, value]) => value);
  container.replaceChildren(...facts.map(([type, value]) => {
    const row = document.createElement('p');
    row.className = `product-details__event-${type}`;
    const text = document.createElement('span');
    text.textContent = value;
    row.append(createEventFactIcon(type), text);
    return row;
  }));
}

export function getProductPrice(product) {
  const finalPrice = product?.prices?.final ?? product?.price?.final;
  const value = finalPrice?.minimumAmount ?? finalPrice?.amount;
  const amount = typeof value === 'number' ? value : value?.value;
  const currency = typeof value === 'object' ? value?.currency : finalPrice?.currency;

  if (!Number.isFinite(amount) || amount < 0 || !currency) return null;
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
  paid = false,
}) {
  let currentProduct = product;
  let currentQuantity = quantity;

  const summary = document.createElement(paid ? 'section' : 'details');
  summary.className = 'event-summary';
  if (!paid) summary.open = true;

  const header = document.createElement(paid ? 'div' : 'summary');
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
  const prompt = createTextElement('p', 'event-summary__prompt', getLabel(labels, 'EventChooseTicketsPrompt', paid ? 'Choose your tickets above and we’ll show the total here.' : 'Choose your tickets above to see the total.'));
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
    paid ? getLabel(labels, 'EventTicketSubtotalLabel', 'Ticket subtotal') : getLabel(labels, 'EventSummaryTotalLabel', 'Total'),
  );
  const totalValue = document.createElement('strong');
  totalValue.className = 'event-summary__total-value';
  total.append(totalLabel, totalValue);
  content.append(prompt, ticketsHeading, line, total);
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
    linePrice.textContent = paid ? lineTotal : `(${unitPrice}) ${lineTotal}`;
    totalValue.textContent = lineTotal;
    prompt.hidden = currentQuantity > 0;
    ticketsHeading.hidden = currentQuantity <= 0;
    line.hidden = currentQuantity <= 0;
    total.hidden = currentQuantity <= 0;
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
  checkoutUrl,
  browseUrl,
  product,
  paid = false,
  loadProducts,
  onPriceChange,
  onAvailabilityRetry,
  onDateChange,
  onSessionChange,
  summaryElement,
  container,
  event,
  includeMetadata = true,
  labels,
  inline = true,
  initialQuantity = 1,
  onClose,
  onAllocationChange,
  onOccurrenceChange,
  onQuantityChange,
  onQuantityLimitChange,
  onQuantityReset,
  onSuccess,
  actionsContainer,
  quantityElement,
}) {
  let quantity = initialQuantity;
  let attendees = [];
  let attendeeDrafts = [];
  let pendingSubmission = null;
  let submitting = false;
  let selectedPrice = paid ? null : getProductPrice(product);
  let priceRequestId = 0;
  let productsRequest;
  const productsBySku = new Map();
  let priceState = paid ? 'loading' : 'ready';
  const allocations = Array.isArray(event.allocations)
    ? [...event.allocations]
    : [];
  const sessionFirst = paid && event.scheduleType === 'recurring';
  let selectedSession = null;
  let selectedAllocation = sessionFirst ? null : allocations.find(
    (allocation) => canSelectAllocation(allocation, event.scheduleType),
  ) || null;
  const sessionSelector = sessionFirst ? createSessionSelector({
    event,
    labels,
    onDateChange: (date) => onDateChange?.(date),
    onChange: (session) => changeSession(session),
  }) : null;
  const occurrenceSelector = sessionFirst ? null : createOccurrenceSelector(
    event,
    () => selectedAllocation,
    labels,
    onAvailabilityRetry ? () => onAvailabilityRetry(selectedAllocation) : undefined,
  );
  let selectedOccurrence = occurrenceSelector?.getSelected() || null;

  const metadata = createMetadata(event, labels);
  const form = document.createElement('form');
  form.className = 'event-booking__form';
  form.noValidate = true;
  const success = document.createElement('section');
  success.className = 'event-booking__success';
  success.hidden = true;
  success.tabIndex = -1;
  success.setAttribute('role', 'status');
  success.setAttribute('aria-live', 'polite');

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

  const attendeesContainer = document.createElement('div');
  attendeesContainer.className = 'event-booking__attendees';
  attendeesContainer.setAttribute('aria-live', 'polite');
  const attendeesSection = document.createElement('section');
  attendeesSection.className = 'event-booking__attendee-section';
  const attendeesHeading = createTextElement(
    'h3',
    'event-booking__section-heading',
    getLabel(labels, 'EventWhosGoingHeading', 'Who’s going'),
  );
  attendeesSection.append(attendeesHeading, attendeesContainer);
  const availabilityWarning = createTextElement('p', 'event-booking__availability-warning', '');
  availabilityWarning.setAttribute('role', 'status');
  availabilityWarning.hidden = true;

  const allocationSelector = createAllocationSelector(
    allocations,
    labels,
    event.scheduleType,
    paid,
  );

  const getQuantityLimit = () => Math.min(
    MAXIMUM_DEMO_QUANTITY,
    event.scheduleType === 'recurring'
      ? selectedOccurrence?.availableQuantity || 0
      : selectedAllocation?.availableQuantity || 0,
  );

  let updateSubmitDisabled = () => {};

  const updateAllocationSelection = (allocation, resetQuantity = true) => {
    if (sessionFirst && !sessionSelector.getOccurrence(allocation)) return;
    selectedAllocation = allocation;
    occurrenceSelector?.refresh();
    selectedOccurrence = sessionFirst ? sessionSelector.getOccurrence(allocation)
      : occurrenceSelector?.getSelected() || null;
    allocationSelector.options.forEach((option) => {
      option.input.checked = option.allocation.eventAllocationId
        === allocation?.eventAllocationId;
    });
    pendingSubmission = null;
    if (resetQuantity) {
      quantity = 0;
      attendees = [];
      attendeeDrafts = [];
      renderAttendees(quantity);
      onQuantityChange?.(quantity);
      onQuantityReset?.();
    }
    updateSubmitDisabled();
    if (paid) loadSelectedPrice();
    onAllocationChange?.(selectedAllocation);
    onOccurrenceChange?.(selectedOccurrence);
  };

  function changeSession(session) {
    selectedSession = session;
    selectedAllocation = null;
    selectedOccurrence = null;
    quantity = 0;
    attendees = [];
    attendeeDrafts = [];
    pendingSubmission = null;
    renderAttendees(0);
    onQuantityChange?.(0);
    onQuantityReset?.();
    onAllocationChange?.(null);
    onOccurrenceChange?.(null);
    onSessionChange?.(session);
    updateSubmitDisabled();
    loadSelectedPrice();
  }

  occurrenceSelector?.onChange((occurrence) => {
    selectedOccurrence = occurrence;
    pendingSubmission = null;
    quantity = 0;
    attendees = [];
    attendeeDrafts = [];
    renderAttendees(quantity);
    updateSubmitDisabled();
    onQuantityChange?.(quantity);
    onQuantityReset?.();
    onOccurrenceChange?.(selectedOccurrence);
  });

  allocationSelector.options.forEach((option) => {
    option.input.addEventListener('change', () => {
      if (option.input.checked) updateAllocationSelection(option.allocation);
    });
    if (paid) {
      option.decrease.addEventListener('click', () => setQuantity(quantity - 1));
      option.increase.addEventListener('click', () => setQuantity(quantity + 1));
      option.value.addEventListener('input', () => setQuantity(Number(option.value.value)));
    }
  });

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
    getLabel(labels, 'EventAddToCartLabel', paid ? 'Add to cart' : 'Add to Cart'),
  );
  if (!paid) submit.append(createCartIcon());
  submit.append(submitLabel);

  const checkoutNote = createTextElement(
    'p',
    'event-booking__checkout-note',
    getLabel(labels, 'EventFinalTotalNote', 'Final total is shown at checkout.'),
  );

  updateSubmitDisabled = () => {
    onQuantityLimitChange?.(getQuantityLimit());
    submit.disabled = submitting || (paid && !selectedPrice) || quantity <= 0
      || !selectedAllocation
      || quantity > getQuantityLimit()
      || (event.scheduleType === 'recurring' && !selectedOccurrence);
    contact.hidden = quantity <= 0;
    attendeesContainer.hidden = quantity <= 0;
    attendeesSection.hidden = quantity <= 0;
    checkoutNote.hidden = quantity <= 0;
    consentWrapper.hidden = quantity <= 0;
    const available = event.scheduleType === 'recurring'
      ? selectedOccurrence?.availableQuantity : selectedAllocation?.availableQuantity;
    availabilityWarning.hidden = !Number.isInteger(available) || available < 1 || available > 5;
    availabilityWarning.textContent = availabilityWarning.hidden ? ''
      : getLabel(labels, 'EventFewTicketsLeftLabel', 'Few tickets left');
    if (sessionFirst) allocationSelector.fieldset.hidden = !selectedSession;
    if (paid) {
      allocationSelector.options.forEach((option) => {
        const active = option.allocation.eventAllocationId
          === selectedAllocation?.eventAllocationId;
        option.input.checked = active;
        option.wrapper.hidden = sessionFirst && !sessionSelector.getOccurrence(option.allocation);
        const rowProduct = productsBySku.get(option.allocation.commerceSku);
        const price = getProductPrice(rowProduct);
        const maximum = active ? getQuantityLimit() : 0;
        const disabled = !active || !selectedPrice || submitting || maximum < 1;
        option.wrapper.classList.toggle('event-booking__allocation-option--selected', active);
        option.value.value = String(active ? quantity : 0);
        option.value.max = String(maximum);
        option.value.disabled = disabled;
        option.decrease.disabled = disabled || quantity <= 0;
        option.increase.disabled = disabled || quantity >= maximum;
        let priceText = getLabel(
          labels,
          'EventPriceUnavailable',
          'Ticket price unavailable. Please reload to try again.',
        );
        if (priceState === 'loading') {
          priceText = getLabel(labels, 'EventPriceLoading', 'Loading ticket price…');
        }
        option.price.textContent = price ? formatPrice(price) : priceText;
        option.price.classList.toggle('event-booking__price--loading', priceState === 'loading');
        let { availableQuantity } = option.allocation;
        if (event.scheduleType === 'recurring') {
          availableQuantity = sessionFirst
            ? sessionSelector.getOccurrence(option.allocation)?.availableQuantity
            : selectedOccurrence?.availableQuantity;
          if (!sessionFirst && !active) availableQuantity = undefined;
        }
        option.availability.hidden = !Number.isInteger(availableQuantity) || availableQuantity > 5;
        option.availability.textContent = availableQuantity === 0 ? 'Sold out'
          : getLabel(labels, 'EventFewTicketsLeftLabel', 'Few tickets left');
      });
    }
  };

  // Cache one batch request, but only apply its result to the latest selection.
  async function loadSelectedPrice() {
    priceRequestId += 1;
    const requestId = priceRequestId;
    const sku = selectedAllocation?.commerceSku;
    selectedPrice = null;
    priceState = 'loading';
    onPriceChange?.(null);
    updateSubmitDisabled();
    try {
      if (!productsRequest) {
        const skus = [...new Set(allocations.map((allocation) => allocation.commerceSku)
          .filter(Boolean))];
        // Grouped children can be omitted from direct Catalog Service lookups.
        // The same batch includes their parent, whose options expose exact child prices.
        if (product?.sku && !skus.includes(product.sku)) skus.push(product.sku);
        productsRequest = Promise.resolve()
          .then(() => loadProducts(skus.map((value) => ({ sku: value })), true));
      }
      const products = await productsRequest;
      if (requestId !== priceRequestId) return;
      const parent = products?.find((entry) => entry.sku === product?.sku);
      const groupedChildren = parent?.options?.flatMap((option) => option.values || []) || [];
      allocations.forEach((allocation) => {
        const direct = products?.find((entry) => entry.sku === allocation.commerceSku);
        const grouped = groupedChildren
          .find((value) => value.product?.sku === allocation.commerceSku)?.product;
        const rowProduct = getProductPrice(direct) ? direct : grouped;
        if (rowProduct) productsBySku.set(allocation.commerceSku, rowProduct);
      });
      const child = productsBySku.get(sku);
      priceState = 'ready';
      selectedPrice = getProductPrice(child);
      const allocationName = getAllocationName(selectedAllocation);
      onPriceChange?.(selectedPrice ? { ...child, name: allocationName } : null);
    } catch (error) {
      if (requestId !== priceRequestId) return;
      productsRequest = null;
      priceState = 'error';
    }
    updateSubmitDisabled();
  }

  const setSubmitLabel = (label) => {
    submitLabel.textContent = label;
  };

  updateSubmitDisabled();

  const actionButtons = document.createElement('div');
  actionButtons.className = 'event-booking__buttons';
  actionButtons.append(submit);

  const actions = document.createElement('div');
  actions.className = 'event-booking__actions';
  if (paid && summaryElement) actions.append(summaryElement);
  if (paid) actions.append(checkoutNote);
  actions.append(consentWrapper, actionButtons);

  if (actionsContainer) {
    consent.setAttribute('form', form.id);
    submit.setAttribute('form', form.id);
  }

  function renderAttendees(nextQuantity) {
    attendees.forEach((attendee, index) => { attendeeDrafts[index] = attendee.read(); });
    const previousValues = attendeeDrafts;
    attendees = Array.from(
      { length: nextQuantity },
      (_, index) => createAttendeeFields(index, labels, paid),
    );
    attendees.forEach((attendee, index) => {
      const previous = previousValues[index];
      if (previous) {
        attendee.firstName.input.value = previous.firstName;
        attendee.lastName.input.value = previous.lastName;
      }
    });
    attendeesContainer.replaceChildren(
      ...attendees.map((attendee) => attendee.element),
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
      attendees: attendees.map((attendee) => attendee.read()),
      quantity,
    };
  }

  function clearErrors() {
    feedback.textContent = '';
    setInputError(contactFirstName, '');
    setInputError(contactLastName, '');
    setInputError(contactEmail, '');
    attendees.forEach((attendee) => {
      setInputError(attendee.firstName, '');
      setInputError(attendee.lastName, '');
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
    attendees.forEach((attendee, index) => {
      setInputError(
        attendee.firstName,
        errors[`attendee-${index}-firstName`]
          || errors[`attendee-${index}`],
      );
      setInputError(
        attendee.lastName,
        errors[`attendee-${index}-lastName`]
          || errors[`attendee-${index}`],
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
    selectedAllocation = sessionFirst ? null : allocations.find(
      (allocation) => canSelectAllocation(allocation, event.scheduleType),
    ) || null;
    if (sessionFirst) {
      selectedSession = null;
      sessionSelector.reset();
      onDateChange?.('');
      onSessionChange?.(null);
    }
    occurrenceSelector?.refresh();
    selectedOccurrence = occurrenceSelector?.getSelected() || null;
    allocationSelector.options.forEach((option) => {
      option.input.checked = option.allocation.eventAllocationId
        === selectedAllocation?.eventAllocationId;
    });
    attendees = [];
    attendeeDrafts = [];
    renderAttendees(quantity);
    updateSubmitDisabled();
    onQuantityChange?.(quantity);
    onQuantityReset?.();
    if (paid) loadSelectedPrice();
    onAllocationChange?.(selectedAllocation);
    onOccurrenceChange?.(selectedOccurrence);
    pendingSubmission = null;
  }

  form.addEventListener('input', () => {
    const currentSignature = JSON.stringify({
      allocationId: selectedAllocation?.eventAllocationId || null,
      commerceSku: selectedAllocation?.commerceSku || null,
      occurrenceId: selectedOccurrence?.occurrenceId || null,
      form: readForm(),
    });
    if (pendingSubmission?.signature !== currentSignature) {
      pendingSubmission = null;
    }
  });

  consent.addEventListener('input', () => {
    pendingSubmission = null;
  });

  function showPaidSuccess({
    bookedQuantity, bookedOccurrence, bookedAllocation,
    bookedPrice, normalizedForm,
  }) {
    const heading = createTextElement(
      'h3',
      'event-booking__success-heading',
      getLabel(labels, 'EventAddedHeading', 'Added to your cart'),
    );
    const summary = document.createElement('div');
    summary.className = 'event-booking__success-summary';
    const name = createTextElement('p', 'event-booking__success-name', product?.name || 'Event ticket');
    const details = createTextElement(
      'p',
      'event-booking__success-details',
      `${formatBookingDate(event, bookedOccurrence, true)} · ${event.venue.name}`,
    );
    const attendeeNames = normalizedForm.attendees
      .map((attendee) => `${attendee.firstName} ${attendee.lastName}`).join(', ');
    const tickets = createTextElement(
      'p',
      'event-booking__success-attendees',
      `${bookedQuantity} × ${getAllocationName(bookedAllocation)} — ${attendeeNames}`,
    );
    const subtotal = createTextElement(
      'p',
      'event-booking__success-subtotal',
      `${getLabel(labels, 'EventTicketSubtotalLabel', 'Ticket subtotal')} ${formatPrice({
        ...bookedPrice, amount: bookedPrice.amount * bookedQuantity,
      })}`,
    );
    summary.append(name, details, tickets, subtotal);
    const notice = createTextElement(
      'p',
      'event-booking__success-notice',
      getLabel(labels, 'EventPaymentRequired', 'Your tickets are not confirmed until you pay.'),
    );
    const links = document.createElement('div');
    links.className = 'event-booking__success-links';
    [
      [checkoutUrl, 'EventCheckoutLabel', 'Go to checkout', 'checkout'],
      [cartUrl, 'EventViewCartLabel', 'View cart', 'cart'],
      [browseUrl, 'EventKeepBrowsingLabel', 'Keep browsing events', 'browse'],
    ].forEach(([href, key, fallback, type]) => {
      if (!href) return;
      const link = createTextElement(
        'a',
        `event-booking__success-link--${type}`,
        getLabel(labels, key, fallback),
      );
      link.href = href;
      links.append(link);
    });
    const again = createTextElement(
      'button',
      'event-booking__book-again',
      getLabel(labels, 'EventBookMoreLabel', 'Book more tickets'),
    );
    again.type = 'button';
    const panel = container.closest('.event-booking-panel');
    again.addEventListener('click', () => {
      success.hidden = true;
      success.replaceChildren();
      form.hidden = false;
      panel?.classList.remove('event-booking-panel--success');
      if (actionsContainer) actionsContainer.hidden = false;
      form.querySelector('input:not(:disabled), select:not(:disabled)')?.focus();
    });
    success.replaceChildren(heading, summary, notice, links, again);
    panel?.classList.add('event-booking-panel--success');
    success.hidden = false;
    form.hidden = true;
    if (actionsContainer) actionsContainer.hidden = true;
    setTimeout(() => success.focus(), 0);
  }

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (submitting || (paid && !selectedPrice)) return;
    clearErrors();

    const rawForm = readForm();
    const validation = validateBookingForm(rawForm, MAXIMUM_DEMO_QUANTITY);
    if (!validation.valid) {
      showErrors(validation.errors);
      return;
    }
    if (!hasAvailableAllocation(selectedAllocation)) {
      feedback.textContent = getLabel(
        labels,
        'EventAllocationUnavailableLabel',
        'Select an available space to continue.',
      );
      return;
    }
    if (event.scheduleType === 'recurring' && (
      !selectedOccurrence || selectedOccurrence.availableQuantity < 1
    )) {
      feedback.textContent = getLabel(
        labels,
        'EventOccurrenceUnavailableLabel',
        'Select an available date and time to continue.',
      );
      return;
    }

    if (quantity > getQuantityLimit()) {
      feedback.textContent = getLabel(
        labels,
        'EventQuantityUnavailable',
        'The selected quantity is no longer available. Choose fewer tickets.',
      );
      feedback.focus();
      return;
    }

    const normalizedForm = normalizeBookingForm(rawForm);
    const signature = JSON.stringify({
      allocationId: selectedAllocation.eventAllocationId,
      commerceSku: selectedAllocation.commerceSku,
      occurrenceId: selectedOccurrence?.occurrenceId || null,
      form: normalizedForm,
    });
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

    submitting = true;
    submit.disabled = true;
    form.inert = true;
    form.setAttribute('aria-busy', 'true');
    if (actionsContainer) actionsContainer.inert = true;
    setSubmitLabel(getLabel(
      labels,
      'EventBookingSubmitting',
      'Adding to cart…',
    ));

    let successMessage = null;
    const bookedQuantity = quantity;
    const bookedOccurrence = selectedOccurrence;
    const bookedAllocation = selectedAllocation;
    const bookedPrice = selectedPrice ? { ...selectedPrice } : null;
    const bookedSummary = summaryElement?.cloneNode(true);
    try {
      const intentRef = await addToCart({
        allocation: selectedAllocation,
        form: normalizedForm,
        occurrence: selectedOccurrence,
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
      submitting = false;
      form.inert = false;
      form.removeAttribute('aria-busy');
      if (actionsContainer) actionsContainer.inert = false;
      updateSubmitDisabled();
      setSubmitLabel(getLabel(
        labels,
        'EventAddToCartLabel',
        paid ? 'Add to cart' : 'Add to Cart',
      ));
    }

    if (!successMessage) {
      if (paid) feedback.focus();
      return;
    }

    if (inline && paid) {
      showPaidSuccess({
        bookedQuantity, bookedOccurrence, bookedAllocation, bookedPrice, normalizedForm,
      });
    } else if (inline) {
      const heading = createTextElement('h3', 'event-booking__success-heading', getLabel(labels, 'EventAddedHeading', 'Added to your cart'));
      const name = createTextElement('p', 'event-booking__success-name', product?.name || getLabel(labels, 'EventTicketLabel', 'Event ticket'));
      const schedule = bookedOccurrence
        ? `${bookedOccurrence.localDate} · ${bookedOccurrence.startTime} – ${bookedOccurrence.endTime} (${bookedOccurrence.timezone})`
        : formatEventDateRange(event);
      const details = createTextElement('p', 'event-booking__success-details', `${schedule} · ${event.venue.name}`);
      const count = createTextElement('p', 'event-booking__success-count', `${bookedQuantity} ${getLabel(labels, 'EventSummaryTicketPlural', 'tickets')}`);
      const notice = createTextElement('p', 'event-booking__success-notice', getLabel(labels, 'EventPaymentRequired', 'Your tickets are not confirmed until you complete checkout.'));
      const links = document.createElement('div');
      links.className = 'event-booking__success-links';
      [
        [checkoutUrl, 'EventCheckoutLabel', 'Go to checkout'],
        [cartUrl, 'EventViewCartLabel', 'View cart'],
        [browseUrl, 'EventKeepBrowsingLabel', 'Keep browsing events'],
      ].forEach(([href, key, fallback]) => {
        if (!href) return;
        const link = document.createElement('a');
        link.href = href;
        link.textContent = getLabel(labels, key, fallback);
        links.append(link);
      });
      const again = createTextElement('button', 'event-booking__book-again', getLabel(labels, 'EventBookMoreLabel', 'Book more tickets'));
      again.type = 'button';
      again.addEventListener('click', () => {
        success.hidden = true;
        success.replaceChildren();
        form.hidden = false;
        if (actionsContainer) actionsContainer.hidden = false;
        form.querySelector('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus();
      });
      const allocationName = createTextElement(
        'p',
        'event-booking__success-allocation',
        [bookedAllocation?.space?.name, bookedAllocation?.zone?.name].filter(Boolean).join(' · '),
      );
      const attendeeNames = createTextElement(
        'p',
        'event-booking__success-attendees',
        normalizedForm.attendees.map((attendee) => `${attendee.firstName} ${attendee.lastName}`).join(', '),
      );
      success.replaceChildren(
        heading,
        name,
        details,
        count,
        ...(paid ? [allocationName, attendeeNames] : []),
        notice,
        links,
        again,
      );
      if (bookedSummary) notice.before(bookedSummary);
      success.hidden = false;
      form.hidden = true;
      if (actionsContainer) actionsContainer.hidden = true;
      setTimeout(() => success.focus(), 0);
    } else {
      close();
    }

    try {
      onSuccess?.(successMessage);
    } catch (error) {
      console.error('Failed to notify booking success:', error);
    }
  });

  renderAttendees(quantity);
  const formChildren = [formHeading, feedback];
  if (sessionSelector) formChildren.push(sessionSelector.fieldset);
  if (paid && occurrenceSelector) formChildren.push(occurrenceSelector.fieldset);
  formChildren.push(allocationSelector.fieldset);
  if (!paid && occurrenceSelector) formChildren.push(occurrenceSelector.fieldset);
  if (quantityElement && !paid) {
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
  if (!paid) formChildren.push(availabilityWarning);
  formChildren.push(...(paid ? [attendeesSection, contact] : [contact, attendeesContainer]));
  if (summaryElement && !paid) formChildren.push(summaryElement);
  form.append(...formChildren);

  if (actionsContainer) {
    actionsContainer.replaceChildren(actions);
  } else {
    form.append(actions);
  }

  if (inline) {
    container.replaceChildren(
      ...(includeMetadata ? [metadata] : []),
      success,
      form,
    );
  } else {
    container.replaceChildren(metadata);
  }

  if (paid) {
    loadSelectedPrice();
    form.addEventListener('focusin', (focusEvent) => {
      if (actions.contains(focusEvent.target)) return;
      if (getComputedStyle(actions).position !== 'sticky') return;
      const field = focusEvent.target.closest('.event-booking__field') || focusEvent.target;
      const overlap = field.getBoundingClientRect().bottom - actions.getBoundingClientRect().top;
      if (overlap >= 0) {
        const panel = form.closest('.event-booking-panel');
        if (panel) panel.scrollTop += overlap + 16;
      }
    });
  }

  let modal = null;

  async function open() {
    if (modal?.block?.isConnected) {
      modal.showModal();
      setTimeout(() => form.querySelector('[name="contact-firstName"]')?.focus(), 0);
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
    setTimeout(() => form.querySelector('[name="contact-firstName"]')?.focus(), 0);
  }

  function close() {
    modal?.removeModal();
  }

  function setQuantity(nextQuantity) {
    const maximum = getQuantityLimit();
    if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
      updateSubmitDisabled();
      feedback.textContent = `Choose between 0 and ${maximum || MAXIMUM_DEMO_QUANTITY} tickets.`;
      return;
    }
    quantity = Math.min(nextQuantity, maximum);
    pendingSubmission = null;
    renderAttendees(quantity);
    updateSubmitDisabled();
    onQuantityChange?.(quantity);
    feedback.textContent = '';
  }

  return Object.freeze({
    open,
    close,
    setQuantity,
    getSelectedAllocation: () => selectedAllocation,
    setAllocation(allocation) {
      if (allocations.includes(allocation)) {
        updateAllocationSelection(allocation);
      }
    },
    setSessionAvailability(availabilityEvent) {
      if (!sessionFirst) return;
      const known = availabilityEvent.allocations.filter((allocation) => (
        allocations.some((entry) => entry.eventAllocationId === allocation.eventAllocationId)
      ));
      known.forEach((allocation) => {
        const index = allocations.findIndex((entry) => (
          entry.eventAllocationId === allocation.eventAllocationId
        ));
        allocations[index] = allocation;
        allocationSelector.options[index].allocation = allocation;
      });
      sessionSelector.setAvailability({ ...availabilityEvent, allocations: known });
      updateSubmitDisabled();
    },
    setAvailabilityLoading() {
      if (sessionFirst) {
        sessionSelector.setAvailabilityState('loading');
        changeSession(null);
        return;
      }
      occurrenceSelector?.setAvailabilityState('loading');
      selectedOccurrence = null;
      updateSubmitDisabled();
      onOccurrenceChange?.(null);
    },
    setAvailabilityError() {
      if (sessionFirst) {
        sessionSelector.setAvailabilityState('error');
        changeSession(null);
        return;
      }
      occurrenceSelector?.setAvailabilityState('error');
      selectedOccurrence = null;
      updateSubmitDisabled();
      onOccurrenceChange?.(null);
    },
    setAllocationAvailability(allocation) {
      const index = allocations.findIndex(
        (entry) => entry.eventAllocationId === allocation?.eventAllocationId,
      );
      if (index < 0) return;

      allocations[index] = allocation;
      allocationSelector.options[index].allocation = allocation;
      allocationSelector.options[index].input.disabled = !canSelectAllocation(
        allocation,
        event.scheduleType,
      );
      if (selectedAllocation?.eventAllocationId !== allocation.eventAllocationId) return;

      selectedAllocation = allocation;
      occurrenceSelector?.setAvailabilityState('ready');
      selectedOccurrence = occurrenceSelector?.getSelected() || null;
      updateSubmitDisabled();
      onOccurrenceChange?.(selectedOccurrence);
    },
  });
}
