import { events } from '@dropins/tools/event-bus.js';
import { render as provider } from '@dropins/storefront-cart/render.js';
import * as Cart from '@dropins/storefront-cart/api.js';
import { h } from '@dropins/tools/preact.js';
import {
  InLineAlert,
  Icon,
  Button,
  provider as UI,
} from '@dropins/tools/components.js';

// Dropin Containers
import CartSummaryList from '@dropins/storefront-cart/containers/CartSummaryList.js';
import OrderSummary from '@dropins/storefront-cart/containers/OrderSummary.js';
import EstimateShipping from '@dropins/storefront-cart/containers/EstimateShipping.js';
import Coupons from '@dropins/storefront-cart/containers/Coupons.js';
import GiftCards from '@dropins/storefront-cart/containers/GiftCards.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { WishlistAlert } from '@dropins/storefront-wishlist/containers/WishlistAlert.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';

// API
import { publishShoppingCartViewEvent } from '@dropins/storefront-cart/api.js';

// Modal and Mini PDP
import createMiniPDP from '../../scripts/components/commerce-mini-pdp/commerce-mini-pdp.js';
import createModal from '../modal/modal.js';

// Initializers
import '../../scripts/initializers/cart.js';
import '../../scripts/initializers/wishlist.js';

import { readBlockConfig } from '../../scripts/aem.js';
import {
  fetchPlaceholders,
  rootLink,
  getProductLink,
  CS_FETCH_GRAPHQL,
} from '../../scripts/commerce.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { getEventCartLines } from '../../scripts/event-app/cart.js';
import { isEventProduct } from '../../scripts/event-app/models.js';
import { createCartProductLinkResolver } from '../../scripts/event-app/cart-product-links.js';
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
  // Configuration
  const {
    'hide-heading': hideHeading = 'false',
    'max-items': maxItems,
    'hide-attributes': hideAttributes = '',
    'enable-item-remove': enableRemoveItem = 'true',
    'enable-estimate-shipping': enableEstimateShipping = 'false',
    'start-shopping-url': startShoppingURL = '',
    'checkout-url': checkoutURL = '',
    'enable-updating-product': enableUpdatingProduct = 'false',
    'undo-remove-item': undo = 'false',
  } = readBlockConfig(block);

  const placeholders = await fetchPlaceholders();
  const eventClient = createEventAppClient();
  const bookingPresenter = createCartBookingPresenter({
    enrichEvents: (eventIds) => eventClient.enrich(eventIds),
    eventBus: events,
    fetchCartLines: (cartId) => getEventCartLines(Cart.fetchGraphQl, cartId),
    labels: getCartBookingLabels(placeholders),
    surface: 'cart',
  });

  const _cart = Cart.getCartDataFromCache();

  // Modal state
  let currentModal = null;
  let currentNotification = null;

  // Layout
  const fragment = document.createRange().createContextualFragment(`
    <div class="cart__notification"></div>
    <div class="cart__wrapper">
      <div class="cart__left-column">
        <div class="cart__list"></div>
      </div>
      <div class="cart__right-column">
        <div class="cart__order-summary"></div>
      </div>
    </div>

    <div class="cart__empty-cart"></div>
  `);

  const $wrapper = fragment.querySelector('.cart__wrapper');
  const $notification = fragment.querySelector('.cart__notification');
  const $list = fragment.querySelector('.cart__list');
  const $summary = fragment.querySelector('.cart__order-summary');
  const $emptyCart = fragment.querySelector('.cart__empty-cart');
  const $rightColumn = fragment.querySelector('.cart__right-column');
  const $crossSells = document.createElement('div');
  $crossSells.className = 'cart__cross-sells';
  $list.parentElement.appendChild($crossSells);
  let cancellationAlert = null;

  const removalController = createEventCartRemovalController({
    cancelIntent: (payload) => eventClient.cancelIntent(payload),
    fetchCartLines: (cartId) => getEventCartLines(Cart.fetchGraphQl, cartId),
    getCart: () => Cart.getCartDataFromCache(),
    onCancellationError: ({ retry }) => {
      cancellationAlert = renderCancellationWarning($notification, {
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

  block.innerHTML = '';
  const cartTitle = placeholders?.Global?.CartPageHeading || 'Your cart';
  const breadcrumbs = document.createElement('nav');
  breadcrumbs.className = 'cart__breadcrumbs';
  breadcrumbs.setAttribute('aria-label', placeholders?.Global?.BreadcrumbNavigationLabel || 'Breadcrumb');
  const trail = document.createElement('ol');
  [
    [placeholders?.Global?.BreadcrumbHomeLabel || 'Home', rootLink('/')],
    [cartTitle, null],
  ].forEach(([label, href]) => {
    const item = document.createElement('li');
    if (trail.children.length) {
      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '/';
      item.append(separator);
    }
    const element = document.createElement(href ? 'a' : 'span');
    element.textContent = label;
    if (href) element.href = href;
    else element.setAttribute('aria-current', 'page');
    item.append(element);
    trail.append(item);
  });
  breadcrumbs.append(trail);
  block.append(breadcrumbs);
  if (hideHeading !== 'true') {
    const heading = document.createElement('h1');
    heading.className = 'cart__heading';
    heading.textContent = cartTitle;
    block.append(heading);
  }
  block.appendChild(fragment);

  const emptyHeading = document.createElement('h1');
  emptyHeading.className = 'cart__empty-heading';
  emptyHeading.textContent = placeholders?.Global?.CartEmptyHeading || 'Your cart is empty';
  const emptyMessage = document.createElement('p');
  emptyMessage.className = 'cart__empty-message';
  emptyMessage.textContent = placeholders?.Global?.CartEmptyMessage
    || 'Nothing here yet. Find something to do and your tickets will show up in this cart.';
  const browseEvents = document.createElement('a');
  browseEvents.className = 'cart__browse-events';
  browseEvents.href = rootLink(startShoppingURL || '/events');
  browseEvents.textContent = placeholders?.Global?.CartBrowseEvents || 'Browse events';
  $emptyCart.append(emptyHeading, emptyMessage, browseEvents);

  // Wishlist variables
  const routeToWishlist = rootLink('/wishlist');

  // Toggle Empty Cart
  function toggleEmptyCart(isEmpty) {
    $wrapper.hidden = isEmpty;
    $emptyCart.hidden = !isEmpty;
    const heading = block.querySelector('.cart__heading');
    if (heading) heading.hidden = isEmpty;
  }
  toggleEmptyCart(isCartEmpty(_cart));

  // Handle Edit Button Click
  async function handleEditButtonClick(cartItem) {
    try {
      // Create mini PDP content
      const miniPDPContent = await createMiniPDP(
        cartItem,
        async (_updateData) => {
          // Show success message when mini-PDP updates item
          const productName = cartItem.name
            || cartItem.product?.name
            || placeholders?.Global?.CartUpdatedProductName;
          const message = placeholders?.Global?.CartUpdatedProductMessage?.replace(
            '{product}',
            productName,
          );

          // Clear any existing notifications
          currentNotification?.remove();

          currentNotification = await UI.render(InLineAlert, {
            heading: message,
            type: 'success',
            variant: 'primary',
            icon: h(Icon, { source: 'CheckWithCircle' }),
            'aria-live': 'assertive',
            role: 'alert',
            onDismiss: () => {
              currentNotification?.remove();
            },
          })($notification);

          // Auto-dismiss after 5 seconds
          setTimeout(() => {
            currentNotification?.remove();
          }, 5000);
        },
        () => {
          if (currentModal) {
            currentModal.removeModal();
            currentModal = null;
          }
        },
      );

      // Create and show modal
      currentModal = await createModal([miniPDPContent]);

      if (currentModal.block) {
        currentModal.block.setAttribute('id', 'mini-pdp-modal');
      }

      currentModal.showModal();
    } catch (error) {
      console.error('Error opening mini PDP modal:', error);

      // Clear any existing notifications
      currentNotification?.remove();

      // Show error notification
      currentNotification = await UI.render(InLineAlert, {
        heading: placeholders?.Global?.ProductLoadError,
        type: 'error',
        variant: 'primary',
        icon: h(Icon, { source: 'AlertWithCircle' }),
        'aria-live': 'assertive',
        role: 'alert',
        onDismiss: () => {
          currentNotification?.remove();
        },
      })($notification);
    }
  }

  // Render Containers
  const productLinks = createCartProductLinkResolver({ catalog: CS_FETCH_GRAPHQL, getProductLink });
  const createProductLink = productLinks.routeProduct;
  await Promise.all([
    // Cart List
    provider.render(CartSummaryList, {
      hideHeading: true,
      routeProduct: createProductLink,
      routeEmptyCartCTA: startShoppingURL ? () => rootLink(startShoppingURL) : undefined,
      maxItems: parseInt(maxItems, 10) || undefined,
      attributesToHide: hideAttributes
        .split(',')
        .map((attr) => attr.trim().toLowerCase()),
      enableUpdateItemQuantity: false,
      enableRemoveItem: enableRemoveItem === 'true',
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
          const heading = document.createElement('h2');
          heading.className = 'event-cart-item__title';
          const link = document.createElement('a');
          productLinks.bind(link, ctx.item);
          link.textContent = ctx.item.name;
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

          // Edit Link
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

          // Wishlist Button (if product is not configurable)
          const $wishlistToggle = document.createElement('div');
          $wishlistToggle.classList.add('cart__action--wishlist-toggle');

          wishlistRender.render(WishlistToggle, {
            product: ctx.item,
            size: 'medium',
            labelToWishlist: placeholders?.Global?.CartSaveForLater || 'Save for later',
            labelWishlisted: placeholders?.Global?.CartRemoveFromWishlist || 'Remove from saved events',
            removeProdFromCart: Cart.updateProductsFromCart,
          })($wishlistToggle);

          actions.append($wishlistToggle);
          if (enableRemoveItem === 'true') {
            eventItemRemoveAction({
              ...ctx,
              replaceWith: (button) => actions.append(button),
            });
          }
          ctx.appendChild(actions);
        },
      },
    })($list),

    // Order Summary
    provider.render(OrderSummary, {
      routeProduct: createProductLink,
      routeCheckout: checkoutURL ? () => rootLink(checkoutURL) : undefined,
      slots: {
        EstimateShipping: async (ctx) => {
          if (enableEstimateShipping === 'true') {
            const wrapper = document.createElement('div');
            await provider.render(EstimateShipping, {})(wrapper);
            ctx.replaceWith(wrapper);
          }
        },
        Coupons: (ctx) => {
          const coupons = document.createElement('div');

          provider.render(Coupons)(coupons);

          ctx.appendChild(coupons);
        },
        GiftCards: (ctx) => {
          const giftCards = document.createElement('div');

          provider.render(GiftCards)(giftCards);

          ctx.appendChild(giftCards);
        },
      },
    })($summary),

  ]);

  const CROSS_SELL_QUERY = `
    query CrossSellProducts($skus: [String!]!) {
      products(skus: $skus) {
        __typename
        sku
        name
        url
        addToCartAllowed
        images(roles: []) { url label }
        links {
          product { sku }
          linkTypes
        }
        ... on SimpleProductView {
          price {
            final { amount { value currency } }
          }
        }
      }
    }
  `;
  const pageSize = 2;
  let crossSellProducts = [];
  let crossSellPage = 0;
  let crossSellSignature = '';

  function renderCrossSells() {
    $crossSells.innerHTML = '';
    if (!crossSellProducts.length) return;

    const heading = document.createElement('h2');
    heading.className = 'cart__cross-sells-heading';
    heading.textContent = placeholders?.Global?.CartCrossSellHeading || 'You may also like';
    $crossSells.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'cart__cross-sells-grid';
    const start = crossSellPage * pageSize;
    crossSellProducts.slice(start, start + pageSize).forEach((product) => {
      const card = document.createElement('article');
      card.className = 'cart__cross-sell-card';

      const image = product.images?.[0];
      if (image?.url) {
        const imageElement = document.createElement('img');
        imageElement.src = image.url;
        imageElement.alt = image.label || product.name;
        imageElement.loading = 'lazy';
        card.appendChild(imageElement);
      }

      const name = document.createElement('h3');
      name.className = 'cart__cross-sell-name';
      name.textContent = product.name;
      card.appendChild(name);

      const sku = document.createElement('p');
      sku.className = 'cart__cross-sell-sku';
      sku.textContent = product.sku;
      card.appendChild(sku);

      const price = document.createElement('p');
      price.className = 'cart__cross-sell-price';
      const amount = product.price?.final?.amount;
      price.textContent = amount
        ? new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: amount.currency,
        }).format(amount.value)
        : '';
      card.appendChild(price);

      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'dropin-button dropin-button--primary dropin-button--medium cart__cross-sell-add';
      const addIcon = document.createElement('span');
      addIcon.className = 'cart__cross-sell-add-icon';
      UI.render(Icon, { source: 'Cart', size: '24', 'aria-hidden': 'true' })(addIcon);
      addButton.appendChild(addIcon);
      const addLabel = document.createElement('span');
      addLabel.textContent = placeholders?.Global?.AddProductToCart || 'Add to cart';
      addButton.appendChild(addLabel);
      addButton.addEventListener('click', async () => {
        addButton.disabled = true;
        addButton.setAttribute('aria-busy', 'true');
        try {
          await Cart.addProductsToCart([{ sku: product.sku, quantity: 1 }]);
          await Cart.refreshCart();
        } catch (error) {
          console.error('Unable to add cross-sell product to cart', error);
          addButton.disabled = false;
          addButton.removeAttribute('aria-busy');
          addButton.textContent = placeholders?.Global?.AddProductToCartError || 'Try again';
        }
      });
      card.appendChild(addButton);
      grid.appendChild(card);
    });
    $crossSells.appendChild(grid);

    const totalPages = Math.ceil(crossSellProducts.length / pageSize);
    if (totalPages > 1) {
      const pagination = document.createElement('nav');
      pagination.className = 'cart__cross-sells-pagination';
      pagination.setAttribute('aria-label', 'Cross-sell products pagination');

      const previous = document.createElement('button');
      previous.type = 'button';
      previous.className = 'cart__cross-sells-pagination-button';
      previous.setAttribute('aria-label', 'Previous page');
      const previousIcon = document.createElement('span');
      previousIcon.className = 'cart__cross-sells-pagination-icon cart__cross-sells-pagination-icon--previous';
      UI.render(Icon, { source: 'ChevronRight', size: '24', 'aria-hidden': 'true' })(previousIcon);
      previous.appendChild(previousIcon);
      previous.disabled = crossSellPage === 0;
      previous.addEventListener('click', () => {
        crossSellPage -= 1;
        renderCrossSells();
      });

      const pageLabel = document.createElement('span');
      pageLabel.textContent = `Page ${crossSellPage + 1} of ${totalPages}`;

      const next = document.createElement('button');
      next.type = 'button';
      next.className = 'cart__cross-sells-pagination-button';
      next.setAttribute('aria-label', 'Next page');
      const nextIcon = document.createElement('span');
      nextIcon.className = 'cart__cross-sells-pagination-icon';
      UI.render(Icon, { source: 'ChevronRight', size: '24', 'aria-hidden': 'true' })(nextIcon);
      next.appendChild(nextIcon);
      next.disabled = crossSellPage >= totalPages - 1;
      next.addEventListener('click', () => {
        crossSellPage += 1;
        renderCrossSells();
      });

      pagination.append(previous, pageLabel, next);
      $crossSells.appendChild(pagination);
    }
  }

  async function loadCrossSells(cartData) {
    const cartItems = Array.isArray(cartData?.items) ? cartData.items : [];
    const cartSkus = cartItems.map((item) => item.sku).filter(Boolean);
    const signature = cartSkus.slice().sort().join('|');
    if (signature === crossSellSignature) return;
    crossSellSignature = signature;
    crossSellProducts = [];
    crossSellPage = 0;
    $crossSells.innerHTML = '';
    if (!cartSkus.length) return;

    try {
      const { data, errors } = await CS_FETCH_GRAPHQL.fetchGraphQl(CROSS_SELL_QUERY, {
        variables: { skus: cartSkus },
      });
      if (errors?.length) throw new Error(errors[0].message || 'Cross-sell lookup failed');
      const inCart = new Set(cartSkus);
      const seen = new Set();
      crossSellProducts = (data?.products || [])
        .flatMap((product) => (product.links || [])
          .filter((link) => link.linkTypes?.includes('crosssell'))
          .map((link) => link.product?.sku))
        .filter((sku) => sku && !inCart.has(sku) && !seen.has(sku) && (seen.add(sku), true));

      if (crossSellProducts.length) {
        const details = await CS_FETCH_GRAPHQL.fetchGraphQl(CROSS_SELL_QUERY, {
          variables: { skus: crossSellProducts },
        });
        if (details.errors?.length) throw new Error(details.errors[0].message || 'Cross-sell details failed');
        crossSellProducts = (details.data?.products || [])
          .filter((product) => product.__typename === 'SimpleProductView' && product.addToCartAllowed !== false);
      }
      renderCrossSells();
    } catch (error) {
      console.error('Unable to load cross-sell products', error);
      $crossSells.innerHTML = '';
    }
  }

  let cartViewEventPublished = false;
  // Events
  events.on(
    'cart/data',
    (cartData) => {
      toggleEmptyCart(isCartEmpty(cartData));
      loadCrossSells(cartData);

      const isEmpty = !cartData || cartData.totalQuantity < 1;
      $rightColumn.style.display = isEmpty ? 'none' : '';

      if (!cartViewEventPublished) {
        cartViewEventPublished = true;
        publishShoppingCartViewEvent();
      }
    },
    { eager: true },
  );

  events.on('wishlist/alert', ({ action, item }) => {
    wishlistRender.render(WishlistAlert, {
      action,
      item,
      routeToWishlist,
    })($notification);

    setTimeout(() => {
      $notification.innerHTML = '';
    }, 5000);
  });

  return Promise.resolve();
}

function isCartEmpty(cart) {
  return cart ? cart.totalQuantity < 1 : true;
}
