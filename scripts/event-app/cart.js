import {
  EVENT_APP_ERROR_TYPES,
  EventAppError,
} from './errors.js';

export const BOOKING_INTENT_ATTRIBUTE = 'booking_intent_ref';

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
    ) {
      throw new EventAppError(
        EVENT_APP_ERROR_TYPES.INVALID_RESPONSE,
        'Commerce returned an invalid cart item',
      );
    }
    return Object.freeze({
      bookingIntentRef: readBookingIntent(item.custom_attributes),
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
  { cartId, cartItemUid, intentRef },
) {
  try {
    const { data, errors } = await fetchGraphQl(SET_BOOKING_INTENT_MUTATION, {
      variables: {
        cartId,
        cartItemId: cartItemUid,
        intentRef,
      },
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
    if (readBookingIntent(updatedItem?.custom_attributes) !== intentRef) {
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
  createIntent,
  eventId,
  form,
  pendingSubmission,
  values,
}) {
  if (!pendingSubmission.cartId) {
    const cart = await ensureActiveCart(cartApi);
    pendingSubmission.cartId = cart.id;
  }

  const sku = values.parentSku || values.sku;
  if (!sku) {
    throw new EventAppError(
      EVENT_APP_ERROR_TYPES.INTEGRITY,
      'Event SKU is unavailable',
    );
  }

  let lines = await getEventCartLines(
    cartApi.fetchGraphQl,
    pendingSubmission.cartId,
  );
  let cartLine = findEventCartLine(lines, sku);
  let { intentRef } = pendingSubmission;

  if (!intentRef) {
    if (cartLine) {
      throw new EventAppError(
        cartLine.bookingIntentRef
          ? EVENT_APP_ERROR_TYPES.DUPLICATE
          : EVENT_APP_ERROR_TYPES.INTEGRITY,
        'The event already exists in this cart',
      );
    }

    const intent = await createIntent({
      commerce_cart_id: pendingSubmission.cartId,
      commerce_sku: sku,
      consent: form.consent,
      contact: form.contact,
      event_id: eventId,
      participants: form.participants,
      quantity: form.quantity,
      source_request_id: pendingSubmission.sourceRequestId,
    });
    intentRef = intent.intentRef;
    pendingSubmission.intentRef = intentRef;
    pendingSubmission.stage = 'intent-created';
  }

  try {
    if (!pendingSubmission.cartItemUid) {
      lines = await getEventCartLines(
        cartApi.fetchGraphQl,
        pendingSubmission.cartId,
      );
      cartLine = findEventCartLine(lines, sku);

      if (cartLine?.bookingIntentRef) {
        if (cartLine.bookingIntentRef !== intentRef) {
          throw new EventAppError(
            EVENT_APP_ERROR_TYPES.DUPLICATE,
            'A different booking already exists for this event',
          );
        }
        pendingSubmission.stage = 'correlated';
        return intentRef;
      }

      if (cartLine) {
        pendingSubmission.cartItemUid = cartLine.uid;
        pendingSubmission.stage = 'cart-added';
      } else {
        const previousUids = lines.map((line) => line.uid);
        const cart = await cartApi.addProductsToCart([{
          ...values,
          quantity: form.quantity,
        }]);
        const addedItem = findNewCartItem(cart, previousUids, sku);
        pendingSubmission.cartItemUid = addedItem.uid;
        pendingSubmission.stage = 'cart-added';
      }
    }

    await setCartItemBookingIntent(cartApi.fetchGraphQl, {
      cartId: pendingSubmission.cartId,
      cartItemUid: pendingSubmission.cartItemUid,
      intentRef,
    });
    pendingSubmission.stage = 'correlated';
    await cartApi.refreshCart();
    return intentRef;
  } catch (error) {
    if (
      pendingSubmission.cartItemUid
      && error instanceof EventAppError
      && error.retryable !== true
    ) {
      try {
        await cartApi.updateProductsFromCart([{
          quantity: 0,
          uid: pendingSubmission.cartItemUid,
        }]);
        pendingSubmission.cartItemUid = null;
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
