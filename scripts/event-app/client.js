import { getEventAppConfig, requireEventAppAction } from './config.js';
import {
  EVENT_APP_ERROR_TYPES,
  EventAppError,
  mapEventAppStatusToError,
} from './errors.js';
import {
  normalizeEventMap,
  normalizeIntentResponse,
  normalizePublicBooking,
  normalizePublicEvent,
} from './models.js';

function appendQueryValue(searchParams, key, value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => searchParams.append(key, entry));
    return;
  }
  searchParams.set(key, value);
}

function buildRequest(action, payload, signal) {
  const headers = { Accept: 'application/json' };
  const options = {
    headers,
    method: action.method,
    signal,
  };
  const url = new URL(action.url);

  if (action.encoding === 'json-body') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload);
  } else {
    Object.entries(payload).forEach(([key, value]) => {
      appendQueryValue(url.searchParams, key, value);
    });
  }

  return { options, url };
}

async function readJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Event App response is not JSON',
      { status: response.status },
    );
  }
  try {
    return await response.json();
  } catch {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Event App response contains invalid JSON',
      { status: response.status },
    );
  }
}

async function request(config, actionName, payload) {
  const action = requireEventAppAction(config, actionName);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort('timeout'), config.timeout);
  const { options, url } = buildRequest(action, payload, controller.signal);

  try {
    const response = await fetch(url, options);
    if (!response.ok) throw mapEventAppStatusToError(response.status);
    return await readJsonResponse(response);
  } catch (error) {
    if (error instanceof EventAppError) throw error;
    if (controller.signal.aborted) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.TIMEOUT,
        'Event App request timed out',
        { retryable: true },
      );
    }
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.NETWORK,
      'Event App request failed',
      { cause: error, retryable: true },
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function createEventAppClient(config = getEventAppConfig()) {
  return Object.freeze({
    config,

    async createIntent(payload) {
      const response = await request(config, 'create-intent', payload);
      return normalizeIntentResponse(response);
    },

    async enrich(externalEventIds) {
      const uniqueIds = [...new Set(externalEventIds)];
      const response = await request(config, 'enrich', {
        external_event_ids: uniqueIds,
      });
      return normalizeEventMap(response?.events, uniqueIds);
    },

    async getEvent(externalEventId) {
      const response = await request(config, 'detail', {
        external_event_id: externalEventId,
      });
      return normalizePublicEvent(response?.event, externalEventId);
    },

    async getPublicBooking(bookingRef) {
      const response = await request(config, 'ticket-get', {
        booking_ref: bookingRef,
      });
      return normalizePublicBooking(
        response?.booking,
        config.allowedQrOrigins,
      );
    },
  });
}
