# EDS Event Booking Storefront Implementation Plan

## Document Control

| Field | Value |
| --- | --- |
| Requirements | `scratch/REQUIREMENTS.md` version 0.6 |
| Approach | Phase 3 Option A — detailed implementation plan |
| Created | 2026-07-23 |
| Scope | EDS storefront only |
| Status | SaaS cart-correlation slice implemented; external gates remain |

## 1. Verified Implementation Baseline

The plan is based on the installed storefront packages and current repository code,
not on assumed drop-in interfaces.

- `product-list-page` already composes `SearchResults`, `Facets`, `SortBy`, and
  `Pagination`.
- Installed `SearchResults` slots include `ProductName`, `ProductPrice`,
  `ProductImage`, `ProductActions`, `NoResults`, `Header`, and `Footer`.
- `product-details` already uses the current composable PDP containers and receives
  product state through the verified `pdp/data`, `pdp/values`, and `pdp/valid`
  event flow.
- Installed `ProductQuantity` accepts `onValue(quantity)`.
- Installed cart APIs expose a shared authenticated `fetchGraphQl` transport.
- SaaS provides `setCustomAttributesOnCartItem`; arbitrary `customFields` are not
  valid unless the backend defines matching `CartItemInput` fields.
- Installed `CartSummaryList` includes `ItemQuantity`, `ProductAttributes`,
  `CartItem`, and `Footer` slots.
- The installed order model does not expose an approved event discriminator or
  order-item custom attributes.
- No existing block implements public booking lookup or ticket/QR rendering, so a
  new `event-ticket` block remains justified.

## 2. Contract Audit and Delivery Boundary

| Contract or dependency | Evidence | Phase 4 treatment |
| --- | --- | --- |
| Event listing/detail/create-intent endpoints | Runtime action source exists, but no approved versioned OpenAPI or deployed development/stage URL and CORS evidence exists | Build strict client/configuration boundaries and UI behavior; do not add guessed live endpoint values |
| Event DTO | Current Integration projection contains the required event fields, but checked-in implementation does not enforce the final non-null venue contract | Validate strictly in EDS and treat invalid enrichment as unavailable |
| Cart item correlation | SaaS exposes `setCustomAttributesOnCartItem` and copies item attributes to the order | Add normally, capture the new item UID, then set and verify `booking_intent_ref` |
| Duplicate intent | Browser checks cannot prevent concurrent tabs/devices | Require Integration uniqueness on active `(commerce_cart_id, commerce_sku)` and handle `409` without adding |
| Atomic cart edit | SaaS quantity update and custom-attribute update are separate mutations, and the Integration replacement-intent API is absent | Do not expose event edit UI; retain an explicit blocked adapter boundary |
| Order confirmation event detection | Installed order model lacks an approved event marker/custom attribute | Do not infer from names or URLs; defer event-specific confirmation copy |
| Public ticket lookup | Integration requirements define the target, but current action still exposes `intent_ref` and omits `qr_render_url` | Implement a strict allowlisting client and block states; keep live lookup disabled until approved configuration and contract evidence exist |
| Browser CORS | No allowlist or CORS response implementation was found | All Event API activation remains externally gated |

## 3. File-Level Plan

### 3.1 Shared Event App Modules

Create `scripts/event-app/`:

| File | Responsibility |
| --- | --- |
| `config.js` | Read environment configuration, validate HTTPS action URLs/methods, expose feature readiness without embedding Runtime URLs |
| `errors.js` | Define safe error categories and shopper-safe message mapping without response/body leakage |
| `models.js` | Extract Commerce attributes and strictly normalize event, intent, and public ticket projections |
| `validation.js` | Validate quantity, exact contact/participant fields, consent, participant count, and booking reference shape |
| `dates.js` | Format UTC instants with the supplied IANA timezone and preserve machine-readable values |
| `client.js` | Apply timeout/abort behavior, exact configured method/encoding, JSON content negotiation, response allowlisting, and bounded error mapping |
| `dom.js` | Small native-DOM helpers for labeled fields, live regions, metadata lists, and safe status rendering |

No module will persist PII, correlation identifiers, or ticket capability URLs.

### 3.2 Product Listing

Modify:

- `blocks/product-list-page/product-list-page.js`
- `blocks/product-list-page/product-list-page.css`
- `blocks/product-list-page/README.md`

Implementation:

1. Preserve the existing Commerce search request and result ordering.
2. Detect event products only from verified Commerce attributes.
3. Deduplicate the current page's `external_event_id` values.
4. Make one configured batch request after Commerce results arrive.
5. Join by event ID and render allowlisted metadata through a verified
   `ProductName` slot extension.
6. Preserve Commerce cards on invalid, missing, timed-out, or failed enrichment.
7. Do not implement page-local filters until the approved filter vocabulary and
   UX labels are available.

### 3.3 Product Detail and Booking

Modify:

- `blocks/product-details/product-details.js`
- `blocks/product-details/product-details.css`
- `blocks/product-details/README.md`

Create:

- `blocks/product-details/event-booking.js`

Implementation:

1. Detect event mode from Commerce `is_event_ticket`.
2. Validate `external_event_id` and request configured event detail.
3. Render event metadata as a supplemental region without replacing Commerce
   title, descriptions, category, price, media, options, or salability.
