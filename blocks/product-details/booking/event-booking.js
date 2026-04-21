import { fetchBookingSlots, BOOKING_TYPE, formatBookingDateTime } from '../../../scripts/booking.js';
import {
  createStepper,
  createSectionLabel,
  renderLoadingSlots,
} from './booking-availability.js';

/**
 * Renders the Event Booking configuration panel.
 * Flow: view upcoming sessions → pick one → set ticket quantity.
 *
 * Sessions are loaded on mount (no date filter needed — events have fixed schedules).
 *
 * @param {HTMLElement} container - Mount target
 * @param {Object} product - PDP product data
 * @param {Object} labels - Merged placeholder strings
 * @param {Function} onSelectionChange - Called as (selection, isValid) on every change
 * @returns {{ getSelection: Function, isValid: Function }}
 */
export default function initEventBooking(container, product, labels, onSelectionChange) {
  let selectedSession = null;
  let ticketCount = 1;

  // ── Public interface (defined first so stepper/event callbacks can reference them) ──
  const getSelection = () => ({
    bookingType: BOOKING_TYPE.EVENT,
    sessionId: selectedSession?.slotId ?? null,
    sessionLabel: selectedSession
      ? formatBookingDateTime(
        selectedSession.date,
        selectedSession.startTime,
        selectedSession.endTime,
      )
      : null,
    sessionDate: selectedSession?.date ?? null,
    ticketCount,
    quantity: ticketCount,
  });

  const isValid = () => !!(
    selectedSession?.isAvailable
    && selectedSession.availableCapacity > 0
    && ticketCount >= 1
    && ticketCount <= (selectedSession.availableCapacity ?? Infinity)
  );

  const notify = () => onSelectionChange(getSelection(), isValid());

  // ── Panel root ────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'booking-panel booking-panel--event';

  // ── Section: Session selection ────────────────────────────────────────────
  const sessionSection = document.createElement('div');
  sessionSection.className = 'booking-panel__section';
  sessionSection.appendChild(
    createSectionLabel(labels.Booking?.SelectSession ?? 'Select a session'),
  );

  const sessionList = document.createElement('div');
  sessionList.className = 'booking-panel__session-list';
  sessionSection.appendChild(sessionList);
  panel.appendChild(sessionSection);

  // ── Section: Tickets ──────────────────────────────────────────────────────
  const ticketSection = document.createElement('div');
  ticketSection.className = 'booking-panel__section';
  ticketSection.hidden = true;
  ticketSection.appendChild(
    createSectionLabel(labels.Booking?.NumberOfTickets ?? 'Number of tickets'),
  );

  const stepper = createStepper({
    value: 1,
    min: 1,
    max: 99,
    label: labels.Booking?.NumberOfTickets ?? 'Number of tickets',
    onChange: (val) => {
      ticketCount = val;
      notify();
    },
  });
  ticketSection.appendChild(stepper);
  panel.appendChild(ticketSection);

  container.appendChild(panel);

  // ── Session rendering ──────────────────────────────────────────────────────
  const renderSessions = (sessions) => {
    sessionList.innerHTML = '';

    if (!sessions?.length) {
      const empty = document.createElement('p');
      empty.className = 'booking-panel__empty';
      empty.textContent = labels.Booking?.NoSessionsAvailable ?? 'No upcoming sessions available.';
      sessionList.appendChild(empty);
      return;
    }

    const listEl = document.createElement('ul');
    listEl.className = 'booking-session-list';
    listEl.setAttribute('role', 'radiogroup');
    listEl.setAttribute('aria-label', labels.Booking?.SelectSession ?? 'Select a session');

    sessions.forEach((session) => {
      const item = document.createElement('li');
      item.className = 'booking-session-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'booking-session-card';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.dataset.sessionId = session.slotId;

      const isUnavailable = !session.isAvailable || session.availableCapacity <= 0;
      if (isUnavailable) {
        btn.disabled = true;
        btn.classList.add('booking-session-card--unavailable');
      }

      // Date/time row
      const dateEl = document.createElement('span');
      dateEl.className = 'booking-session-card__date';
      dateEl.textContent = formatBookingDateTime(
        session.date,
        session.startTime,
        session.endTime,
      );
      btn.appendChild(dateEl);

      // Label / venue (use label field from API for venue/room name)
      if (session.label) {
        const labelEl = document.createElement('span');
        labelEl.className = 'booking-session-card__label';
        labelEl.textContent = session.label;
        btn.appendChild(labelEl);
      }

      // Availability
      const availEl = document.createElement('span');
      availEl.className = 'booking-session-card__availability';
      if (isUnavailable) {
        availEl.textContent = labels.Booking?.SoldOut ?? 'Sold out';
        availEl.classList.add('booking-session-card__availability--sold-out');
      } else if (session.availableCapacity !== undefined) {
        availEl.textContent = (labels.Booking?.SpotsLeft ?? '{n} spots left')
          .replace('{n}', session.availableCapacity);
        availEl.classList.add('booking-session-card__availability--available');
      }
      btn.appendChild(availEl);

      btn.addEventListener('click', () => {
        if (isUnavailable) return;
        listEl.querySelectorAll('.booking-session-card').forEach((c) => {
          c.classList.remove('booking-session-card--selected');
          c.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('booking-session-card--selected');
        btn.setAttribute('aria-checked', 'true');

        selectedSession = session;
        const maxTickets = session.availableCapacity > 0 ? session.availableCapacity : 99;
        stepper.setMax(maxTickets);
        ticketSection.hidden = false;
        notify();
      });

      item.appendChild(btn);
      listEl.appendChild(item);
    });

    sessionList.appendChild(listEl);
  };

  // Load sessions on mount
  (async () => {
    renderLoadingSlots(sessionList, 2);
    const sessions = await fetchBookingSlots(product.sku, BOOKING_TYPE.EVENT);
    renderSessions(sessions);
  })();

  return { getSelection, isValid };
}
