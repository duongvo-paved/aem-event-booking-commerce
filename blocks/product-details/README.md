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

### Booking panel presentation

Event quantity, space/session choice, booking contact, attendee names, consent,
ticket summary and Add to cart are collected in one panel. Contact, attendees and
consent appear after quantity becomes positive. Existing booking validation and
Commerce salability remain authoritative; this UI does not introduce ticket types
or remove contract-required fields.

The selected allocation/session shows “Few tickets left” when its supplied
available quantity is between 1 and 5. Unknown/loading/error availability does
not show a low-stock claim. The threshold is a presentation default, not a limit
on tickets or an inventory calculation.

After a successful paid add, a white success card replaces the booking header and
form, with a green check, pale-grey booked-event summary, attendee names, ticket
subtotal and checkout/cart/browse links. This state exists only for the current
page visit and excludes contact details and internal booking references. The
payment reminder remains explicit. Book more tickets restores the reset form;
failures retain the form for retry.

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

Paid events use native allocation-row steppers and synchronize quantity with the
PDP configuration. Free events retain `ProductQuantity.onValue`. No custom PDP
event or slot is introduced.

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
11. Paid bookings use one always-open panel; free events retain the native
    accordion. One form is shared across desktop, tablet and mobile layouts.
12. Paid allocation rows display the actual Space/Zone name, exact child price,
    known low-stock warning and a native quantity stepper. Only the selected
    allocation can have a nonzero quantity. Changing allocation resets quantity and
    attendee drafts while retaining contact details.
13. The zero-ticket footer displays a prompt and disabled button. Selecting tickets
    reveals one Ticket card per attendee under Who’s going, then required contact
    fields and the non-collapsible ticket subtotal, consent and cart action.
14. The panel date subtitle follows the selected recurring session, even before
    choosing a space. Success
    replaces the header/form, snapshots the booked child price and occurrence,
    and provides checkout, cart, browse and Book more tickets actions.
15. Event galleries use full-width, uncropped media with dot navigation on desktop;
    standard product galleries retain desktop thumbnail navigation.

### Error Handling

- **Configuration Errors**: If product configuration is invalid, disables add to cart button
- **API Errors**: If cart operations fail, shows error alerts with dismiss functionality
- **Image Rendering Errors**: If product images fail to load, the image slots handle fallback behavior
- **JSON-LD Errors**: If structured data generation fails, falls back to basic meta tags
- **Fallback Behavior**: Always falls back to appropriate mode based on URL parameters and cart state

### Paid event prototype presentation

Event products with a positive final Commerce price use a wide information column
and narrower, always-open **Book tickets** panel. Event information follows the
DOM order: title, local date/time and venue address, gallery (with Save), booking,
descriptions and attributes, then Event details. On desktop the booking panel
occupies the second column. Free events share this information layout and retain
their booking accordion; ordinary products keep their existing presentation.

The paid form starts at zero tickets. Its native row steppers display zero for
inactive allocations and enforce the current session/inventory limit for the
selected allocation. Attendees, booking contact and explicit consent appear after
quantity selection. Attendee drafts survive quantity decreases
and increases; allocation/session changes reset them. Child products are loaded in
one `getProductsData` batch, and only the currently selected allocation's price is
used for its ticket row and subtotal. Loading, missing or failed pricing disables
submission. Stale selections cannot overwrite the current price.

The non-collapsible ticket subtotal states that the final total is shown at
checkout. On sufficiently tall desktop screens, the panel scrolls internally and
its summary/actions remain sticky; smaller screens retain normal document flow.
Focus scrolls fields into view above the footer. No fees, tax or payable grand
total are estimated.

Success replaces the form with the booked event, allocation/session, attendee
names and ticket subtotal, plus the payment reminder and checkout/cart/browse
links. **Book more tickets** restores the zero-ticket form. The success snapshot
and attendee/contact data stay in page memory; failures retain entered values.
Intent schemas, request identifiers, cart correlation and retry recovery are
unchanged.

