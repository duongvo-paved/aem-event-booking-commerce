import { fetchBookingSlots, BOOKING_TYPE } from '../../../scripts/booking.js';
import {
  createStepper,
  createSectionLabel,
} from './booking-availability.js';

/**
 * Renders the Venue Booking configuration panel.
 * Flow: pick check-in date → pick check-out date → set capacity needed.
 * Fetches availability when both dates are selected.
 *
 * @param {HTMLElement} container - Mount target
 * @param {Object} product - PDP product data
 * @param {Object} labels - Merged placeholder strings
 * @param {Function} onSelectionChange - Called as (selection, isValid) on every change
 * @returns {{ getSelection: Function, isValid: Function }}
 */
export default function initVenueBooking(container, product, labels, onSelectionChange) {
  let startDate = '';
  let endDate = '';
  let capacityNeeded = 1;
  let venueAvailable = null; // null = not checked, true/false = checked result

  const today = new Date().toISOString().split('T')[0];

  // ── Panel root ────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'booking-panel booking-panel--venue';

  // ── Section: Check-in Date ────────────────────────────────────────────────
  const checkinSection = document.createElement('div');
  checkinSection.className = 'booking-panel__section';
  checkinSection.appendChild(
    createSectionLabel(labels.Booking?.CheckInDate ?? 'Check-in date'),
  );

  const checkinInput = document.createElement('input');
  checkinInput.type = 'date';
  checkinInput.className = 'booking-panel__date-input';
  checkinInput.min = today;
  checkinInput.setAttribute('aria-label', labels.Booking?.CheckInDate ?? 'Check-in date');
  checkinSection.appendChild(checkinInput);
  panel.appendChild(checkinSection);

  // ── Section: Check-out Date ───────────────────────────────────────────────
  const checkoutSection = document.createElement('div');
  checkoutSection.className = 'booking-panel__section';
  checkoutSection.appendChild(
    createSectionLabel(labels.Booking?.CheckOutDate ?? 'Check-out date'),
  );

  const checkoutInput = document.createElement('input');
  checkoutInput.type = 'date';
  checkoutInput.className = 'booking-panel__date-input';
  checkoutInput.min = today;
  checkoutInput.disabled = true;
  checkoutInput.setAttribute('aria-label', labels.Booking?.CheckOutDate ?? 'Check-out date');
  checkoutSection.appendChild(checkoutInput);
  panel.appendChild(checkoutSection);

  // ── Section: Capacity ─────────────────────────────────────────────────────
  const capacitySection = document.createElement('div');
  capacitySection.className = 'booking-panel__section';
  capacitySection.appendChild(
    createSectionLabel(labels.Booking?.CapacityNeeded ?? 'Number of guests'),
  );

  const stepper = createStepper({
    value: 1,
    min: 1,
    max: 999,
    label: labels.Booking?.CapacityNeeded ?? 'Number of guests',
    onChange: (val) => {
      capacityNeeded = val;
      notify();
    },
  });
  capacitySection.appendChild(stepper);
  panel.appendChild(capacitySection);

  // ── Availability feedback ─────────────────────────────────────────────────
  const availFeedback = document.createElement('div');
  availFeedback.className = 'booking-panel__availability-feedback';
  availFeedback.setAttribute('aria-live', 'polite');
  panel.appendChild(availFeedback);

  container.appendChild(panel);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const notify = () => onSelectionChange(getSelection(), isValid());

  const showAvailFeedback = (available) => {
    availFeedback.innerHTML = '';
    if (available === null) return;

    const msg = document.createElement('p');
    msg.className = available
      ? 'booking-panel__avail-msg booking-panel__avail-msg--available'
      : 'booking-panel__avail-msg booking-panel__avail-msg--unavailable';
    msg.textContent = available
      ? (labels.Booking?.VenueAvailable ?? 'This venue is available for your selected dates.')
      : (labels.Booking?.VenueUnavailable ?? 'This venue is not available for the selected dates. Please choose different dates.');
    availFeedback.appendChild(msg);
  };

  const checkAvailability = async () => {
    if (!startDate || !endDate) return;
    venueAvailable = null;
    showAvailFeedback(null);

    const slots = await fetchBookingSlots(product.sku, BOOKING_TYPE.VENUE, {
      startDate,
      endDate,
    });

    // A non-empty result with at least one available slot means the venue is available
    venueAvailable = slots.length > 0 && slots.some((s) => s.isAvailable);

    // Update stepper max with venue capacity if provided
    const venueSlot = slots.find((s) => s.isAvailable);
    if (venueSlot?.capacity) stepper.setMax(venueSlot.capacity);

    showAvailFeedback(venueAvailable);
    notify();
  };

  checkinInput.addEventListener('change', () => {
    startDate = checkinInput.value;
    endDate = '';
    venueAvailable = null;
    showAvailFeedback(null);

    if (startDate) {
      // Advance checkout min by one day
      const nextDay = new Date(startDate);
      nextDay.setDate(nextDay.getDate() + 1);
      checkoutInput.min = nextDay.toISOString().split('T')[0];
      checkoutInput.disabled = false;
      checkoutInput.value = '';
    } else {
      checkoutInput.disabled = true;
      checkoutInput.value = '';
    }
    notify();
  });

  checkoutInput.addEventListener('change', () => {
    endDate = checkoutInput.value;
    venueAvailable = null;
    if (startDate && endDate) checkAvailability();
    notify();
  });

  // ── Public interface ──────────────────────────────────────────────────────
  const getSelection = () => ({
    bookingType: BOOKING_TYPE.VENUE,
    startDate: startDate || null,
    endDate: endDate || null,
    capacityNeeded,
    quantity: capacityNeeded,
  });

  const isValid = () => !!(
    startDate
    && endDate
    && endDate > startDate
    && capacityNeeded >= 1
    && venueAvailable === true
  );

  return { getSelection, isValid };
}
