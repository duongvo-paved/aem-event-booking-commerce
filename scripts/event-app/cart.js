import {
  EVENT_APP_ERROR_TYPES,
  EventAppError,
} from './errors.js';

export const BOOKING_INTENT_ATTRIBUTE = 'booking_intent_ref';
export const EVENT_OCCURRENCE_ATTRIBUTES = Object.freeze({
  date: 'event_occurrence_date',
  endTime: 'event_occurrence_end_time',
  id: 'event_occurrence_id',
  startTime: 'event_occurrence_start_time',
  timezone: 'event_occurrence_timezone',
});

const EVENT_CART_LINES_QUERY = `
  query EventCartLines($cartId: String!) {
    cart(cart_id: $cartId) {
      id
      itemsV2(pageSize: 100, currentPage: 1) {
        items {
          uid
          quantity
          product {
            sku
          }
          custom_attributes {
            attribute_code
            value
          }
        }
      }
    }
  }
`;

const SET_BOOKING_INTENT_MUTATION = `
  mutation SetBookingIntent(
    $cartId: String!
    $cartItemId: String!
    $intentRef: String!
  ) {
    setCustomAttributesOnCartItem(
      input: {
        cart_id: $cartId
        cart_item_id: $cartItemId
        custom_attributes: [{
          attribute_code: "booking_intent_ref"
          value: $intentRef
        }]
      }
    ) {
      cart {
        id
        itemsV2(pageSize: 100, currentPage: 1) {
          items {
            uid
            custom_attributes {
              attribute_code
              value
            }
          }
        }
      }
    }
  }
`;

const SET_BOOKING_INTENT_OCCURRENCE_MUTATION = `
  mutation SetBookingIntentWithOccurrence(
    $cartId: String!
    $cartItemId: String!
    $intentRef: String!
    $occurrenceId: String!
    $occurrenceDate: String!
    $occurrenceStartTime: String!
    $occurrenceEndTime: String!
    $occurrenceTimezone: String!
  ) {
    setCustomAttributesOnCartItem(
      input: {
        cart_id: $cartId
        cart_item_id: $cartItemId
        custom_attributes: [
          {
            attribute_code: "booking_intent_ref"
            value: $intentRef
          }
          {
            attribute_code: "event_occurrence_id"
            value: $occurrenceId
          }
          {
            attribute_code: "event_occurrence_date"
            value: $occurrenceDate
          }
          {
            attribute_code: "event_occurrence_start_time"
            value: $occurrenceStartTime
          }
          {
            attribute_code: "event_occurrence_end_time"
            value: $occurrenceEndTime
          }
          {
            attribute_code: "event_occurrence_timezone"
            value: $occurrenceTimezone
          }
        ]
      }
    ) {
      cart {
        id
        itemsV2(pageSize: 100, currentPage: 1) {
          items {
            uid
            custom_attributes {
              attribute_code
              value
            }
          }
        }
      }
    }
  }
`;

function getGraphQlErrorMessage(errors) {
  if (!Array.isArray(errors)) return '';
  return errors
    .map((error) => error?.message)
    .filter(Boolean)
    .join(' ');
}

function readBookingIntent(attributes) {
  if (!Array.isArray(attributes)) return null;
  const attribute = attributes.find(
    (entry) => entry?.attribute_code === BOOKING_INTENT_ATTRIBUTE,
  );
  return typeof attribute?.value === 'string' && attribute.value.trim()
    ? attribute.value.trim()
    : null;
}

function readCartAttribute(attributes, attributeCode) {
  if (!Array.isArray(attributes)) return null;
  const attribute = attributes.find(
    (entry) => entry?.attribute_code === attributeCode,
  );
  return typeof attribute?.value === 'string' && attribute.value.trim()
    ? attribute.value.trim()
    : null;
}

function isLocalTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value;
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function readOccurrenceSnapshot(attributes) {
  const snapshot = {
    occurrenceId: readCartAttribute(attributes, EVENT_OCCURRENCE_ATTRIBUTES.id),
    localDate: readCartAttribute(attributes, EVENT_OCCURRENCE_ATTRIBUTES.date),
    startTime: readCartAttribute(attributes, EVENT_OCCURRENCE_ATTRIBUTES.startTime),
    endTime: readCartAttribute(attributes, EVENT_OCCURRENCE_ATTRIBUTES.endTime),
    timezone: readCartAttribute(attributes, EVENT_OCCURRENCE_ATTRIBUTES.timezone),
  };
  if (
    !snapshot.occurrenceId
    || !snapshot.localDate
    || !isCalendarDate(snapshot.localDate)
    || !snapshot.startTime
    || !isLocalTime(snapshot.startTime)
    || !snapshot.endTime
    || !isLocalTime(snapshot.endTime)
    || timeToMinutes(snapshot.endTime) <= timeToMinutes(snapshot.startTime)
    || !snapshot.timezone
  ) return null;
  return Object.freeze(snapshot);
}

