import { BOOKING_TYPE } from '../../../scripts/booking.js';

/**
 * Initialises the correct booking panel for the given booking type and mounts it
 * into the provided container. Returns null when the type is unrecognised.
 *
 * @param {HTMLElement} container - DOM node to mount the panel into
 * @param {string} bookingType - One of BOOKING_TYPE values
 * @param {Object} product - PDP product data
 * @param {Object} labels - Merged placeholder strings
 * @param {Function} onSelectionChange - Called as (selection, isValid) on every change
 * @returns {Promise<{getSelection: Function, isValid: Function}|null>}
 */
export default async function initBookingPanel(
  container,
  bookingType,
  product,
  labels,
  onSelectionChange,
) {
  if (bookingType === BOOKING_TYPE.APPOINTMENT) {
    const { default: init } = await import('./appointment-booking.js');
    return init(container, product, labels, onSelectionChange);
  }

  if (bookingType === BOOKING_TYPE.EVENT) {
    const { default: init } = await import('./event-booking.js');
    return init(container, product, labels, onSelectionChange);
  }

  if (bookingType === BOOKING_TYPE.VENUE) {
    const { default: init } = await import('./venue-booking.js');
    return init(container, product, labels, onSelectionChange);
  }

  console.warn(`[booking] Unknown booking type: "${bookingType}"`);
  return null;
}
