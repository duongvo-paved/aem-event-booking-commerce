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
import { BOOKING_TYPE, formatBookingDateTime } from '../../scripts/booking.js';

// Initializers
import '../../scripts/initializers/search.js';
import '../../scripts/initializers/wishlist.js';

/**
 * Reads a named attribute from the product's attributes array.
 * @param {Object} product
 * @param {string} name - attribute name (e.g. 'booking_type')
 * @returns {string|null}
 */
function getProductAttribute(product, name) {
  return product?.attributes?.find((a) => a.name === name)?.value ?? null;
}

/**
 * Returns true when the product carries a booking_type attribute,
 * meaning it is a bookable product.
 * @param {Object} product
 * @returns {boolean}
 */
function isBookingProduct(product) {
  return !!getProductAttribute(product, 'booking_type');
}

/**
 * Builds the human-readable label for a booking type badge.
 * @param {string} type
 * @param {Object} labels - placeholders
 * @returns {string}
 */
function getBookingTypeLabel(type, labels) {
  const map = {
    [BOOKING_TYPE.APPOINTMENT]: labels.Booking?.TypeAppointment ?? 'Appointment',
    [BOOKING_TYPE.EVENT]: labels.Booking?.TypeEvent ?? 'Event',
    [BOOKING_TYPE.VENUE]: labels.Booking?.TypeVenue ?? 'Venue',
  };
  return map[type] ?? type;
}

/**
 * Creates the event metadata DOM element injected below the product name.
 * Shows: booking-type badge, date/time, location, availability.
 * @param {Object} product
 * @param {Object} labels
 * @returns {HTMLElement}
 */
function createEventMetaElement(product, labels) {
  const bookingType = getProductAttribute(product, 'booking_type');
  const eventDate = getProductAttribute(product, 'event_date');
  const eventEndDate = getProductAttribute(product, 'event_end_date');
  const eventStartTime = getProductAttribute(product, 'event_start_time');
  const eventEndTime = getProductAttribute(product, 'event_end_time');
  const eventLocation = getProductAttribute(product, 'event_location');
  const eventCapacity = getProductAttribute(product, 'event_capacity');
  const eventAvailableCapacity = getProductAttribute(product, 'event_available_capacity');

  const meta = document.createElement('div');
  meta.className = 'event-meta';
  meta.dataset.bookingType = bookingType;

  // Booking type badge
  const badge = document.createElement('span');
  badge.className = `event-meta__badge event-meta__badge--${bookingType}`;
  badge.textContent = getBookingTypeLabel(bookingType, labels);
  meta.appendChild(badge);

  // Date / time
  if (eventDate) {
    const dateEl = document.createElement('div');
    dateEl.className = 'event-meta__date';

    const dateIcon = document.createElement('span');
    dateIcon.className = 'event-meta__icon event-meta__icon--calendar';
    dateIcon.setAttribute('aria-hidden', 'true');
    dateEl.appendChild(dateIcon);

    const dateText = document.createElement('span');
    const isVenue = bookingType === BOOKING_TYPE.VENUE;
    if (isVenue && eventEndDate) {
      dateText.textContent = `${formatBookingDateTime(eventDate)} – ${formatBookingDateTime(eventEndDate)}`;
    } else {
      dateText.textContent = formatBookingDateTime(eventDate, eventStartTime, eventEndTime);
    }
    dateEl.appendChild(dateText);
    meta.appendChild(dateEl);
  }

  // Location
  if (eventLocation) {
    const locEl = document.createElement('div');
    locEl.className = 'event-meta__location';

    const locIcon = document.createElement('span');
    locIcon.className = 'event-meta__icon event-meta__icon--location';
    locIcon.setAttribute('aria-hidden', 'true');
    locEl.appendChild(locIcon);

    const locText = document.createElement('span');
    locText.textContent = eventLocation;
    locEl.appendChild(locText);
    meta.appendChild(locEl);
  }

  // Availability indicator
  if (eventCapacity !== null && eventAvailableCapacity !== null) {
    const available = parseInt(eventAvailableCapacity, 10);
    const total = parseInt(eventCapacity, 10);
    const availEl = document.createElement('div');
    availEl.className = 'event-meta__availability';

    if (available <= 0) {
      availEl.classList.add('event-meta__availability--sold-out');
      availEl.textContent = labels.Booking?.SoldOut ?? 'Sold out';
    } else if (available <= Math.ceil(total * 0.1)) {
      availEl.classList.add('event-meta__availability--low');
      availEl.textContent = (labels.Booking?.SpotsLeft ?? '{n} spots left').replace('{n}', available);
    } else {
      availEl.classList.add('event-meta__availability--available');
      availEl.textContent = labels.Booking?.Available ?? 'Available';
    }
    meta.appendChild(availEl);
  }

  return meta;
}

export default async function decorate(block) {
  const labels = await fetchPlaceholders();

  const config = readBlockConfig(block);
  const pageSize = parseInt(config.pagesize, 10) || 9;

  const fragment = document.createRange().createContextualFragment(`
    <div class="search__wrapper">
      <div class="search__result-info"></div>
      <div class="search__view-facets"></div>
      <div class="search__facets"></div>
      <div class="search__product-sort"></div>
      <div class="search__product-list"></div>
      <div class="search__pagination"></div>
    </div>
  `);

  const $resultInfo = fragment.querySelector('.search__result-info');
  const $viewFacets = fragment.querySelector('.search__view-facets');
  const $facets = fragment.querySelector('.search__facets');
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
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
    }).catch(() => {
      console.error('Error searching for products');
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
    }).catch((e) => {
      console.error('Error searching for products', e);
    });
  }

  const getAddToCartButton = (product) => {
    // Booking products always link to PDP for configuration
    if (isBookingProduct(product) || product.typename === 'ComplexProductView') {
      const button = document.createElement('div');
      UI.render(Button, {
        children: isBookingProduct(product)
          ? (labels.Booking?.BookNow ?? 'Book Now')
          : labels.Global?.AddProductToCart,
        icon: Icon({ source: isBookingProduct(product) ? 'Date' : 'Cart' }),
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
      routeProduct: (product) => getProductLink(product.urlKey, product.sku),
      slots: {
        ProductImage: (ctx) => {
          const { product, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = getProductLink(product.urlKey, product.sku);

          tryRenderAemAssetsImage(ctx, {
            alias: product.sku,
            imageProps: defaultImageProps,
            wrapper: anchorWrapper,
            params: {
              width: defaultImageProps.width,
              height: defaultImageProps.height,
            },
          });
        },
        ProductName: (ctx) => {
          const { product } = ctx;
          if (!isBookingProduct(product)) return;
          const metaEl = createEventMetaElement(product, labels);
          ctx.appendSibling(metaEl);
        },
        ProductActions: (ctx) => {
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'product-discovery-product-actions';
          // Add to Cart / Book Now Button
          const addToCartBtn = getAddToCartButton(ctx.product);
          addToCartBtn.className = 'product-discovery-product-actions__add-to-cart';
          // Wishlist Button (only for non-booking products)
          if (!isBookingProduct(ctx.product)) {
            const $wishlistToggle = document.createElement('div');
            $wishlistToggle.classList.add('product-discovery-product-actions__wishlist-toggle');
            wishlistRender.render(WishlistToggle, {
              product: ctx.product,
              variant: 'tertiary',
            })($wishlistToggle);
            actionsWrapper.appendChild(addToCartBtn);
            actionsWrapper.appendChild($wishlistToggle);
          } else {
            actionsWrapper.appendChild(addToCartBtn);
          }
          ctx.replaceWith(actionsWrapper);
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