function normalizeOccurrenceSnapshot(occurrence, expectedOccurrenceId) {
  if (!occurrence || typeof occurrence !== 'object') return null;
  const snapshot = {
    occurrenceId: typeof occurrence.occurrenceId === 'string'
      ? occurrence.occurrenceId.trim()
      : '',
    localDate: typeof occurrence.localDate === 'string'
      ? occurrence.localDate.trim()
      : '',
    startTime: typeof occurrence.startTime === 'string'
      ? occurrence.startTime.trim()
      : '',
    endTime: typeof occurrence.endTime === 'string'
      ? occurrence.endTime.trim()
      : '',
    timezone: typeof occurrence.timezone === 'string'
      ? occurrence.timezone.trim()
      : '',
  };
  if (expectedOccurrenceId !== undefined
    && snapshot.occurrenceId !== expectedOccurrenceId.trim()) return null;
  const attributes = Object.entries({
    [EVENT_OCCURRENCE_ATTRIBUTES.id]: snapshot.occurrenceId,
    [EVENT_OCCURRENCE_ATTRIBUTES.date]: snapshot.localDate,
    [EVENT_OCCURRENCE_ATTRIBUTES.startTime]: snapshot.startTime,
    [EVENT_OCCURRENCE_ATTRIBUTES.endTime]: snapshot.endTime,
    [EVENT_OCCURRENCE_ATTRIBUTES.timezone]: snapshot.timezone,
  }).map(([attributeCode, value]) => ({
    attribute_code: attributeCode,
    value,
  }));
  return readOccurrenceSnapshot(attributes);
}

function sameOccurrenceSnapshot(left, right) {
  return Boolean(left && right)
    && Object.keys(left).every((key) => left[key] === right[key]);
}

function normalizeCartLines(data) {
  const items = data?.cart?.itemsV2?.items;
  if (!Array.isArray(items)) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Commerce returned an invalid cart response',
    );
  }

  return items.map((item) => {
    if (
      typeof item?.uid !== 'string'
      || typeof item?.product?.sku !== 'string'
      || !Number.isInteger(item.quantity)
      || item.quantity < 1
    ) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'Commerce returned an invalid cart item',
      );
    }
    return Object.freeze({
      bookingIntentRef: readBookingIntent(item.custom_attributes),
      occurrence: readOccurrenceSnapshot(item.custom_attributes),
      quantity: item.quantity,
      sku: item.product.sku,
      uid: item.uid,
    });
  });
}

export async function ensureActiveCart(cartApi) {
  const initializedCart = await cartApi.initializeCart();
  if (initializedCart?.id) return initializedCart;

  const cartId = await cartApi.createGuestCart();
  if (typeof cartId !== 'string' || !cartId) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
      'Commerce did not return a cart ID',
    );
  }
  return Object.freeze({ id: cartId, items: [] });
}

export async function getEventCartLines(fetchGraphQl, cartId) {
  try {
    const { data, errors } = await fetchGraphQl(EVENT_CART_LINES_QUERY, {
      variables: { cartId },
    });
    const errorMessage = getGraphQlErrorMessage(errors);
    if (errorMessage) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.CONFIGURATION,
        errorMessage,
      );
    }
    return normalizeCartLines(data);
  } catch (error) {
    if (error instanceof EventAppError) throw error;
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.NETWORK,
      'Unable to read the Commerce cart',
      { cause: error, retryable: true },
    );
  }
}

export function findEventCartLine(lines, sku) {
  const matches = lines.filter((line) => line.sku === sku);
  if (matches.length > 1) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Multiple cart lines exist for the same event',
    );
  }
  return matches[0] || null;
}

export function findNewCartItem(cart, previousUids, sku) {
  const previous = new Set(previousUids);
  const matches = (cart?.items || []).filter(
    (item) => !previous.has(item.uid)
      && (item.sku === sku || item.topLevelSku === sku),
  );
  if (matches.length !== 1) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Unable to identify the new event cart line',
    );
  }
  return matches[0];
}

