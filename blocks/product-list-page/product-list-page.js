// Product Discovery Dropins
import SearchResults from '@dropins/storefront-product-discovery/containers/SearchResults.js';
import Facets from '@dropins/storefront-product-discovery/containers/Facets.js';
import SortBy from '@dropins/storefront-product-discovery/containers/SortBy.js';
import Pagination from '@dropins/storefront-product-discovery/containers/Pagination.js';
import { render as provider } from '@dropins/storefront-product-discovery/render.js';
import { Button, Icon, provider as UI } from '@dropins/tools/components.js';
import { search } from '@dropins/storefront-product-discovery/api.js';
// Wishlist Dropin
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
// Cart Dropin
import * as cartApi from '@dropins/storefront-cart/api.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
// Event Bus
import { events } from '@dropins/tools/event-bus.js';
// AEM
import { readBlockConfig } from '../../scripts/aem.js';
import { fetchPlaceholders, getProductLink } from '../../scripts/commerce.js';
import { getSearchStateFromUrl, applySearchStateToUrl } from './search-url.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { formatEventDateRange } from '../../scripts/event-app/dates.js';
import {
  getExternalEventId,
  isEventProduct,
} from '../../scripts/event-app/models.js';

// Initializers
import '../../scripts/initializers/search.js';
import '../../scripts/initializers/wishlist.js';

