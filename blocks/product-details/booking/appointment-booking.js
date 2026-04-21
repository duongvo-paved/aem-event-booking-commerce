import { fetchBookingSlots, BOOKING_TYPE } from '../../../scripts/booking.js';
import {
  createStepper,
  createSectionLabel,
  renderSlotGrid,
  renderLoadingSlots,
} from './booking-availability.js';

/**
 * Renders the Appointment Booking configuration panel.
 * Flow: pick date → pick time slot → set attendee count.
 *
 * @param {HTMLElement} container - Mount target (appended into)
 * @param {Object} product - PDP product data from pdp/data event
 * @param {Object} labels - Merged placeholder strings
 * @param {Function} onSelectionChange - Called as (selection, isValid) on every change
 * @returns {{ getSelection: Function, isValid: Function }}
 */
export default function initAppointmentBooking(container, product, labels, onSelectionChange) {
  let selectedDate = '';
  let selectedSlot = null;
  let attendeeCount = 1;

  // ── Public interface (defined first so stepper/event callbacks can reference them) ──
  const getSelection = () => ({
    bookingType: BOOKING_TYPE.APPOINTMENT,
    date: selectedDate || null,
    slotId: selectedSlot?.slotId ?? null,
    slotLabel: selectedSlot
      ? (selectedSlot.label ?? `${selectedSlot.startTime} – ${selectedSlot.endTime}`)
      : null,
    attendeeCount,
    quantity: attendeeCount,
  });

  const isValid = () => !!(
    selectedDate
    && selectedSlot?.isAvailable
    && selectedSlot.availableCapacity > 0
    && attendeeCount >= 1
    && attendeeCount <= (selectedSlot.availableCapacity ?? Infinity)
  );

  const notify = () => onSelectionChange(getSelection(), isValid());

  // ── Panel root ────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'booking-panel booking-panel--appointment';

  // ── Section: Date ─────────────────────────────────────────────────────────
  const dateSection = document.createElement('div');
  dateSection.className = 'booking-panel__section';
  dateSection.appendChild(createSectionLabel(labels.Booking?.SelectDate ?? 'Select a date'));

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'booking-panel__date-input';
  const [today] = new Date().toISOString().split('T');
  dateInput.min = today;
  dateInput.setAttribute('aria-label', labels.Booking?.SelectDate ?? 'Select a date');
  dateSection.appendChild(dateInput);
  panel.appendChild(dateSection);

  // ── Section: Time Slots ───────────────────────────────────────────────────
  const slotSection = document.createElement('div');
  slotSection.className = 'booking-panel__section';
  slotSection.hidden = true;
  slotSection.appendChild(createSectionLabel(labels.Booking?.SelectTimeSlot ?? 'Select a time slot'));

  const slotGrid = document.createElement('div');
  slotGrid.className = 'booking-panel__slot-grid';
  slotSection.appendChild(slotGrid);
  panel.appendChild(slotSection);

  // ── Section: Attendees ────────────────────────────────────────────────────
  const attendeeSection = document.createElement('div');
  attendeeSection.className = 'booking-panel__section';
  attendeeSection.hidden = true;
  attendeeSection.appendChild(
    createSectionLabel(labels.Booking?.NumberOfAttendees ?? 'Number of attendees'),
  );

  const stepper = createStepper({
    value: 1,
    min: 1,
    max: 99,
    label: labels.Booking?.NumberOfAttendees ?? 'Number of attendees',
    onChange: (val) => {
      attendeeCount = val;
      notify();
    },
  });
  attendeeSection.appendChild(stepper);
  panel.appendChild(attendeeSection);

  container.appendChild(panel);

  // ── Slot loading ──────────────────────────────────────────────────────────
  const loadSlots = async (date) => {
    slotSection.hidden = false;
    attendeeSection.hidden = true;
    selectedSlot = null;
    renderLoadingSlots(slotGrid);
    notify();

    const slots = await fetchBookingSlots(product.sku, BOOKING_TYPE.APPOINTMENT, { date });

    renderSlotGrid(
      slotGrid,
      slots,
      null,
      (slot) => {
        selectedSlot = slot;
        const maxCap = slot.availableCapacity > 0 ? slot.availableCapacity : 99;
        stepper.setMax(maxCap);
        attendeeSection.hidden = false;
        notify();
      },
      labels.Booking?.NoSlotsAvailable ?? 'No time slots available for this date.',
    );
  };

  dateInput.addEventListener('change', () => {
    selectedDate = dateInput.value;
    selectedSlot = null;
    attendeeSection.hidden = true;
    if (selectedDate) loadSlots(selectedDate);
    notify();
  });

  return { getSelection, isValid };
}
