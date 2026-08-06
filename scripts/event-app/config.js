import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

import {
  EVENT_APP_ERROR_TYPES,
  EventAppError,
} from './errors.js';

const ACTION_NAMES = Object.freeze([
  'enrich',
  'detail',
  'create-intent',
  'cancel-intent',
  'ticket-get',
]);
const ALLOWED_ENCODINGS = new Set(['json-body', 'query']);
const ALLOWED_METHODS = new Set(['GET', 'POST']);
const DEFAULT_TIMEOUT = 8000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.CONFIGURATION,
      `${label} is not configured`,
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.CONFIGURATION,
      `${label} must be a valid URL`,
    );
  }

  if (url.protocol !== 'https:') {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.CONFIGURATION,
      `${label} must use HTTPS`,
    );
  }

  return url.toString();
}

function normalizeAction(action, name) {
  if (!isPlainObject(action)) {
    return null;
  }

  const method = String(action.method || '').toUpperCase();
  const { encoding } = action;
  if (!ALLOWED_METHODS.has(method) || !ALLOWED_ENCODINGS.has(encoding)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.CONFIGURATION,
      `Event App action ${name} has an invalid method or encoding`,
    );
  }

  if (method === 'GET' && encoding !== 'query') {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.CONFIGURATION,
      `Event App action ${name} GET requests must use query encoding`,
    );
  }

  return Object.freeze({
    encoding,
    method,
    url: readUrl(action.url, `Event App action ${name}`),
  });
}

function normalizeOrigins(origins) {
  if (!Array.isArray(origins)) {
    return Object.freeze([]);
  }

  return Object.freeze(origins.map((origin) => {
    const url = readUrl(origin, 'Event App allowed origin');
    return new URL(url).origin;
  }));
}

export function getEventAppConfig(rawConfig = getConfigValue('event-app')) {
  if (!isPlainObject(rawConfig) || rawConfig.enabled !== true) {
    return Object.freeze({
      actions: Object.freeze({}),
      allowedQrOrigins: Object.freeze([]),
      enabled: false,
      timeout: DEFAULT_TIMEOUT,
    });
  }

  const actions = {};
  ACTION_NAMES.forEach((name) => {
    const action = normalizeAction(rawConfig.actions?.[name], name);
    if (action) actions[name] = action;
  });

  const configuredTimeout = Number(rawConfig['timeout-ms']);
  const timeout = Number.isInteger(configuredTimeout)
    && configuredTimeout >= 1000
    && configuredTimeout <= 30000
    ? configuredTimeout
    : DEFAULT_TIMEOUT;

  return Object.freeze({
    actions: Object.freeze(actions),
    allowedQrOrigins: normalizeOrigins(rawConfig['allowed-qr-origins']),
    enabled: true,
    timeout,
  });
}

export function requireEventAppAction(config, actionName) {
  if (!config?.enabled || !config.actions?.[actionName]) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.CONFIGURATION,
      `Event App action ${actionName} is unavailable`,
    );
  }
  return config.actions[actionName];
}
