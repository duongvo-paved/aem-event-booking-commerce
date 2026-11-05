# Product List Page Block

## Overview

The Product List Page block powers search and category listing pages using the storefront-product-discovery dropin. It renders faceted search results with sort, filters, pagination, product cards (with add-to-cart and wishlist), and keeps the URL in sync with search state. The block supports two modes: **search page** (full-text search with optional filters) and **category page** (products in a category, optionally filtered).

Products whose Commerce attributes include `is_event_ticket` and
`external_event_id` are enriched through the configured Event App client. One
batch request is made for the current Commerce page, results are joined by event
ID, and Commerce ordering is preserved. Enrichment failures leave the Commerce
cards available. Event cards show a skeleton only in the event metadata area while
enrichment is pending. The skeleton is replaced by schedule, venue, and organizer
details on success, or the existing unavailable message if details cannot be
loaded. It is omitted when Event App enrichment is disabled. Event products
always route to the PDP instead of adding directly to cart because attendee data,
allocation selection, and booking-intent creation are required first.

The listing uses a bordered filter sidebar with a Filter heading.
Applied filters appear as removable chips above the results toolbar, with a
clear action that preserves the category, stock, and visibility constraints;
removing one chip preserves the remaining selections. Filters remain available
when the search has no results. The toolbar shows the current result range and
the existing Commerce sort choices. Cards use three columns on large screens,
two on tablets, and one on phones, with wishlist controls over their images.
Confirmed zero-price event products display a FREE badge and “Free” price text;
a range starting at zero but ending above zero retains its Commerce price range.
Missing product images leave a neutral image area. No additional authoring
configuration is required.

Card schedules use compact dates such as `Sat 12 Sep, 5:00pm – 10:00pm`.
Multi-day and recurring events show calendar bounds such as
`Tue 15 Sep – Sat 26 Sep`. Times are calculated in the event timezone without
printing the timezone label; years are included when a range crosses years.

## Configuration Options

Date presets are not displayed because the current Live Search setup does not
support the required event-date filtering. Legacy `event_date` URL filters are
discarded so saved preset URLs can still load the normal listing. Standard Live
Search facets, sorting and pagination remain available.

Block configuration is read via `readBlockConfig(block)`.

| Option   | Effect |
|----------|--------|
| `urlpath` | When set, the block runs in **category page** mode: it filters by `categoryPath` and shows all products in that category. When absent, the block runs in **search page** mode and uses the `q` URL parameter as the search phrase. The value is also stored on the block as `data-urlpath` for use by other blocks (e.g. enrichment). |
| `pageSize` | Number of products per page. Defaults to `9` if not set or invalid. |

## Integration

### URL Parameters

Search state is read from and written to the URL by this project (see `search-url.js`). The dropin does not parse the URL.

| Parameter | Description |
|-----------|-------------|
| `q`       | Search phrase (search page only). |
| `page`    | Current page number (1-based). |
| `sort`    | Sort spec: comma-separated `attribute_DIRECTION` (e.g. `price_ASC,name_DESC`). |
| `filter`  | Filters: pipe-separated segments. Each segment is `attribute:value`; multiple values for the same attribute use multiple segments (e.g. `categories:val1\|categories:val2`). Supports `in` (single/multi-value) and numeric `range` (e.g. `price:0-100`). |

The storefront-owned `inStock`, `visibility`, and `categoryPath` constraints are
not accepted from or written to the URL. Shopper-visible filters cannot override
these constraints.

On load, the block normalizes the URL (e.g. filter format) with `replaceState`. After each search result, it updates the URL with `pushState` so the address bar reflects the current request.

### Events

#### Event Listeners

- `events.on('search/result', callback, { eager: true })` – Runs before the block re-renders. Updates the current request, applied-filter chips, clear actions, empty-state class, result range, and the facets button’s filter count.
- `events.on('search/result', callback, { eager: false })` – Runs after the block is rendered. Writes the search request (phrase, page, sort, filter) to the URL and calls `history.pushState`.

The block does not emit events; it calls the dropin’s `search()` API and reacts to `search/result`.

### Local Storage

This block does not use localStorage.

### Event App Configuration

The block does not accept authored endpoint configuration. Event actions must be
provided through the environment-level `event-app` configuration and remain
disabled until the versioned API and browser CORS gates are approved.

## Behavior Patterns

### Page Modes

- **Category page** (`config.urlpath` set): Initial search uses an empty phrase, `categoryPath` filter, visibility filter, and any sort/filter from the URL. Products are scoped to the category.
- **Search page** (no `urlpath`): Initial search uses `q` as the phrase, visibility filter, and sort/filter from the URL.

A visibility filter `{ attribute: 'visibility', in: ['Search', 'Catalog, Search'] }`
and stock filter `{ attribute: 'inStock', eq: 'true' }` are always added to the
request. These filters are not persisted in the URL or included in the visible
filter count. Product Discovery applies them server-side so result totals, facets,
sorting, and pagination remain consistent with the products shown.

### User Interaction Flows

1. **Initial load**: Block reads URL via `getSearchStateFromUrl`, normalizes the URL, then calls `search()` with phrase, page, sort, and filter (including visibility and, on category pages, categoryPath).
2. **Sort change**: User changes sort via SortBy; dropin calls `search()` with updated sort; block receives `search/result` and updates the URL.
3. **Filter change**: User toggles facets; dropin calls `search()` with updated filter; block updates result count and URL.
4. **Pagination**: User changes page; dropin calls `search()` with new page; block scrolls to top and URL is updated.
5. **Add to cart / wishlist**: Product cards include add-to-cart and wishlist actions; cart and wishlist behavior are handled by their respective dropins.
6. **Event metadata enrichment**: Event cards show a metadata-only skeleton while the page's batch Event App request is pending. The skeleton is replaced with details or an unavailable message after the request completes.

### Error Handling

- **Search API errors**: Initial `search()` calls are wrapped in `.catch()`; errors are logged with `console.error('Error searching for products', error)`. Event enrichment exceptions are also logged with `console.error('Error enriching event products', error)` before the unavailable metadata state is rendered. The block does not show an inline search error UI; the dropin may show its own state.
- **Missing payload**: Result count and filter-count updates guard with `payload.result?.totalCount`, `payload.request?.phrase`, and `payload.request.filter.length` where appropriate.
