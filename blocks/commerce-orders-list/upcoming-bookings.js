import { loadUpcomingBookings } from '../../scripts/event-app/upcoming-bookings.js';
import { createCalendarButton } from '../../scripts/event-app/calendar.js';
import { formatEventHeadlineDate, formatOccurrenceDate } from '../../scripts/event-app/dates.js';

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function detailRow(className, text, type) {
  const row = textElement('p', className, text);
  const paths = {
    date: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18',
    location: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z M14.2 11a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z',
    venue: 'M4 21h16 M6 21V3h12v18 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M10 21v-5h4v5',
    ticket: 'M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4z M9 7v3 M9 12v2 M9 16v3',
  };
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.5');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[type]);
  icon.append(path);
  row.prepend(icon);
  return row;
}

function createUpcomingBookingPlaceholder() {
  const row = document.createElement('li');
  row.className = 'upcoming-booking upcoming-booking--skeleton';
  row.setAttribute('aria-hidden', 'true');
  const image = document.createElement('span');
  image.className = 'upcoming-booking__skeleton-image';
  const content = document.createElement('span');
  content.className = 'upcoming-booking__skeleton-content';
  for (let index = 0; index < 4; index += 1) {
    const line = document.createElement('span');
    line.className = `upcoming-booking__skeleton-line upcoming-booking__skeleton-line--${index + 1}`;
    content.append(line);
  }
  row.append(image, content);
  return row;
}

export function createBookingRow(booking, orderLink) {
  const row = document.createElement('li');
  row.className = 'upcoming-booking';
  const thumbnail = document.createElement('div');
  thumbnail.className = 'upcoming-booking__thumbnail';
  if (booking.image) {
    const image = document.createElement('img');
    image.src = booking.image;
    image.alt = '';
    image.loading = 'lazy';
    image.width = 130;
    image.height = 84;
    image.addEventListener('error', () => image.remove(), { once: true });
    thumbnail.append(image);
  }
  const content = document.createElement('div');
  content.className = 'upcoming-booking__content';
  content.append(textElement('h3', 'upcoming-booking__name', booking.name));
  const hasEventDate = Boolean(booking.event);
  let date;
  if (hasEventDate) {
    if (booking.occurrence) {
      date = formatOccurrenceDate(booking.occurrence, document.documentElement.lang || 'en');
    } else if (booking.event.scheduleType !== 'recurring') {
      date = formatEventHeadlineDate(booking.event, document.documentElement.lang || 'en');
    }
  } else {
    date = booking.orderSummary || `Ordered on ${booking.orderDate || 'date unavailable'}`;
  }
  if (date && (hasEventDate || booking.showOrderMetadata !== false)) {
    content.append(detailRow('upcoming-booking__date', date, 'date'));
  }
  if (hasEventDate && booking.orderSummary && booking.showOrderMetadata !== false) {
    content.append(detailRow('upcoming-booking__ordered', booking.orderSummary, 'date'));
  }
  const venue = booking.event?.venue;
  if (venue?.address) {
    content.append(detailRow(
      'upcoming-booking__location',
      venue.address,
      'location',
    ));
  }
  if (venue?.name) {
    content.append(detailRow(
      'upcoming-booking__venue',
      venue.name,
      'venue',
    ));
  }
  if (booking.isEvent !== false) {
    const quantity = Number(booking.quantity);
    const tickets = Number.isFinite(quantity) && quantity > 0
      ? `${quantity} ticket${quantity === 1 ? '' : 's'}` : '';
    content.append(detailRow(
      'upcoming-booking__reference',
      [tickets, booking.orderSummary ? '' : `Order ${booking.orderNumber}`]
        .filter(Boolean).join(' · '),
      'ticket',
    ));
  }
  const actions = document.createElement('div');
  actions.className = 'upcoming-booking__actions';
  if (booking.showOrderLink !== false) {
    const details = textElement('a', 'upcoming-booking__details', 'View order');
    details.href = orderLink(booking.orderNumber);
    details.setAttribute('aria-label', `View order ${booking.orderNumber} for ${booking.name}`);
    actions.append(details);
  }
  const calendar = booking.event && createCalendarButton(booking);
  if (calendar) actions.append(calendar);
  if (actions.childElementCount) content.append(actions);
  row.append(thumbnail, content);
  return row;
}

export default function renderUpcomingBookings(block, options) {
  const earlyPlaceholder = block.querySelector(':scope > .account-loading-placeholder');
  block.replaceChildren();
  block.classList.add('commerce-orders-list--upcoming');
  const heading = textElement(
    'h2',
    'dropin-header-container__title upcoming-bookings__heading',
    'Coming up',
  );
  const status = textElement('div', 'upcoming-bookings__status', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Loading upcoming bookings');
  status.setAttribute('aria-busy', 'true');
  const list = document.createElement('ul');
  list.className = 'upcoming-bookings__list';
  list.setAttribute('aria-label', 'Upcoming bookings');
  list.setAttribute('aria-busy', 'true');
  list.append(createUpcomingBookingPlaceholder(), createUpcomingBookingPlaceholder());
  const allOrders = textElement('a', 'upcoming-bookings__all-orders', 'View all orders');
  allOrders.href = options.ordersLink;
  block.append(heading, status, list, allOrders);
  loadUpcomingBookings(options).then(({ bookings, unavailable }) => {
    list.replaceChildren();
    bookings.forEach((booking) => list.append(createBookingRow(booking, options.orderLink)));
    status.textContent = bookings.length ? '' : 'No upcoming bookings';
    if (unavailable) status.textContent = 'Some event details are temporarily unavailable.';
    if (!bookings.length && !unavailable) {
      status.classList.add('upcoming-bookings__empty');
      status.replaceChildren(
        textElement('h3', 'upcoming-bookings__empty-title', 'No bookings yet'),
        textElement(
          'p',
          'upcoming-bookings__empty-description',
          "When you book an event, your tickets will show up here so you don't have to search your email for them.",
        ),
      );
    }
    status.hidden = !status.textContent;
  }).catch((error) => {
    status.textContent = 'Upcoming bookings are temporarily unavailable. View all orders for your bookings.';
    console.error('Unable to load upcoming bookings', error);
  }).finally(() => {
    earlyPlaceholder?.remove();
    status.removeAttribute('aria-busy');
    list.setAttribute('aria-busy', 'false');
    block.removeAttribute('aria-busy');
  });
}
