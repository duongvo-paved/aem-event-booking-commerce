import { createEventAppClient } from '../../scripts/event-app/client.js';
import { getSafeErrorMessage } from '../../scripts/event-app/errors.js';
import { validateBookingReference } from '../../scripts/event-app/validation.js';

function cloneRowContent(row) {
  if (!row) return null;
  const wrapper = document.createElement('div');
  [...row.children].forEach((cell) => {
    [...cell.childNodes].forEach((node) => wrapper.append(node.cloneNode(true)));
  });
  return wrapper.hasChildNodes() ? wrapper : null;
}

function readAuthoredContent(block) {
  const rows = [...block.children];
  return {
    heading: cloneRowContent(rows[0]),
    introduction: cloneRowContent(rows[1]),
    support: cloneRowContent(rows[2]),
  };
}

function createStatus(text, role = 'status') {
  const status = document.createElement('p');
  status.className = 'event-ticket__message';
  status.setAttribute('role', role);
  status.textContent = text;
  return status;
}

function getStatusModifier(status) {
  const normalized = status.toLowerCase();
  if (['active', 'confirmed', 'issued'].includes(normalized)) return 'active';
  if (['invalidated', 'cancelled', 'canceled', 'expired'].includes(normalized)) {
    return 'invalid';
  }
  return 'pending';
}

function createDefinition(term, description) {
  const termElement = document.createElement('dt');
  termElement.textContent = term;
  const descriptionElement = document.createElement('dd');
  descriptionElement.textContent = description;
  return [termElement, descriptionElement];
}

function renderBooking(container, booking) {
  const bookingSection = document.createElement('section');
  bookingSection.className = 'event-ticket__booking';
  bookingSection.setAttribute('aria-labelledby', 'event-ticket-booking-heading');

  const heading = document.createElement('h2');
  heading.id = 'event-ticket-booking-heading';
  heading.textContent = 'Booking status';

  const details = document.createElement('dl');
  details.append(...createDefinition('Status', booking.status));
  if (booking.orderIncrementId) {
    details.append(
      ...createDefinition('Order number', booking.orderIncrementId),
    );
  }

  const ticketList = document.createElement('div');
  ticketList.className = 'event-ticket__list';

  booking.tickets.forEach((ticket, index) => {
    const article = document.createElement('article');
    const modifier = getStatusModifier(ticket.status);
    article.className = `event-ticket__ticket event-ticket__ticket--${modifier}`;

    const ticketHeading = document.createElement('h3');
    ticketHeading.textContent = `Ticket ${index + 1}`;

    const ticketDetails = document.createElement('dl');
    ticketDetails.append(
      ...createDefinition('Ticket reference', ticket.ticketRef),
      ...createDefinition('Status', ticket.status),
    );

    const image = document.createElement('img');
    image.alt = `QR code for ticket ${index + 1}`;
    image.className = 'event-ticket__qr';
    image.decoding = 'async';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.src = ticket.qrRenderUrl;

    article.append(ticketHeading, ticketDetails, image);
    ticketList.append(article);
  });

  bookingSection.append(heading, details, ticketList);
  container.replaceChildren(bookingSection);
}

export default async function decorate(block) {
  const authored = readAuthoredContent(block);
  const client = createEventAppClient();

  const wrapper = document.createElement('div');
  wrapper.className = 'event-ticket__wrapper';

  const content = document.createElement('div');
  content.className = 'event-ticket__content';
  if (authored.heading) content.append(authored.heading);
  if (authored.introduction) content.append(authored.introduction);

  const result = document.createElement('div');
  result.className = 'event-ticket__result';
  result.setAttribute('aria-live', 'polite');
  result.setAttribute('aria-busy', 'false');

  if (authored.support) {
    authored.support.className = 'event-ticket__support';
  }

  wrapper.append(content, result);
  if (authored.support) wrapper.append(authored.support);
  block.replaceChildren(wrapper);

  const bookingRef = new URL(window.location.href).searchParams.get('booking_ref');

  async function loadBooking() {
    result.setAttribute('aria-busy', 'true');
    result.replaceChildren(createStatus('Loading booking…'));

    try {
      if (!validateBookingReference(bookingRef)) {
        result.replaceChildren(createStatus('This booking link is invalid.', 'alert'));
        return;
      }
      if (!client.config.enabled) {
        result.replaceChildren(createStatus(
          'Ticket lookup is not available right now.',
          'alert',
        ));
        return;
      }

      const booking = await client.getPublicBooking(bookingRef);
      if (booking.bookingRef !== bookingRef) {
        result.replaceChildren(createStatus(
          'The booking response did not match this link.',
          'alert',
        ));
        return;
      }
      renderBooking(result, booking);
    } catch (error) {
      const errorWrapper = document.createElement('div');
      errorWrapper.className = 'event-ticket__error';
      errorWrapper.append(createStatus(getSafeErrorMessage(error), 'alert'));

      if (error?.retryable) {
        const retry = document.createElement('button');
        retry.className = 'button event-ticket__retry';
        retry.type = 'button';
        retry.textContent = 'Try again';
        retry.addEventListener('click', loadBooking);
        errorWrapper.append(retry);
      }
      result.replaceChildren(errorWrapper);
    } finally {
      result.setAttribute('aria-busy', 'false');
    }
  }

  await loadBooking();
}
