import { render as provider } from '@dropins/storefront-cart/render.js';
import MiniCart from '@dropins/storefront-cart/containers/MiniCart.js';
import * as Cart from '@dropins/storefront-cart/api.js';
import { events } from '@dropins/tools/event-bus.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
import {
  InLineAlert,
  Icon,
  provider as UI,
  Button,
} from '@dropins/tools/components.js';
import { h } from '@dropins/tools/preact.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { WishlistAlert } from '@dropins/storefront-wishlist/containers/WishlistAlert.js';

import createModal from '../modal/modal.js';
import createMiniPDP from '../../scripts/components/commerce-mini-pdp/commerce-mini-pdp.js';

// Initializers
import '../../scripts/initializers/cart.js';
import '../../scripts/initializers/wishlist.js';

import { readBlockConfig } from '../../scripts/aem.js';
import {
  fetchPlaceholders, rootLink, getProductLink, CS_FETCH_GRAPHQL,
} from '../../scripts/commerce.js';
import { isEventProduct } from '../../scripts/event-app/models.js';
import { createCartProductLinkResolver } from '../../scripts/event-app/cart-product-links.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { getEventCartLines } from '../../scripts/event-app/cart.js';
import {
  createEventCartRemovalController,
  createEventItemRemoveAction,
  renderCancellationWarning,
} from '../../scripts/event-app/cart-removal.js';
import {
  createCartBookingPresenter,
  getCartBookingLabels,
} from '../../scripts/event-app/cart-display.js';