export default async function decorate(block) {
  const labels = await fetchPlaceholders();
  const eventClient = createEventAppClient();
  let enrichmentRequest = 0;

  const config = readBlockConfig(block);
  const pageSize = parseInt(config.pagesize, 10) || 9;

  const fragment = document.createRange().createContextualFragment(`
    <div class="search__wrapper">
      <div class="search__result-info"></div>
      <div class="search__view-facets"></div>
      <div class="search__facets"></div>
      <div class="search__product-sort"></div>
      <div class="search__product-list"></div>
      <div class="search__event-status" aria-live="polite"></div>
      <div class="search__pagination"></div>
    </div>
  `);

  const $resultInfo = fragment.querySelector('.search__result-info');
  const $viewFacets = fragment.querySelector('.search__view-facets');
  const $facets = fragment.querySelector('.search__facets');
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
  const $eventStatus = fragment.querySelector('.search__event-status');
  const $pagination = fragment.querySelector('.search__pagination');

  block.innerHTML = '';
  block.appendChild(fragment);

  // Add url path back to the block for enrichment, incase enrichment block is
  // executed after the plp block and block config is not available
  if (config.urlpath) {
    block.dataset.urlpath = config.urlpath;
  }

  const searchState = getSearchStateFromUrl(new URL(window.location.href));

  // Default visibility filter for all of our requests
  const visibilityFilter = { attribute: 'visibility', in: ['Search', 'Catalog, Search'] };
  const userFilters = searchState.filter.filter((f) => f.attribute !== 'visibility');

  // Normalize URL (e.g. pipe-separated filter values)
  const normalizedUrl = new URL(window.location.href);
  applySearchStateToUrl(normalizedUrl, searchState);
  window.history.replaceState({}, '', normalizedUrl.toString());

  // Request search based on the page type on block load
  if (config.urlpath) {
    // If it's a category page...
    await search({
      phrase: '', // search all products in the category
      currentPage: searchState.currentPage,
      pageSize,
      sort: searchState?.sort?.length ? searchState.sort : [{ attribute: 'position', direction: 'DESC' }],
      filter: [
        { attribute: 'categoryPath', eq: config.urlpath }, // Add category filter
        // Always add visibility filter to the request
        visibilityFilter,
        ...userFilters,
      ],
    }).catch((error) => {
      console.error('Error searching for products', error);
    });
  } else {
    // Search page: dropin uses only the request (no URL parsing).
    await search({
      phrase: searchState.phrase,
      currentPage: searchState.currentPage,
      pageSize,
      sort: searchState.sort,
      // Always add visibility filter to the request
      filter: [visibilityFilter, ...userFilters],
    }).catch((error) => {
      console.error('Error searching for products', error);
    });
  }

  const getAddToCartButton = (product) => {
    if (isEventProduct(product) || product.typename === 'ComplexProductView') {
      const button = document.createElement('div');
      UI.render(Button, {
        children: isEventProduct(product)
          ? labels.Global?.ViewEvent || 'View event'
          : labels.Global?.AddProductToCart,
        href: getProductLink(product.urlKey, product.sku),
        variant: 'primary',
      })(button);
      return button;
    }
    const button = document.createElement('div');
    UI.render(Button, {
      children: labels.Global?.AddProductToCart,
      icon: Icon({ source: 'Cart' }),
      onClick: () => cartApi.addProductsToCart([{ sku: product.sku, quantity: 1 }]),
      variant: 'primary',
    })(button);
    return button;
  };

  function updateEventCards(eventMap, expectedIds) {
    block.querySelectorAll('.event-card-metadata').forEach((metadata) => {
      const { eventId } = metadata.dataset;
      if (!expectedIds.has(eventId)) return;

      metadata.replaceChildren();
      const event = eventMap.get(eventId);
      if (!event) {
        metadata.textContent = labels.Global?.EventDetailsUnavailable
          || 'Event details unavailable';
        metadata.classList.add('event-card-metadata--unavailable');
        metadata.removeAttribute('hidden');
        return;
      }

      const schedule = document.createElement('span');
      schedule.className = 'event-card-metadata__schedule';
      schedule.textContent = formatEventDateRange(event);

      const venue = document.createElement('span');
      venue.className = 'event-card-metadata__venue';
      venue.textContent = `${event.venue.name}, ${event.venue.address}`;

      const organizer = document.createElement('span');
      organizer.className = 'event-card-metadata__organizer';
      organizer.textContent = event.organizer;

      metadata.classList.remove('event-card-metadata--unavailable');
      metadata.append(schedule, venue, organizer);
      metadata.removeAttribute('hidden');
    });
  }

  async function enrichEventProducts(products) {
    enrichmentRequest += 1;
    const requestId = enrichmentRequest;
    const eventIds = products
      .filter(isEventProduct)
      .map(getExternalEventId)
      .filter(Boolean);
    const uniqueIds = [...new Set(eventIds)];

    $eventStatus.textContent = '';
    if (!eventClient.config.enabled || uniqueIds.length === 0) return;

    try {
      const eventMap = await eventClient.enrich(uniqueIds);
      if (requestId !== enrichmentRequest) return;
      updateEventCards(eventMap, new Set(uniqueIds));
    } catch (error) {
      console.error('Error enriching event products', error);
      if (requestId !== enrichmentRequest) return;
      updateEventCards(new Map(), new Set(uniqueIds));
      $eventStatus.textContent = labels.Global?.EventEnrichmentUnavailable
        || 'Some event details are temporarily unavailable.';
    }
  }

  await Promise.all([
    // Sort By
    provider.render(SortBy, {})($productSort),

    // Pagination
    provider.render(Pagination, {
      onPageChange: () => {
        // scroll to the top of the page
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    })($pagination),

    // View Facets Button
    UI.render(Button, {
      children: labels.Global?.Filters,
      icon: Icon({ source: 'Burger' }),
      variant: 'secondary',
      onClick: () => {
        $facets.classList.toggle('search__facets--visible');
      },
    })($viewFacets),

    // Facets
    provider.render(Facets, {})($facets),
    // Product List
    provider.render(SearchResults, {
      imageWidth: 400,
      imageHeight: 250,
      routeProduct: (product) => getProductLink(product.urlKey, product.sku),
      onSearchResult: enrichEventProducts,
      slots: {
        ProductImage: (ctx) => {
          const { product, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = getProductLink(product.urlKey, product.sku);

          const imageProps = {
            ...defaultImageProps,
            params: {
              ...defaultImageProps.params,
              width: 400,
              height: 250,
              crop: false,
              fit: 'contain',
            },
          };

          tryRenderAemAssetsImage(ctx, {
            alias: product.sku,
            imageProps,
            wrapper: anchorWrapper,
            params: {
              width: 400,
              height: 250,
            },
          });
        },
        ProductActions: (ctx) => {
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'product-discovery-product-actions';
          // Add to Cart Button
          const addToCartBtn = getAddToCartButton(ctx.product);
          addToCartBtn.className = 'product-discovery-product-actions__add-to-cart';
          // Wishlist Button
          const $wishlistToggle = document.createElement('div');
          $wishlistToggle.classList.add('product-discovery-product-actions__wishlist-toggle');
          wishlistRender.render(WishlistToggle, {
            product: ctx.product,
            variant: 'tertiary',
          })($wishlistToggle);
          actionsWrapper.appendChild(addToCartBtn);
          actionsWrapper.appendChild($wishlistToggle);
          ctx.replaceWith(actionsWrapper);
        },
        ProductName: (ctx) => {
          if (!isEventProduct(ctx.product)) return;
          const eventId = getExternalEventId(ctx.product);
          if (!eventId) return;

          const metadata = document.createElement('span');
          metadata.className = 'event-card-metadata';
          metadata.dataset.eventId = eventId;
          metadata.setAttribute('hidden', '');
          ctx.appendChild(metadata);
        },
      },
    })($productList),
  ]);

  // Listen for search results (event is fired before the block is rendered; eager: true)
  events.on('search/result', (payload) => {
    const totalCount = payload.result?.totalCount || 0;

    block.classList.toggle('product-list-page--empty', totalCount === 0);

    // Results Info
    $resultInfo.innerHTML = payload.request?.phrase
      ? `${totalCount} results found for <strong>"${payload.request.phrase}"</strong>.`
      : `${totalCount} results found.`;

    // Update the view facets button with the number of filters
    if (payload.request.filter.length > 0) {
      $viewFacets.querySelector('button').setAttribute('data-count', payload.request.filter.length);
    } else {
      $viewFacets.querySelector('button').removeAttribute('data-count');
    }
  }, { eager: true });

  // Listen for search results (event is fired after the block is rendered; eager: false)
  // URL is owned by this project; update it when search state changes.
  events.on('search/result', (payload) => {
    const url = new URL(window.location.href);
    applySearchStateToUrl(url, payload.request);
    window.history.pushState({}, '', url.toString());
  }, { eager: false });
}
