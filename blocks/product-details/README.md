# Product Details Block

## Overview

The Product Details block provides comprehensive product detail page functionality using multiple @dropins/storefront-pdp containers. It handles product display, configuration, cart operations, wishlist integration, and SEO optimization with dynamic mode switching between add and update operations.

For grouped event parent products with the Commerce `is_event_ticket` attribute, the
block preserves the standard Commerce PDP content but replaces ordinary add-to-cart
submission with an event-booking experience. The event experience loads allowlisted
metadata and allocation data using `external_event_id`, collects one attendee per
ticket, displays a live pre-cart ticket summary, creates or merges a booking intent,
adds the selected virtual child product, and then applies `booking_intent_ref` using
the SaaS `setCustomAttributesOnCartItem` mutation. Recurring bookings also store
the selected occurrence's local date, time range, timezone, and stable ID as
non-sensitive cart-item display attributes so cart and mini-cart can show the
actual selected session after refresh.

## Integration

<!-- ### Block Configuration

No block configuration is read via `readBlockConfig()`. The block uses dynamic product data and URL parameters. -->

### URL Parameters

- `itemUid` - Item UID for cart update mode (when present, enables update mode instead of add mode)
- `optionsUIDs` - Product option UIDs for wishlist context (empty string treated as base product with no options)

<!-- ### Local Storage

No localStorage keys are used by this block. -->

### Events

#### Event Listeners

- `events.on('pdp/valid', callback)` - Listens for product configuration validity changes to enable/disable add to cart button
- `events.on('pdp/data', callback)` - Listens for product data changes to refresh the event summary price/name
- `events.on('pdp/values', callback)` - Listens for product option value changes to update wishlist context
- `events.on('wishlist/alert', callback)` - Listens for wishlist action alerts to show notifications
- `events.on('cart/data', callback)` - Listens for cart data changes to determine update mode
- `events.on('aem/lcp', callback)` - Listens for AEM LCP event to set JSON-LD and meta tags

`ProductQuantity.onValue` is used for event quantity changes. No unverified custom
PDP event or slot is introduced.

<!-- #### Event Emitters

No events are emitted by this block. -->

## Behavior Patterns

### Page Context Detection

- **Add Mode**: When no itemUid in URL, operates in add-to-cart mode
- **Update Mode**: When itemUid in URL, operates in update-cart mode with different button text and behavior
- **Product Configuration**: Validates product options and enables/disables add to cart button accordingly
- **Wishlist Context**: Updates wishlist context based on current product configuration

### User Interaction Flows

1. **Initialization**: Block renders product gallery, header, price, options, quantity, and action buttons
2. **Product Configuration**: Users can select product options with real-time validation
3. **Add to Cart**: Users can add products to cart or update existing cart items
4. **Wishlist Management**: Users can add/remove products from wishlist
5. **Image Gallery**: Users can view product images in desktop thumbnail or mobile carousel format
6. **SEO Optimization**: Sets JSON-LD structured data and meta tags for search engines

### Event Booking Flow

1. Event mode is enabled only by the Commerce `is_event_ticket` attribute.
2. Booking is disabled when Event App configuration, `external_event_id`,
   enrichment, Commerce stock, or add-to-cart eligibility is unavailable.
3. Contact and attendee values stay in active form memory only.
4. The grouped parent displays one native allocation selector per active Space/Zone
   allocation; unavailable allocations are disabled.
5. Quantity is bounded by the selected allocation availability and the 20-ticket
   contract limit.
6. Recurring events load bounded occurrence availability for the selected
   allocation only; other allocations load on selection and reuse cached results.
   Booking requires a date, start time, and stable `occurrence_id`; one-time
   events retain the existing date/time metadata behavior.
7. A stable `source_request_id` is reused for a logical retry.
8. The create-intent request includes the selected child `commerce_sku`,
   `event_allocation_id`, and canonical `attendees`. A different request for the
   same active cart/event/child-SKU/allocation/occurrence is merged by Integration.
9. The matching child cart line is increased by the submitted quantity. A
   successful intent and exact cart item UID are retained in memory after a
   recoverable failure, so retry repairs the cart without replaying the merge.

Recurring additions fail closed when the selected child SKU already has a cart
line and the storefront cannot prove that line belongs to the selected
occurrence. Commerce currently exposes only the booking-intent correlation on
the cart line; an approved occurrence cart-item identity is required before
different occurrences can safely share one cart. Cart and mini-cart panels show
the exact persisted recurring occurrence when available. Older recurring lines
without that snapshot show the recurring date range, daily availability hours,
and session duration instead of guessing a selected session.
10. Event products do not use PDP cart-update mode; cart attendee editing remains
   gated on the separate replacement-intent contract.
11. Event details remain visible and the booking form is rendered in a native accordion
   below them. The accordion is expanded by default and moves between desktop/mobile
   event-detail mounts without duplicating form state.
12. The event-only quantity selector is rendered inside the booking form, starts at
    zero, is labeled “Number of attendees,” uses a compact right-aligned width, and keeps the incrementer border around
    all controls. Its value controls attendee count and the live ticket summary; Add
    to Cart remains disabled until at least one ticket is selected.
13. The event summary is a collapsible, expanded-by-default pre-cart preview showing
    ticket count, unit price, and total. It appears below the product description at
    every responsive breakpoint.
14. Consent and Add to Cart render below the Summary while remaining associated with
   the accordion form; the cart action includes the default cart icon and keeps the
   wishlist action beside it. Successful bookings close the accordion and render the
   localized success message below Summary, reset the PDP quantity to zero, and keep
   the message until dismissed.
15. Event galleries use full-width, uncropped media with dot navigation on desktop;
    standard product galleries retain desktop thumbnail navigation.

### Error Handling

- **Configuration Errors**: If product configuration is invalid, disables add to cart button
- **API Errors**: If cart operations fail, shows error alerts with dismiss functionality
- **Image Rendering Errors**: If product images fail to load, the image slots handle fallback behavior
- **JSON-LD Errors**: If structured data generation fails, falls back to basic meta tags
- **Fallback Behavior**: Always falls back to appropriate mode based on URL parameters and cart state