export default async function decorate(block) {
  const {
    'start-shopping-url': startShoppingURL = '',
    'cart-url': cartURL = '',
    'checkout-url': checkoutURL = '',
    'enable-updating-product': enableUpdatingProduct = 'false',
    'undo-remove-item': undo = 'false',
  } = readBlockConfig(block);

  // Get translations for custom messages
  const placeholders = await fetchPlaceholders();
  const eventClient = createEventAppClient();
  const bookingPresenter = createCartBookingPresenter({
    enrichEvents: (eventIds) => eventClient.enrich(eventIds),
    eventBus: events,
    fetchCartLines: (cartId) => getEventCartLines(Cart.fetchGraphQl, cartId),
    labels: getCartBookingLabels(placeholders),
    surface: 'mini-cart',
  });

  const MESSAGES = {
    ADDED: placeholders?.Global?.MiniCartAddedMessage,
    UPDATED: placeholders?.Global?.MiniCartUpdatedMessage,
  };

  // Modal state
  let currentModal = null;
  let currentCartNotification = null;

  // Create a container for the update message
  const updateMessage = document.createElement('div');
  updateMessage.className = 'commerce-mini-cart__update-message';

  // Create shadow wrapper
  const shadowWrapper = document.createElement('div');
  shadowWrapper.className = 'commerce-mini-cart__message-wrapper';
  shadowWrapper.appendChild(updateMessage);

  const cancellationWarning = document.createElement('div');
  cancellationWarning.className = 'commerce-mini-cart__cancellation-warning';
  let cancellationAlert = null;
  const wishlistNotification = document.createElement('div');
  wishlistNotification.className = 'commerce-mini-cart__wishlist-notification';
  let wishlistNotificationTimeout;
  const itemError = document.createElement('div');
  itemError.className = 'commerce-mini-cart__item-error event-cart-cancellation-warning';
  itemError.setAttribute('role', 'alert');
  itemError.hidden = true;
  events.on('wishlist/alert', ({ action, item }) => {
    wishlistRender.render(WishlistAlert, {
      action,
      item,
      routeToWishlist: rootLink('/wishlist'),
    })(wishlistNotification);
    clearTimeout(wishlistNotificationTimeout);
    wishlistNotificationTimeout = setTimeout(() => wishlistNotification.replaceChildren(), 5000);
  });

  const removalController = createEventCartRemovalController({
    cancelIntent: (payload) => eventClient.cancelIntent(payload),
    fetchCartLines: (cartId) => getEventCartLines(Cart.fetchGraphQl, cartId),
    getCart: () => Cart.getCartDataFromCache(),
    onCancellationError: ({ retry }) => {
      cancellationAlert = renderCancellationWarning(cancellationWarning, {
        message: placeholders?.Global?.CartEventCancellationWarning,
        retry,
        retryLabel: placeholders?.Global?.Retry || 'Retry',
      });
    },
    onCancellationSuccess: () => {
      cancellationAlert?.remove();
      cancellationAlert = null;
    },
    removeItem: (item) => Cart.updateProductsFromCart([{
      quantity: 0,
      uid: item.uid,
    }]),
  });
  const eventItemRemoveAction = createEventItemRemoveAction({
    controller: removalController,
    label: placeholders?.Global?.CartRemoveItem || 'Remove',
    variant: 'text',
    eventOnly: false,
  });

  const showMessage = (message) => {
    updateMessage.textContent = message;
    updateMessage.classList.add('commerce-mini-cart__update-message--visible');
    shadowWrapper.classList.add('commerce-mini-cart__message-wrapper--visible');
    setTimeout(() => {
      updateMessage.classList.remove(
        'commerce-mini-cart__update-message--visible',
      );
      shadowWrapper.classList.remove(
        'commerce-mini-cart__message-wrapper--visible',
      );
    }, 3000);
  };

  // Handle Edit Button Click
  async function handleEditButtonClick(cartItem) {
    try {
      // Create mini PDP content
      const miniPDPContent = await createMiniPDP(
        cartItem,
        async (_updateData) => {
          const productName = cartItem.name
            || cartItem.product?.name
            || placeholders?.Global?.CartUpdatedProductName;
          const message = placeholders?.Global?.CartUpdatedProductMessage?.replace(
            '{product}',
            productName,
          );

          // Show message in the main cart page
          const cartNotification = document.querySelector(
            '.cart__notification',
          );
          if (cartNotification) {
            // Clear any existing cart notifications
            currentCartNotification?.remove();

            currentCartNotification = await UI.render(InLineAlert, {
              heading: message,
              type: 'success',
              variant: 'primary',
              icon: h(Icon, { source: 'CheckWithCircle' }),
              'aria-live': 'assertive',
              role: 'alert',
              onDismiss: () => {
                currentCartNotification?.remove();
              },
            })(cartNotification);

            // Auto-dismiss after 5 seconds
            setTimeout(() => {
              currentCartNotification?.remove();
            }, 5000);
          }

          // Also trigger message in the mini-cart
          showMessage(message);
        },
        () => {
          if (currentModal) {
            currentModal.removeModal();
            currentModal = null;
          }
        },
      );

      currentModal = await createModal([miniPDPContent]);

      if (currentModal.block) {
        currentModal.block.setAttribute('id', 'mini-pdp-modal');
      }

      currentModal.showModal();
    } catch (error) {
      console.error('Error opening mini PDP modal:', error);

      // Show error message using mini-cart's message system
      showMessage(
        placeholders?.Global?.ProductLoadError,
      );
    }
  }

  // Add event listeners for cart updates
  events.on('cart/product/added', () => showMessage(MESSAGES.ADDED), {
    eager: true,
  });
  events.on('cart/product/updated', () => showMessage(MESSAGES.UPDATED), {
    eager: true,
  });

  // Prevent mini cart from closing when undo is enabled
  if (undo === 'true') {
    // Add event listener to prevent event bubbling from remove buttons
    block.addEventListener('click', (e) => {
      // Check if click is on a remove button or within an undo-related element
      const isRemoveButton = e.target.closest('[class*="remove"]')
        || e.target.closest('[data-testid*="remove"]')
        || e.target.closest('[class*="undo"]')
        || e.target.closest('[data-testid*="undo"]');

      if (isRemoveButton) {
        // Stop the event from bubbling up to document level
        e.stopPropagation();
      }
    });
  }

  block.innerHTML = '';
  const miniCartRoot = document.createElement('div');
  miniCartRoot.className = 'commerce-mini-cart__content';
  block.append(cancellationWarning, itemError, wishlistNotification, miniCartRoot);

  // Render MiniCart
  const productLinks = createCartProductLinkResolver({ catalog: CS_FETCH_GRAPHQL, getProductLink });
  const createProductLink = productLinks.routeProduct;
  await provider.render(MiniCart, {
    routeEmptyCartCTA: startShoppingURL ? () => rootLink(startShoppingURL) : undefined,
    routeCart: cartURL ? () => rootLink(cartURL) : undefined,
    routeCheckout: checkoutURL ? () => rootLink(checkoutURL) : undefined,
    routeProduct: createProductLink,
    enableQuantityUpdate: false,
    undo: undo === 'true',

    slots: {
      ItemRemoveAction: (ctx) => {
        const placeholder = document.createElement('span');
        placeholder.hidden = true;
        ctx.replaceWith(placeholder);
      },
      ProductAttributes: bookingPresenter.ProductAttributes,
      ItemTitle: (ctx) => {
        if (!isEventProduct({ attributes: ctx.item.productAttributes })) return;
        const heading = document.createElement('h3');
        heading.className = 'event-mini-cart-item__title';
        const link = document.createElement('a');
        link.textContent = ctx.item.name;
        productLinks.bind(link, ctx.item);
        heading.append(link);
        ctx.replaceWith(heading);
      },
      Thumbnail: (ctx) => {
        const { item, defaultImageProps } = ctx;
        const anchorWrapper = document.createElement('a');
        productLinks.bind(anchorWrapper, item);

        tryRenderAemAssetsImage(ctx, {
          alias: item.sku,
          imageProps: defaultImageProps,
          wrapper: anchorWrapper,

          params: {
            width: defaultImageProps.width,
            height: defaultImageProps.height,
          },
        });
      },
      Footer: (ctx) => {
        const actions = document.createElement('div');
        actions.className = 'cart__item-actions';
        if (ctx.item?.itemType === 'ConfigurableCartItem' && enableUpdatingProduct === 'true') {
          const editLink = document.createElement('div');
          editLink.className = 'cart-item-edit-link';

          UI.render(Button, {
            children: placeholders?.Global?.CartEditButton,
            variant: 'tertiary',
            size: 'medium',
            icon: h(Icon, { source: 'Edit' }),
            onClick: () => handleEditButtonClick(ctx.item),
          })(editLink);

          actions.append(editLink);
        }
        const wishlist = document.createElement('div');
        wishlist.className = 'cart__action--wishlist-toggle';
        wishlistRender.render(WishlistToggle, {
          product: ctx.item,
          size: 'medium',
          labelToWishlist: placeholders?.Global?.CartSaveForLater || 'Save for later',
          labelWishlisted: placeholders?.Global?.CartRemoveFromWishlist || 'Remove from saved events',
          removeProdFromCart: Cart.updateProductsFromCart,
        })(wishlist);
        actions.append(wishlist);
        eventItemRemoveAction({
          ...ctx,
          handleItemsError: (_uid, message) => {
            itemError.textContent = message || '';
            itemError.hidden = !message;
          },
          replaceWith: (button) => actions.append(button),
        });
        ctx.appendChild(actions);
      },
    },
  })(miniCartRoot);

  // Find the products container and add the message div at the top
  const productsContainer = miniCartRoot.querySelector('.cart-mini-cart__products');
  if (productsContainer) {
    productsContainer.insertBefore(shadowWrapper, productsContainer.firstChild);
  } else {
    console.info('Products container not found, appending message to block');
    block.appendChild(shadowWrapper);
  }

  return block;
}