export async function setCartItemBookingIntent(
  fetchGraphQl,
  {
    cartId,
    cartItemUid,
    intentRef,
    occurrence,
  },
) {
  const occurrenceSnapshot = occurrence === undefined || occurrence === null
    ? null
    : normalizeOccurrenceSnapshot(occurrence);
  if (occurrence !== undefined && occurrence !== null && !occurrenceSnapshot) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Event occurrence is unavailable',
    );
  }
  try {
    const mutation = occurrenceSnapshot
      ? SET_BOOKING_INTENT_OCCURRENCE_MUTATION
      : SET_BOOKING_INTENT_MUTATION;
    const variables = occurrenceSnapshot
      ? {
        cartId,
        cartItemId: cartItemUid,
        intentRef,
        occurrenceId: occurrenceSnapshot.occurrenceId,
        occurrenceDate: occurrenceSnapshot.localDate,
        occurrenceStartTime: occurrenceSnapshot.startTime,
        occurrenceEndTime: occurrenceSnapshot.endTime,
        occurrenceTimezone: occurrenceSnapshot.timezone,
      }
      : { cartId, cartItemId: cartItemUid, intentRef };
    const { data, errors } = await fetchGraphQl(mutation, {
      variables,
    });
    const errorMessage = getGraphQlErrorMessage(errors);
    if (errorMessage) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.CONFIGURATION,
        errorMessage,
      );
    }

    const items = data?.setCustomAttributesOnCartItem?.cart?.itemsV2?.items;
    const updatedItem = Array.isArray(items)
      ? items.find((item) => item?.uid === cartItemUid)
      : null;
    if (
      readBookingIntent(updatedItem?.custom_attributes) !== intentRef
      || (occurrenceSnapshot
        && !sameOccurrenceSnapshot(
          readOccurrenceSnapshot(updatedItem?.custom_attributes),
          occurrenceSnapshot,
        ))
    ) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'Commerce did not preserve the booking reference',
      );
    }
  } catch (error) {
    if (error instanceof EventAppError) throw error;
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.NETWORK,
      'Unable to correlate the Commerce cart item',
      { cause: error, retryable: true },
    );
  }
}