Verification: `node test/browser/paid-event-smoke.mjs` uses the local server on
port 3000 and Chrome debugging on port 9222. It covers deterministic booking
states and the real PDP decorator/batch API with read-only mocked responses.

### Event breadcrumbs

Breadcrumb typography, slash separators and spacing follow the prototype. Category
labels and destinations come from Commerce `products.categories` (`name`, `slug`,
`level`, and `parents`), queried for the parent PDP SKU. The installed PDP model
omits this context, so a small asynchronous query loads it without blocking the
booking form. Category slugs become localized storefront paths via `rootLink`.
For multiple assignments, the deepest category is used, with slug order as a stable
tie-breaker; its parents are shown in hierarchy order. Missing or failed category
responses leave **Home / Event title**. No category label or route is hardcoded.

Event page breadcrumbs have 24px of space below the site header. The title uses
the ProductHeader `hideSku` prop; the parent Commerce SKU appears as **Event code**
in Event details. The details section follows the prototype's borderless heading
and ruled definition rows (date/time, combined venue/address, available age and
organiser, event code, and available tags). Unsupported prototype fields such as
gates-open information are omitted.

The summary under the title uses the prototype's blue calendar/location icons,
17px text and wrapping fact layout. Dates use full local calendar names and compact
lowercase times, collapsing repeated dates for single-day events. Recurring events
retain their actual calendar bounds and available local hours. The venue summary
uses backend venue name and city; the full address and timezone remain in Event
details.

Grouped child pricing also handles Catalog Service returning HTTP 200 with no
products for direct child-SKU lookups. The pricing batch includes the parent SKU
and requests raw results (`getProductsData(items, true)`) to preserve its option
products. A direct child price is preferred; otherwise the selected allocation's
exact child SKU is matched in the parent's option values. The parent's aggregate
price range is never used as a ticket price. Missing child pricing still disables
submission. Rejected pricing requests can be retried on allocation selection.

Ticket details display a skeleton inside the booking panel during the Event App
request; ticket pricing has its own loading placeholder.

Paid recurring events use a calendar-first flow: choose Date, then Start time,
then an available Space/Zone and quantity. Nothing is selected automatically.
The calendar starts at today in the event timezone or the recurrence start date,
whichever is later, and ends at the recurrence end date. Excluded dates and
unscheduled weekdays do not trigger availability requests.

Each date requests `getAvailability(eventId, { from: date, to: date })` across all
spaces. Future occurrences with positive capacity are grouped by their UTC start
and end interval for the time choices. Selecting a space resolves that interval
back to its exact backend occurrence ID and capacity; no shared session ID is
submitted. Spaces absent from that session are hidden. Child Commerce pricing
continues to determine the ticket price and subtotal.

Date/time changes reset the space, quantity, attendee drafts and pending request
identifiers while retaining booking contact fields. In-flight date requests are
shared, late responses are ignored, and revisiting a date fetches fresh inventory.
Loading, empty and failure states keep submission disabled; failures offer
**Retry loading times**. The renderer receives `onDateChange` and
`onSessionChange` callbacks and accepts results through `setSessionAvailability`.
Free recurring events retain their allocation-first selectors and existing
availability methods. One-time events retain their existing booking flow.



### Prototype booking states

The paid panel has a compact date/start-time subtitle and a Choose your tickets
section. Backend allocation names replace prototype-only ticket types. Ticket
cards under Who’s going use 46px inputs and keep names when quantity decreases and
increases within the same allocation/session. Contact and consent remain explicit.
The zero-ticket footer omits checkout notes and totals; the selected state shows
only the authoritative ticket subtotal, with the final total deferred to checkout.
No fee, GST, eligibility note or unverified support number is introduced.

Success uses a white card, green check and grey summary box; checkout is the primary
action, cart is outlined, and browse/Book more tickets are text actions. Its snapshot
is captured before the form resets. Screenshots of all three states are produced
by the paid-event browser regression in scratch/test-results/paid-event/.
