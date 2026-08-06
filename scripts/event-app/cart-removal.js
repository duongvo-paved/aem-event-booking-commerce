import { isEventProduct } from './models.js';

function getEventProduct(item) {
  return { attributes: item?.productAttributes };
}

export function createEventCartRemovalController({
  cancelIntent,
  fetchCartLines,
  getCart,
  onCancellationError,
  onCancellationSuccess,
  removeItem,
}) {
  const retryRequests = new Map();

  async function retryCancellation(payload) {
    const key = `${payload.commerce_cart_id}:${payload.intent_ref}`;
    const existing = retryRequests.get(key);
    if (existing) return existing;

    const request = cancelIntent(payload)
      .then(() => onCancellationSuccess?.())
      .finally(() => retryRequests.delete(key));
    retryRequests.set(key, request);
    return request;
  }

  async function remove(item) {
    const cart = getCart();
    if (!isEventProduct(getEventProduct(item))) {
      return removeItem(item);
    }
    if (typeof cart?.id !== 'string' || !cart.id) {
      throw new Error('Commerce cart is unavailable');
    }

    const lines = await fetchCartLines(cart.id);
    const line = lines.find((entry) => entry.uid === item.uid);
    const payload = line?.bookingIntentRef
      ? Object.freeze({
        commerce_cart_id: cart.id,
        commerce_sku: line.sku,
        intent_ref: line.bookingIntentRef,
      })
      : null;

    const result = await removeItem(item);
    if (!payload) return result;

    try {
      await retryCancellation(payload);
    } catch (error) {
      onCancellationError?.({
        error,
        retry: () => retryCancellation(payload),
      });
    }
    return result;
  }

  return Object.freeze({ remove, retryCancellation });
}

export function createEventItemRemoveAction({
  controller,
  label = 'Remove',
}) {
  return function EventItemRemoveAction(ctx) {
    if (!isEventProduct(getEventProduct(ctx.item))) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dropin-cart-item__remove';
    button.textContent = label;
    button.setAttribute('aria-label', `${label} ${ctx.item.name || ''}`.trim());
    button.addEventListener('click', async () => {
      ctx.handleItemsLoading(ctx.item.uid, true);
      ctx.handleItemsError(ctx.item.uid);
      button.disabled = true;
      try {
        await controller.remove(ctx.item);
      } catch (error) {
        ctx.handleItemsError(ctx.item.uid, error.message);
      } finally {
        ctx.handleItemsLoading(ctx.item.uid, false);
        button.disabled = false;
      }
    });
    ctx.replaceWith(button);
  };
}

export function renderCancellationWarning(container, {
  message = 'The event was removed, but its booking could not be cancelled.',
  retry,
  retryLabel = 'Retry',
}) {
  const alert = document.createElement('div');
  alert.className = 'event-cart-cancellation-warning';
  alert.setAttribute('aria-live', 'assertive');
  alert.setAttribute('role', 'alert');

  const text = document.createElement('p');
  text.textContent = message;
  alert.append(text);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary';
  button.textContent = retryLabel;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await retry();
      alert.remove();
    } catch {
      button.disabled = false;
    }
  });
  alert.append(button);
  container.replaceChildren(alert);
  return alert;
}
