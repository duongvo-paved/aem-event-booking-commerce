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
import { isAemAssetsEnabled, tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
// Event Bus
import { events } from '@dropins/tools/event-bus.js';
// AEM
import { readBlockConfig } from '../../scripts/aem.js';
import { fetchPlaceholders, getProductLink } from '../../scripts/commerce.js';
import { getSearchStateFromUrl, applySearchStateToUrl } from './search-url.js';
import { createEventAppClient } from '../../scripts/event-app/client.js';
import { renderEventCardMetadata } from '../../scripts/event-app/card-metadata.js';
import {
  getExternalEventId,
  isEventProduct,
} from '../../scripts/event-app/models.js';

// Initializers
import '../../scripts/initializers/search.js';
import '../../scripts/initializers/wishlist.js';

const HIDDEN_FILTER_ATTRIBUTES = new Set(['categoryPath', 'inStock', 'visibility']);

export function isFreeProduct(product) {
  if (product.priceRange) {
    return product.priceRange.minimum?.final?.amount?.value === 0
      && product.priceRange.maximum?.final?.amount?.value === 0;
  }
  return product.price?.final?.amount?.value === 0;
}

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
  const filterHeader = document.createElement('div');
  filterHeader.className = 'search__facets-header';
  const filterHeading = document.createElement('h2');
  filterHeading.className = 'search__facets-heading';
  filterHeading.tabIndex = -1;
  filterHeading.textContent = labels.Global?.Filter || 'Filter';
  filterHeader.append(filterHeading);
  const facetControls = document.createElement('div');
  $facets.append(filterHeader, facetControls);
  const appliedFilters = document.createElement('div');
  appliedFilters.className = 'search__applied-filters';
  appliedFilters.hidden = true;
  fragment.querySelector('.search__wrapper').prepend(appliedFilters);
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
  const $eventStatus = fragment.querySelector('.search__event-status');
  const $pagination = fragment.querySelector('.search__pagination');
  $pagination.setAttribute('role', 'navigation');
  $pagination.setAttribute('aria-label', 'Pagination');
  const toolbar = document.createElement('div');
  toolbar.className = 'search__toolbar';
  toolbar.append($resultInfo, $productSort);
  fragment.querySelector('.search__wrapper').insertBefore(toolbar, $productList);

  block.innerHTML = '';
  block.appendChild(fragment);

  // Add url path back to the block for enrichment, incase enrichment block is
  // executed after the plp block and block config is not available
  if (config.urlpath) {
    block.dataset.urlpath = config.urlpath;
  }

  const searchState = getSearchStateFromUrl(new URL(window.location.href));
  let currentRequest = searchState;

  // Default visibility filter for all of our requests
  const visibilityFilter = { attribute: 'visibility', in: ['Search', 'Catalog, Search'] };
  const inStockFilter = { attribute: 'inStock', eq: 'true' };
  const userFilters = searchState.filter
    .filter((filter) => !HIDDEN_FILTER_ATTRIBUTES.has(filter.attribute));

  const searchWithState = (state) => search({
    ...state,
    pageSize,
    phrase: config.urlpath ? '' : state.phrase,
    filter: [
      ...(config.urlpath ? [{ attribute: 'categoryPath', eq: config.urlpath }] : []),
      visibilityFilter,
      inStockFilter,
      ...(state.filter || []).filter((filter) => !HIDDEN_FILTER_ATTRIBUTES.has(filter.attribute)),
    ],
  });
  const updateFilters = (filter) => {
    $eventStatus.textContent = '';
    searchWithState({ ...currentRequest, currentPage: 1, filter }).catch(() => {
      $eventStatus.textContent = labels.Global?.SearchError
        || 'Could not update events. Please try again.';
    });
  };

  function renderAppliedFilters(request, facets = []) {
    const restoreFocus = appliedFilters.contains(document.activeElement);
    const filters = (request.filter || [])
      .filter((filter) => !HIDDEN_FILTER_ATTRIBUTES.has(filter.attribute));
    appliedFilters.replaceChildren();
    appliedFilters.hidden = filters.length === 0;
    if (filters.length === 0) {
      if (restoreFocus) filterHeading.focus();
      return;
    }

    const caption = document.createElement('span');
    caption.className = 'search__applied-label';
    caption.textContent = labels.Global?.FilteredBy || 'Filtered by';
    appliedFilters.append(caption);
    filters.forEach((filter) => {
      const facet = facets.find((item) => item.attribute === filter.attribute);
      const values = filter.in
        || [filter.eq ?? filter.contains ?? filter.startsWith ?? filter.range];
      values.forEach((value) => {
        const bucket = facet?.buckets.find((item) => (filter.range
          ? item.from === filter.range.from && item.to === filter.range.to
          : item.title === value));
        const title = bucket?.title || (filter.range
          ? `${filter.range.from}–${filter.range.to}` : String(value));
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'search__filter-chip';
        chip.setAttribute('aria-label', `Remove ${facet?.title || filter.attribute} filter: ${title}`);
        const text = document.createElement('span');
        text.textContent = title;
        const remove = document.createElement('span');
        remove.textContent = '×';
        remove.setAttribute('aria-hidden', 'true');
        chip.append(text, remove);
        chip.addEventListener('click', () => {
          const remaining = (currentRequest.filter || []).flatMap((item) => {
            if (item.attribute !== filter.attribute) return [item];
            if (!item.in) return [];
            const nextValues = item.in.filter((entry) => entry !== value);
            return nextValues.length ? [{ ...item, in: nextValues }] : [];
          });
          updateFilters(remaining);
        });
        appliedFilters.append(chip);
      });
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'search__clear-filters';
    clear.textContent = labels.Search?.Facet?.clearAll || 'Clear all';
    clear.addEventListener('click', () => updateFilters([]));
    appliedFilters.append(clear);
    if (restoreFocus) appliedFilters.querySelector('button').focus();
  }
  window.addEventListener('popstate', () => {
    searchWithState(getSearchStateFromUrl(new URL(window.location.href))).catch(() => {
      $eventStatus.textContent = labels.Global?.SearchError
        || 'Could not update events. Please try again.';
    });
  });

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
        // Only return products that are currently in stock
        inStockFilter,
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
      filter: [visibilityFilter, inStockFilter, ...userFilters],
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

      renderEventCardMetadata(metadata, eventMap.get(eventId), labels);
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
    provider.render(Facets, {
      slots: {
        SelectedFacets: (ctx) => {
          const placeholder = document.createElement('span');
          placeholder.hidden = true;
          ctx.replaceWith(placeholder);
        },
      },
    })(facetControls),
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

          if (!isAemAssetsEnabled() && !product.images?.some((image) => image.url)) {
            anchorWrapper.className = 'event-card-image-placeholder';
            anchorWrapper.setAttribute('aria-label', `View ${product.name}`);
            ctx.replaceWith(anchorWrapper);
          } else {
            tryRenderAemAssetsImage(ctx, {
              alias: product.sku,
              imageProps,
              wrapper: anchorWrapper,
              params: {
                width: 400,
                height: 250,
              },
            });
          }

          const wishlist = document.createElement('div');
          wishlist.className = 'event-card-wishlist';
          wishlistRender.render(WishlistToggle, {
            product,
            variant: 'tertiary',
          })(wishlist);
          ctx.appendSibling(wishlist);
          if (isEventProduct(product) && isFreeProduct(product)) {
            const badge = document.createElement('span');
            badge.className = 'event-card-free-badge';
            badge.textContent = 'FREE';
            ctx.appendSibling(badge);
          }
        },
        ProductPrice: (ctx) => {
          if (!isEventProduct(ctx.product)) return;
          const minimum = ctx.product.priceRange?.minimum?.final?.amount
            || ctx.product.price?.final?.amount;
          if (!minimum || !Number.isFinite(minimum.value) || !minimum.currency) return;
          const price = document.createElement('span');
          price.className = isFreeProduct(ctx.product) ? 'event-card-free-price' : 'event-card-minimum-price';
          price.textContent = minimum.value === 0
            ? labels.Global?.Free || 'Free'
            : new Intl.NumberFormat(document.documentElement.lang || 'en-US', {
              style: 'currency', currency: minimum.currency,
            }).format(minimum.value);
          ctx.replaceWith(price);
        },
        ProductActions: (ctx) => {
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'product-discovery-product-actions';
          // Add to Cart Button
          const addToCartBtn = getAddToCartButton(ctx.product);
          addToCartBtn.className = 'product-discovery-product-actions__add-to-cart';
          actionsWrapper.appendChild(addToCartBtn);
          ctx.replaceWith(actionsWrapper);
        },
        ProductName: (ctx) => {
          if (!isEventProduct(ctx.product)) return;
          const eventId = getExternalEventId(ctx.product);
          if (!eventId) return;

          const metadata = document.createElement('span');
          metadata.className = 'event-card-metadata';
          metadata.dataset.eventId = eventId;
          if (eventClient.config.enabled) {
            metadata.setAttribute('aria-busy', 'true');
            [
              'event-card-metadata__skeleton--schedule',
              'event-card-metadata__skeleton--venue',
              'event-card-metadata__skeleton--organizer',
            ].forEach((skeletonClass) => {
              const skeleton = document.createElement('span');
              skeleton.classList.add('event-card-metadata__skeleton');
              skeleton.classList.add(skeletonClass);
              skeleton.setAttribute('aria-hidden', 'true');
              metadata.append(skeleton);
            });
          } else {
            metadata.setAttribute('hidden', '');
          }
          ctx.appendChild(metadata);
        },
      },
    })($productList),
  ]);

  // Listen for search results (event is fired before the block is rendered; eager: true)
  events.on('search/result', (payload) => {
    const totalCount = payload.result?.totalCount || 0;
    currentRequest = payload.request;
    renderAppliedFilters(currentRequest, payload.result?.facets);

    block.classList.toggle('product-list-page--empty', totalCount === 0);

    // Results Info
    const page = payload.result?.pageInfo?.currentPage || payload.request.currentPage || 1;
    const size = payload.result?.pageInfo?.pageSize || payload.request.pageSize || pageSize;
    const start = totalCount ? (page - 1) * size + 1 : 0;
    const end = Math.min(start + (payload.result?.items?.length || 0) - 1, totalCount);
    const range = document.createElement('strong');
    range.textContent = `${start}–${Math.max(0, end)}`;
    const total = document.createElement('strong');
    total.textContent = totalCount;
    $resultInfo.replaceChildren('Showing ', range, ' of ', total, ' events');

    // Update the view facets button with the number of filters
    const visibleFilterCount = payload.request.filter
      .filter((filter) => !HIDDEN_FILTER_ATTRIBUTES.has(filter.attribute)).length;
    if (visibleFilterCount > 0) {
      $viewFacets.querySelector('button').setAttribute('data-count', visibleFilterCount);
    } else {
      $viewFacets.querySelector('button').removeAttribute('data-count');
    }
  }, { eager: true });

  // Listen for search results (event is fired after the block is rendered; eager: false)
  // URL is owned by this project; update it when search state changes.
  events.on('search/result', (payload) => {
    const url = new URL(window.location.href);
    applySearchStateToUrl(url, payload.request);
    if (url.toString() !== window.location.href) {
      window.history.pushState({}, '', url.toString());
    }
  }, { eager: false });
}