export async function addCorrelatedEventProduct({
  cartApi,
  commerceSku,
  createIntent,
  eventAllocationId,
  eventId,
  form,
  occurrence,
  occurrenceId,
  pendingSubmission,
  values,
}) {
  if (!pendingSubmission.cartId) {
    const cart = await ensureActiveCart(cartApi);
    pendingSubmission.cartId = cart.id;
  }

  const sku = typeof commerceSku === 'string' ? commerceSku.trim() : '';
  if (!sku || typeof eventAllocationId !== 'string' || !eventAllocationId.trim()) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Event allocation is unavailable',
    );
  }
  if (
    occurrenceId !== undefined
    && (typeof occurrenceId !== 'string' || !occurrenceId.trim())
  ) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Event occurrence is unavailable',
    );
  }
  const occurrenceSnapshot = occurrence === undefined || occurrence === null
    ? null
    : normalizeOccurrenceSnapshot(occurrence, occurrenceId);
  if (occurrence !== undefined && occurrence !== null && !occurrenceSnapshot) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Event occurrence is unavailable',
    );
  }
  if (occurrenceId && !occurrenceSnapshot) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Event occurrence details are unavailable',
    );
  }
  const selectedOccurrenceId = occurrenceSnapshot?.occurrenceId;

  const { parentSku: _parentSku, ...productValues } = values || {};
  const canonicalValues = { ...productValues, sku };

  let lines = await getEventCartLines(
    cartApi.fetchGraphQl,
    pendingSubmission.cartId,
  );
  let cartLine = findEventCartLine(lines, sku);
  let { intentRef } = pendingSubmission;
  const retryingCartLine = Boolean(pendingSubmission.cartItemUid);

  if (!intentRef) {
    if (cartLine && !cartLine.bookingIntentRef) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INTEGRITY,
        'The event cart line is not correlated',
      );
    }
    if (selectedOccurrenceId && cartLine) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INTEGRITY,
        'The recurring occurrence cannot be matched to the existing cart line',
      );
    }

    const intent = await createIntent({
      commerce_cart_id: pendingSubmission.cartId,
      commerce_sku: sku,
      consent: form.consent,
      contact: form.contact,
      event_allocation_id: eventAllocationId.trim(),
      event_id: eventId,
      attendees: form.attendees,
      quantity: form.quantity,
      source_request_id: pendingSubmission.sourceRequestId,
      ...(selectedOccurrenceId ? { occurrence_id: selectedOccurrenceId } : {}),
    });
    intentRef = intent.intentRef;
    pendingSubmission.intentRef = intentRef;
    pendingSubmission.stage = 'intent-created';
    pendingSubmission.cartItemWasAdded = !cartLine;
    pendingSubmission.cartItemUid = cartLine?.uid || null;
    pendingSubmission.targetCartQuantity = cartLine
      ? cartLine.quantity + form.quantity
      : form.quantity;
  }

  try {
    if (!pendingSubmission.cartItemUid) {
      lines = await getEventCartLines(
        cartApi.fetchGraphQl,
        pendingSubmission.cartId,
      );
      cartLine = findEventCartLine(lines, sku);

      if (cartLine) {
        if (cartLine.bookingIntentRef && cartLine.bookingIntentRef !== intentRef) {
          throw new EventAppError(
            EVENT_APP_ERROR_TYPES.DUPLICATE,
            'A different booking already exists for this event allocation',
          );
        }
        pendingSubmission.cartItemUid = cartLine.uid;
        pendingSubmission.targetCartQuantity = pendingSubmission.targetCartQuantity
          || cartLine.quantity;
        pendingSubmission.stage = 'cart-added';
      } else {
        const previousUids = lines.map((line) => line.uid);
        const cart = await cartApi.addProductsToCart([{
          ...canonicalValues,
          quantity: pendingSubmission.targetCartQuantity || form.quantity,
        }]);
        const addedItem = findNewCartItem(cart, previousUids, sku);
        pendingSubmission.cartItemUid = addedItem.uid;
        pendingSubmission.cartItemWasAdded = true;
        pendingSubmission.stage = 'cart-added';
        cartLine = {
          bookingIntentRef: null,
          occurrence: occurrenceSnapshot,
          quantity: pendingSubmission.targetCartQuantity || form.quantity,
          sku,
          uid: addedItem.uid,
        };
      }
    }

    if (retryingCartLine) {
      lines = await getEventCartLines(
        cartApi.fetchGraphQl,
        pendingSubmission.cartId,
      );
      cartLine = findEventCartLine(lines, sku);
    }
    if (!cartLine || cartLine.uid !== pendingSubmission.cartItemUid) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INTEGRITY,
        'The event cart line is unavailable',
      );
    }

    const targetQuantity = pendingSubmission.targetCartQuantity || form.quantity;
    if (cartLine.quantity < targetQuantity) {
      await cartApi.updateProductsFromCart([{
        quantity: targetQuantity,
        uid: pendingSubmission.cartItemUid,
      }]);
    }

    if (
      cartLine.bookingIntentRef
      && cartLine.bookingIntentRef !== intentRef
    ) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.DUPLICATE,
        'A different booking already exists for this event allocation',
      );
    }

    if (
      occurrenceSnapshot
      && cartLine.occurrence
      && !sameOccurrenceSnapshot(cartLine.occurrence, occurrenceSnapshot)
    ) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INTEGRITY,
        'The Commerce cart line belongs to a different occurrence',
      );
    }

    if (
      cartLine.bookingIntentRef !== intentRef
      || (occurrenceSnapshot
        && cartLine.occurrence
        && !sameOccurrenceSnapshot(cartLine.occurrence, occurrenceSnapshot))
      || (occurrenceSnapshot && !cartLine.occurrence)
    ) {
      await setCartItemBookingIntent(cartApi.fetchGraphQl, {
        cartId: pendingSubmission.cartId,
        cartItemUid: pendingSubmission.cartItemUid,
        intentRef,
        occurrence: occurrenceSnapshot,
      });
    }
    pendingSubmission.stage = 'correlated';
    await cartApi.refreshCart();
    return intentRef;
  } catch (error) {
    if (
      pendingSubmission.cartItemUid
      && pendingSubmission.cartItemWasAdded
      && error instanceof EventAppError
      && error.retryable !== true
    ) {
      try {
        await cartApi.updateProductsFromCart([{
          quantity: 0,
          uid: pendingSubmission.cartItemUid,
        }]);
        pendingSubmission.cartItemUid = null;
        pendingSubmission.cartItemWasAdded = false;
        pendingSubmission.targetCartQuantity = null;
        pendingSubmission.stage = 'intent-created';
      } catch {
        // Keep the exact UID so a retry repairs instead of adding again.
      }
    }
    if (error instanceof EventAppError) throw error;
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.UNAVAILABLE,
      'Unable to add the event product to the cart',
      { cause: error, retryable: true },
    );
  }
}
