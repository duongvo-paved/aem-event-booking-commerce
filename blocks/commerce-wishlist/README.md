# Commerce Wishlist Block

## Overview

The Commerce Wishlist block provides wishlist management functionality using the @dropins/storefront-wishlist Wishlist container. It handles product wishlist operations with authentication modal integration, product data fetching, and cart integration.

The page uses a “Saved events” heading and a live saved-item count. Cards match
the PLP's bordered layout, centered 8:5 cover images, navy titles and prices,
rectangular actions, and responsive three/two/one-column grid. Removal controls
sit over the images. The product configuration link is labeled “View event” and
continues to open the existing product detail route. Wishlist removal, cart
actions, sign-in, and empty-state behavior remain owned by the Commerce drop-in.

Saved event cards show the same compact schedule, venue/address, organizer, and
icons as the PLP. Product details are shared with the drop-in's product loaders,
and public event details are enriched in one batch per wishlist update. Loading
and unavailable states leave prices, navigation, and removal available. Enrichment
is omitted when the Event App is disabled; stale responses from earlier wishlist
updates are discarded.

## Integration

### Block Configuration

| Configuration Key | Type | Default | Description | Required | Side Effects |
|-------------------|------|---------|-------------|----------|--------------|
| `start-shopping-url` | string | `''` | URL for "Start Shopping" button when wishlist is empty | No | Sets destination for empty wishlist CTA |

<!-- ### URL Parameters

No URL parameters directly affect this block's behavior. -->

<!-- ### Local Storage

No localStorage keys are used by this block. -->

### Events

#### Event Listeners

- `events.on('wishlist/alert', callback)` - Listens for wishlist action alerts to scroll to top of page

<!-- #### Event Emitters

No events are emitted by this block. -->

## Behavior Patterns

### Page Context Detection

- **Authenticated Users**: When user is authenticated, provides full wishlist management functionality
- **Unauthenticated Users**: When user is not authenticated, provides full wishlist functionality and the possibility to sign-in.
- **Empty Wishlist**: When wishlist has no items, shows empty wishlist message with Start Shopping CTA and sign-in link for unauthenticated users.

### User Interaction Flows

1. **Initialization**: Block initializes wishlist renderer and sets up product data API endpoints
2. **Wishlist Display**: Renders wishlist items with product images and management options
3. **Authentication Flow**: When unauthenticated users sign-in through the modal, the page automatically reloads. Upon reload, the guest wishlist is preserved and merged with the authenticated user wishlist
4. **Product Management**: Users can add/remove products from wishlist and move items to cart
5. **Product Navigation**: Users can navigate to product detail pages
6. **Alert Handling**: Shows wishlist action alerts and scrolls to top of page

### Error Handling

- **API Errors**: If product data API fails, the Wishlist container handles error display
- **Configuration Errors**: If `readBlockConfig()` fails, uses default configuration values
- **Image Rendering Errors**: If product images fail to load, the image slots handle fallback behavior
- **Fallback Behavior**: Always falls back to default configuration values for missing or invalid settings
