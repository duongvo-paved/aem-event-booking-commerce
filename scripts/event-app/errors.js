export const EVENT_APP_ERROR_TYPES = Object.freeze({
  ABORTED: 'aborted',
  CONFIGURATION: 'configuration',
  DUPLICATE: 'duplicate',
  INTEGRITY: 'integrity',
  INVALID_RESPONSE: 'invalid-response',
  NETWORK: 'network',
  NOT_FOUND: 'not-found',
  REQUEST: 'request',
  SERVER: 'server',
  TIMEOUT: 'timeout',
  UNAVAILABLE: 'unavailable',
});

export class EventAppError extends Error {
  constructor(type, message, options = {}) {
    super(message, options);
    this.name = 'EventAppError';
    this.type = type;
    this.status = options.status;
    this.retryable = options.retryable === true;
  }
}

export function mapEventAppStatusToError(status) {
  if (status === 404) {
    return new EventAppError(
      EVENT_APP_ERROR_TYPES.NOT_FOUND,
      'Event App resource was not found',
      { status },
    );
  }
  if ([400, 413, 415, 422].includes(status)) {
    return new EventAppError(
      EVENT_APP_ERROR_TYPES.REQUEST,
      'Event App request was rejected',
      { status },
    );
  }
  if (status === 409) {
    return new EventAppError(
      EVENT_APP_ERROR_TYPES.DUPLICATE,
      'A booking intent already exists for this cart and SKU',
      { status },
    );
  }
  return new EventAppError(
    EVENT_APP_ERROR_TYPES.SERVER,
    'Event App service failed',
    { retryable: status >= 500, status },
  );
}

export function getSafeErrorMessage(error) {
  switch (error?.type) {
    case EVENT_APP_ERROR_TYPES.CONFIGURATION:
      return 'Event booking is not available right now.';
    case EVENT_APP_ERROR_TYPES.NOT_FOUND:
      return 'This event or booking could not be found.';
    case EVENT_APP_ERROR_TYPES.DUPLICATE:
      return 'This event is already being booked in your cart.';
    case EVENT_APP_ERROR_TYPES.INTEGRITY:
      return 'This event needs attention in your cart before you can book it again.';
    case EVENT_APP_ERROR_TYPES.REQUEST:
      return 'Please check the information provided and try again.';
    case EVENT_APP_ERROR_TYPES.TIMEOUT:
    case EVENT_APP_ERROR_TYPES.NETWORK:
    case EVENT_APP_ERROR_TYPES.SERVER:
      return 'The event service is temporarily unavailable. Please try again.';
    case EVENT_APP_ERROR_TYPES.INVALID_RESPONSE:
      return 'The event service returned an unexpected response.';
    default:
      return 'Event booking is temporarily unavailable.';
  }
}
