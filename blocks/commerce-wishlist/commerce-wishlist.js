import * as cartApi from '@dropins/storefront-cart/api.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import { render as wishlistRenderer } from '@dropins/storefront-wishlist/render.js';
import { render as authRenderer } from '@dropins/storefront-auth/render.js';
import { AuthCombine } from '@dropins/storefront-auth/containers/AuthCombine.js';
import { events } from '@dropins/tools/event-bus.js';
import Wishlist from '@dropins/storefront-wishlist/containers/Wishlist.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
import {
  CS_FETCH_GRAPHQL, rootLink, getProductLink, fetchPlaceholders,
} from '../../scripts/commerce.js';
import { readBlockConfig } from '../../scripts/aem.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { getExternalEventId, isEventProduct } from '../../scripts/event-app/models.js';
import { renderEventCardMetadata } from '../../scripts/event-app/card-metadata.js';

import '../../scripts/initializers/wishlist.js';
import '../../scripts/initializers/cart.js';

// Initialize

// Inherit Fetch GraphQL Instance (Catalog Service)
pdpApi.setEndpoint(CS_FETCH_GRAPHQL);

const WISHLIST_IMAGE_DIMENSIONS = {
  width: 400,
  height: 250,
};

const showAuthModal = (event) => {
  if (event) {
    event.preventDefault();
  }

  const signInModal = document.createElement('div');
  signInModal.setAttribute('id', 'signin-modal');

  const signInForm = document.createElement('div');
  signInForm.setAttribute('id', 'signin-form');

  signInModal.onclick = (clickEvent) => {
    if (clickEvent.target === signInModal) {
      signInModal.remove();
    }
  };

  signInModal.appendChild(signInForm);
  document.body.appendChild(signInModal);

  // Render auth form
  authRenderer.render(AuthCombine, {
    signInFormConfig: {
      renderSignUpLink: true,
      onSuccessCallback: () => {
        window.location.reload();
      },
    },
    signUpFormConfig: {
      onSuccessCallback: () => {
        window.location.reload();
      },
    },
    resetPasswordFormConfig: {},
  })(signInForm);
};

events.on('wishlist/alert', () => {
  setTimeout(() => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, 0);
});

export default async function decorate(block) {
  const labels = await fetchPlaceholders();
  const eventClient = createEventAppClient();
  const content = document.createElement('div');
  const productRequests = new Map();
  let productsByUrl = new Map();
  let eventDetails = new Map();
  let eventInfoPending = false;
  let wishlistVersion = 0;
  const productUrl = (product) => (
    new URL(getProductLink(product.urlKey, product.sku), window.location.origin).href
  );
  const fetchProduct = (method, args) => {
    const key = JSON.stringify([method, args]);
    if (!productRequests.has(key)) {
      const request = pdpApi[method](...args).catch((error) => {
        productRequests.delete(key);
        throw error;
      });
      productRequests.set(key, request);
    }
    return productRequests.get(key);
  };
  const getProductData = (...args) => fetchProduct('getProductData', args);
  const getRefinedProduct = (...args) => fetchProduct('getRefinedProduct', args);

  function updateEventCards() {
    content.querySelectorAll('.wishlist-product-item').forEach((card) => {
      const name = card.querySelector('.wishlist-product-item-name');
      const product = productsByUrl.get(name?.href);
      if (!product || !isEventProduct(product)) return;
      const eventId = getExternalEventId(product);
      if (!eventId) return;
      let metadata = card.querySelector('.wishlist-event-info');
      if (!metadata) {
        metadata = document.createElement('div');
        metadata.className = 'event-card-metadata wishlist-event-info';
        name.insertAdjacentElement('afterend', metadata);
      }
      const state = eventInfoPending ? `pending:${eventId}` : `ready:${wishlistVersion}:${eventId}`;
      if (metadata.dataset.state === state) return;
      metadata.dataset.state = state;
      if (eventInfoPending) {
        metadata.setAttribute('aria-busy', 'true');
        metadata.textContent = labels.Global?.EventDetailsLoading || 'Loading event details';
      } else {
        renderEventCardMetadata(metadata, eventDetails.get(eventId), labels);
      }
    });
  }

  async function loadEventInfo(data) {
    wishlistVersion += 1;
    const version = wishlistVersion;
    if (!eventClient.config.enabled) return;
    const items = data?.items || [];
    const results = await Promise.allSettled(items.map((item) => (
      item.selectedOptions?.length
        ? getRefinedProduct(item.product.sku, item.selectedOptions.map((option) => option.uid))
        : getProductData(item.product.sku)
    )));
    if (version !== wishlistVersion) return;
    const products = results.flatMap((result) => (
      result.status === 'fulfilled' && result.value ? [result.value] : []
    ));
    productsByUrl = new Map(products.map((product) => [productUrl(product), product]));
    const ids = [...new Set(products.filter(isEventProduct)
      .map(getExternalEventId).filter(Boolean))];
    eventDetails = new Map();
    eventInfoPending = ids.length > 0;
    updateEventCards();
    if (!ids.length) return;
    try {
      const details = await eventClient.enrich(ids);
      if (version !== wishlistVersion) return;
      eventDetails = details;
    } catch (error) {
      if (version !== wishlistVersion) return;
      console.error('Error enriching saved events', error);
    }
    eventInfoPending = false;
    updateEventCards();
  }
  const {
    'start-shopping-url': startShoppingURL = '',
  } = readBlockConfig(block);

  const header = document.createElement('div');
  header.className = 'wishlist-page-header';
  const title = document.createElement('h1');
  title.textContent = 'Saved events';
  const count = document.createElement('p');
  count.className = 'wishlist-page-count';
  count.setAttribute('aria-live', 'polite');
  header.append(title, count);
  block.replaceChildren(header, content);
  // Wishlist exposes an image slot only. Observe its card mounts to place the
  // native metadata after each title without replacing Commerce-owned actions.
  const observer = new MutationObserver(() => {
    if (!block.isConnected) observer.disconnect();
    else updateEventCards();
  });
  observer.observe(content, { childList: true, subtree: true });
  events.on('wishlist/data', (data) => {
    const quantity = data?.items_count || 0;
    const number = document.createElement('strong');
    number.textContent = quantity;
    count.replaceChildren(number, quantity === 1 ? ' saved event' : ' saved events');
    loadEventInfo(data);
  }, { eager: true });

  await wishlistRenderer.render(Wishlist, {
    routeEmptyWishlistCTA: startShoppingURL ? () => rootLink(startShoppingURL) : undefined,
    moveProdToCart: cartApi.addProductsToCart,
    routeProdDetailPage: (product) => getProductLink(product.urlKey, product.sku),
    onLoginClick: showAuthModal,
    getProductData,
    getRefinedProduct,
    slots: {
      image: (ctx) => {
        const { item, defaultImageProps } = ctx;
        tryRenderAemAssetsImage(ctx, {
          alias: item.product.sku,
          imageProps: {
            ...defaultImageProps,
            ...WISHLIST_IMAGE_DIMENSIONS,
          },
          params: {
            ...WISHLIST_IMAGE_DIMENSIONS,
          },
        });
      },
    },
  })(content);
}
