# Product Details Block

## Overview

The Product Details block provides comprehensive product detail page functionality using multiple @dropins/storefront-pdp containers. It handles product display, configuration, cart operations, wishlist integration, and SEO optimization with dynamic mode switching between add and update operations.

For products with the Commerce `is_event_ticket` attribute, the block preserves the
standard Commerce PDP content but replaces ordinary add-to-cart submission with an
event-booking experience. The event experience loads allowlisted metadata using
`external_event_id`, collects one participant per ticket, displays a
Commerce-derived order summary, creates a booking intent, adds the product, and
then applies `booking_intent_ref` using the SaaS
`setCustomAttributesOnCartItem` mutation.

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
3. Contact and participant values stay in active form memory only.
4. A stable `source_request_id` is reused for a logical retry.
5. The active Commerce cart is checked before intent creation. A correlated SKU is
   blocked and links the shopper to the cart.
6. The create-intent request includes `commerce_cart_id` and `commerce_sku`; the
   Integration contract must reject a different request for the same active pair
   with HTTP `409`.
7. A successful intent and exact cart item UID are retained in memory after a
   recoverable failure, so retry repairs correlation without creating another
   intent or adding quantity again.
8. Event products do not use PDP cart-update mode; cart participant editing remains
   gated on the separate replacement-intent contract.

### Error Handling

- **Configuration Errors**: If product configuration is invalid, disables add to cart button
- **API Errors**: If cart operations fail, shows error alerts with dismiss functionality
- **Image Rendering Errors**: If product images fail to load, the image slots handle fallback behavior
- **JSON-LD Errors**: If structured data generation fails, falls back to basic meta tags
- **Fallback Behavior**: Always falls back to appropriate mode based on URL parameters and cart state
