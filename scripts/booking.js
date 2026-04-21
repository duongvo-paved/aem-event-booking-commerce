import { FetchGraphQL } from '@dropins/tools/fetch-graphql.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { rootLink } from './commerce.js';

/**
 * Booking types supported by the storefront.
 * Corresponds to the `booking_type` Commerce product attribute.
 */
export const BOOKING_TYPE = {
  APPOINTMENT: 'appointment',
  EVENT: 'event',
  VENUE: 'venue',
};

/**
 * Booking status values returned by the App Builder API.
 */
export const BOOKING_STATUS = {
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

// Customer paths
export const CUSTOMER_BOOKINGS_PATH = '/customer/bookings';

/**
 * Dedicated FetchGraphQL instance for the booking API Mesh endpoint.
 * Configured separately from Commerce core/catalog endpoints.
 */
export const BOOKING_FETCH_GRAPHQL = new FetchGraphQL();

/**
 * Initializes the booking GraphQL endpoint from site config.
 * Must be called once during page initialization (see initializers/booking.js).
 */
export async function initializeBookingEndpoint() {
  const endpoint = await getConfigValue('booking-api-mesh-endpoint');
  if (endpoint) {
    BOOKING_FETCH_GRAPHQL.setEndpoint(endpoint);
  } else {
    console.warn('[booking] booking-api-mesh-endpoint config not set; booking API calls will fail.');
  }
}

/**
 * Sets the Authorization header on the booking GraphQL instance.
 * @param {boolean} authenticated - Whether the user is authenticated
 * @param {string} [token] - Bearer token for authenticated requests
 */
export function setBookingAuthHeader(authenticated, token) {
  if (authenticated && token) {
    BOOKING_FETCH_GRAPHQL.setFetchGraphQlHeader('Authorization', `Bearer ${token}`);
  } else {
    BOOKING_FETCH_GRAPHQL.removeFetchGraphQlHeader('Authorization');
  }
}

/**
 * Fetches available booking slots for a product on a given date.
 *
 * @param {string} sku - The product SKU
 * @param {string} bookingType - One of BOOKING_TYPE values
 * @param {Object} [options]
 * @param {string} [options.date] - ISO date string (YYYY-MM-DD); for appointment/event types
 * @param {string} [options.startDate] - ISO date string; start of range for venue bookings
 * @param {string} [options.endDate] - ISO date string; end of range for venue bookings
 * @returns {Promise<Array>} Array of available slot objects
 */
export async function fetchBookingSlots(sku, bookingType, options = {}) {
  const { date, startDate, endDate } = options;

  const { data, errors } = await BOOKING_FETCH_GRAPHQL.fetchGraphQl(`
    query GetBookingSlots(
      $sku: String!
      $bookingType: String!
      $date: String
      $startDate: String
      $endDate: String
    ) {
      bookingSlots(
        sku: $sku
        bookingType: $bookingType
        date: $date
        startDate: $startDate
        endDate: $endDate
      ) {
        slotId
        label
        date
        startTime
        endTime
        capacity
        availableCapacity
        isAvailable
      }
    }
  `, {
    variables: {
      sku,
      bookingType,
      date: date ?? null,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    },
    method: 'GET',
  });

  if (errors?.length) {
    console.error('[booking] fetchBookingSlots errors:', errors);
    return [];
  }

  return data?.bookingSlots ?? [];
}

/**
 * Fetches available dates for a product (for calendar/date-picker rendering).
 *
 * @param {string} sku - The product SKU
 * @param {string} bookingType - One of BOOKING_TYPE values
 * @param {string} month - Month in YYYY-MM format
 * @returns {Promise<Array<string>>} Array of available ISO date strings
 */
export async function fetchAvailableDates(sku, bookingType, month) {
  const { data, errors } = await BOOKING_FETCH_GRAPHQL.fetchGraphQl(`
    query GetAvailableDates(
      $sku: String!
      $bookingType: String!
      $month: String!
    ) {
      bookingAvailableDates(
        sku: $sku
        bookingType: $bookingType
        month: $month
      ) {
        date
        hasAvailability
      }
    }
  `, {
    variables: { sku, bookingType, month },
    method: 'GET',
  });

  if (errors?.length) {
    console.error('[booking] fetchAvailableDates errors:', errors);
    return [];
  }

  return data?.bookingAvailableDates ?? [];
}

/**
 * Fetches the authenticated customer's bookings.
 *
 * @param {Object} [options]
 * @param {number} [options.pageSize=10]
 * @param {number} [options.currentPage=1]
 * @param {string} [options.status] - Filter by BOOKING_STATUS value
 * @returns {Promise<{items: Array, totalCount: number, pageInfo: Object}>}
 */
export async function fetchMyBookings({ pageSize = 10, currentPage = 1, status } = {}) {
  const { data, errors } = await BOOKING_FETCH_GRAPHQL.fetchGraphQl(`
    query GetMyBookings(
      $pageSize: Int
      $currentPage: Int
      $status: String
    ) {
      myBookings(
        pageSize: $pageSize
        currentPage: $currentPage
        status: $status
      ) {
        totalCount
        pageInfo {
          currentPage
          pageSize
          totalPages
        }
        items {
          bookingId
          bookingReference
          status
          bookingType
          productSku
          productName
          productImage
          date
          startTime
          endTime
          location
          attendeeCount
          orderId
          orderNumber
          createdAt
          notes
        }
      }
    }
  `, {
    variables: {
      pageSize,
      currentPage,
      status: status ?? null,
    },
  });

  if (errors?.length) {
    console.error('[booking] fetchMyBookings errors:', errors);
    return { items: [], totalCount: 0, pageInfo: {} };
  }

  return data?.myBookings ?? { items: [], totalCount: 0, pageInfo: {} };
}

/**
 * Cancels a booking by its ID.
 *
 * @param {string} bookingId - The booking ID to cancel
 * @returns {Promise<{success: boolean, booking: Object|null, message: string}>}
 */
export async function cancelBooking(bookingId) {
  const { data, errors } = await BOOKING_FETCH_GRAPHQL.fetchGraphQl(`
    mutation CancelBooking($bookingId: String!) {
      cancelBooking(bookingId: $bookingId) {
        success
        message
        booking {
          bookingId
          bookingReference
          status
        }
      }
    }
  `, {
    variables: { bookingId },
  });

  if (errors?.length) {
    console.error('[booking] cancelBooking errors:', errors);
    return { success: false, booking: null, message: errors[0]?.message ?? 'Cancellation failed.' };
  }

  return data?.cancelBooking ?? { success: false, booking: null, message: 'No response from server.' };
}

/**
 * Reads the booking_type attribute from a PDP product data object.
 * Returns null if the product is not a bookable product.
 *
 * @param {Object} product - Product data object from pdp/data event
 * @returns {string|null} booking type string or null
 */
export function getBookingType(product) {
  if (!product?.attributes) return null;
  const attr = product.attributes.find((a) => a.name === 'booking_type');
  return attr?.value ?? null;
}

/**
 * Returns a localized path to the customer bookings page.
 * @returns {string}
 */
export function getBookingsLink() {
  return rootLink(CUSTOMER_BOOKINGS_PATH);
}

/**
 * Formats a booking date/time range for display.
 * @param {string} date - ISO date string
 * @param {string} [startTime] - Time string (HH:MM)
 * @param {string} [endTime] - Time string (HH:MM)
 * @param {string} [locale] - BCP 47 locale string, defaults to document language
 * @returns {string} Human-readable date/time string
 */
export function formatBookingDateTime(date, startTime, endTime, locale) {
  const lang = locale ?? document.documentElement.lang ?? 'en';

  try {
    const dateObj = new Date(`${date}T00:00:00`);
    const dateStr = dateObj.toLocaleDateString(lang, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    if (startTime && endTime) {
      return `${dateStr} · ${startTime} – ${endTime}`;
    }
    if (startTime) {
      return `${dateStr} · ${startTime}`;
    }
    return dateStr;
  } catch {
    return date;
  }
}