4. Use `ProductQuantity.onValue` as the event quantity source.
5. Render one participant row per quantity, exact booking contact fields,
   unchecked consent, and a Commerce-derived order summary.
6. Generate one `crypto.randomUUID()` request ID per logical submission.
7. Ensure an active cart, reject an existing correlated SKU, and call create-intent
   with `commerce_cart_id`, `commerce_sku`, and the stable request ID.
8. Add the product without arbitrary custom fields, capture the new item UID, and
   apply `booking_intent_ref` through `setCustomAttributesOnCartItem`.
9. Preserve the successful `intent_ref`, item UID, and operation stage only in
   active memory so retry repairs the existing operation without another intent or
   quantity increment; clear form PII after success.
10. Disable event booking when API configuration, metadata, or salability is not
   ready.

### 3.4 Cart

Modify only after both missing contracts pass:

- `blocks/commerce-cart/commerce-cart.js`
- `blocks/commerce-cart/commerce-cart.css`
- `blocks/commerce-cart/README.md`

Planned behavior:

- Detect event lines using an approved exposed cart attribute.
- Replace only the event `ItemQuantity` slot.
- Create a replacement intent first.
- Call `updateProductsFromCart` once with line UID, quantity, and new
  `booking_intent_ref`.
- Preserve all existing non-event cart behavior.

This slice is currently blocked and will not be approximated.

### 3.5 Checkout Success

Modify only after the order projection exposes an approved event discriminator:

- `blocks/commerce-checkout-success/commerce-checkout-success.js`
- `blocks/commerce-checkout-success/commerce-checkout-success.css`
- `blocks/commerce-checkout-success/README.md`

The standard confirmation remains unchanged until event lines can be identified
without inference.

### 3.6 Hosted Ticket Page

Create:

- `blocks/event-ticket/event-ticket.js`
- `blocks/event-ticket/event-ticket.css`
- `blocks/event-ticket/README.md`

Authoring model:

```text
| Event Ticket |
|--------------|
| Optional heading |
| Optional introductory text |
| Optional support link |
```

There is no second header row. Runtime URLs and booking references are never
authored. The block reads only `booking_ref` from the hosted-link URL, parses only
the approved public projection, renders QR images only from approved HTTPS origins,
and provides accessible pending/error/unavailable states.

Live lookup remains disabled until the ticket projection and CORS gates pass.

## 4. Verification Plan

### Static and Unit-Level

- Run `npm run lint`.
- Validate all changed CSS with the repository stylelint rules.
- Exercise DTO normalizers and validators with valid, missing, extra-field,
  malformed, and forbidden-field fixtures.
- Verify no Event App code writes to browser storage or logs request/response
  payloads.
- Verify generated drop-in files are unchanged.

### Contract

- Validate each configured action against the approved OpenAPI document.
- Verify request methods, parameter location/encoding, status codes, content types,
  timeout behavior, and strict response projections.
- Verify the SaaS `setCustomAttributesOnCartItem` mutation stores
  `booking_intent_ref` and that cart-to-order conversion preserves it.
- Verify same-request replay returns the existing intent and a different request
  for the same active cart/SKU receives `409`.

### Browser

- Use approved Commerce/event fixtures.
- Test listing/PDP partial-data and unavailable states.
- Test participant count, focus/error behavior, retry identity, and correlated
  add-to-cart.
- Test mobile, tablet, desktop, keyboard, 200% zoom, and reduced motion.
- Inspect URL, storage, console, network logs, markup, and analytics for PII or
  opaque-reference leakage.
- Test hosted-ticket pending/active/invalidated/not-found flows only after the
  ticket contract is deployed.

## 5. Completion Rule

Phase 4 can be marked fully complete only when all Must Have storefront slices are
implemented and statically verified. Browser testing remains the explicit Phase
4.5 decision. External blockers do not permit placeholder backend behavior or
unsafe contract inference; any incomplete blocked slice must remain documented.

## 6. Phase 4 Implementation Status

### Implemented

- Shared HTTPS-only Event App configuration and action client.
- Strict event, intent, booking, ticket, and QR URL response normalization.
- Exact booking-form validation and timezone-aware event formatting.
- Commerce-first PLP page enrichment with one batch request and safe fallback.
- Event PLP actions route to the PDP instead of bypassing intent creation.
- Event PDP metadata, participant form, Commerce-derived order summary,
  create-intent flow, safe retry identity, and correlated add-to-cart call.
- New `event-ticket` block, authoring model, responsive styling, invalid/disabled
  states, strict public projection, and QR origin/referrer protection.
- Event App tests, full repository lint, component-model build, and browser smoke
  testing of hosted-ticket safe states.

### Feature-Gated

- Listing/PDP/create-intent calls remain inactive until environment configuration
  is populated from the approved OpenAPI and browser CORS evidence.
- Hosted ticket lookup remains inactive until Integration deploys the approved
  projection and QR URL behavior.

### Blocked

- Commerce event listing filter/operator and fixture verification.
- Deployed SaaS `booking_intent_ref` and cart-to-order propagation contract test.
- Integration transactional uniqueness for active `(commerce_cart_id, commerce_sku)`.
- Event cart quantity/participant editing because no replacement-intent API exists.
- Event-specific checkout-success guidance because the installed order projection
  exposes no approved event discriminator.
- Deployed development/stage browser E2E and performance verification.

Phase 4 is therefore partially implemented but not complete.
