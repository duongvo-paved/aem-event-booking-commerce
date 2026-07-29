# Event App Phase 4 Verification Report

## Date

2026-07-28

## Automated Verification

- `npm run test:event-app`: passed; 5 test files, 0 failures.
- `npm run lint`: passed JavaScript ESLint and CSS stylelint.
- `npm run build:json`: passed and generated the event-ticket component model.
- `git diff --check`: passed.
- Generated files under `scripts/__dropins__/`: unchanged.

## Browser Smoke Test

Environment:

- Local AEM development server
- Headless Google Chrome
- Test page: `drafts/agents/event-ticket-test.html`
- Desktop viewport: 1280 × 900
- Mobile viewport: 390 × 844

Verified:

- The `event-ticket` decorator loaded successfully.
- Authored heading, introduction, and support content were preserved.
- A valid-shaped `booking_ref` with disabled Event App configuration rendered the
  safe “Ticket lookup is not available right now” state.
- A missing `booking_ref` rendered the non-sensitive invalid-link state.
- The block was responsive at desktop and mobile widths.
- Status messages used alert/live-region semantics.
- No live Event App request was attempted while configuration was disabled.

Not yet testable:

- Deployed listing/PDP enrichment.
- Create-intent and correlated Commerce add-to-cart.
- Event cart editing.
- Event-specific checkout-success guidance.
- Active/pending/invalidated hosted-ticket projections and QR rendering.

These require the external contracts and fixtures listed in
`scratch/REQUIREMENTS.md` Section 13.

---

## Connected Backend Retest

### Date

2026-07-28

### Phase

Historical PaaS baseline — superseded by the SaaS implementation below.

### Environment

- Storefront: `http://localhost:3000`
- Commerce offering: Adobe Commerce PaaS
- Commerce endpoint: configured sandbox endpoint from `config.json`
- Browser: Google Chrome 150, native headless mode
- Desktop viewport: 1440 × 900
- Mobile viewport: 390 × 844

### Results

#### Passed

- Event-domain unit tests: 3 test files passed.
- Commerce storefront initialization requests returned HTTP 200.
- Product Search request for `event` returned HTTP 200.
- Ticket block safely rejected live lookup because Event App Runtime actions are
  not configured.
- Ticket fallback rendered as a visible `role="alert"` with
  `aria-busy="false"`.
- Ticket fallback rendered at desktop and mobile sizes.
- Mobile document width matched the viewport width (no horizontal document
  overflow).
- No browser console errors or uncaught page exceptions were observed.

#### Blocked / Not Executable

- The connected catalog returned zero products for the search phrase `event`.
- `config.json` does not contain an enabled `event-app` object or Runtime action
  URLs.
- No real event PDP could be discovered from rendered product links.
- Event metadata enrichment, booking form submission, `create-intent`,
  correlated `addProductsToCart`, cart-line `booking_intent_ref`, and successful
  ticket/QR lookup could not be tested.

### Evidence

- `scratch/test-results/event-ticket-runtime-unavailable-desktop.png`
- `scratch/test-results/event-ticket-runtime-unavailable-mobile.png`
- Browser runner: `test/browser/event-dropin-smoke.mjs`

### Conclusion

Historical partial pass. The Commerce connection and safe disabled-state behavior work, but
the event drop-in is not active end to end. Live testing requires:

1. At least one indexed, visible event product with `is_event_ticket` and
   `external_event_id`.
2. An approved, enabled `event-app` configuration for `enrich`, `detail`,
   `create-intent`, and `ticket-get`.
3. A valid event fixture and a public booking fixture for success-path testing.

---

## SaaS Cart-Correlation Verification

### Date

2026-07-28

### Scope

The SaaS storefront implementation for event add-to-cart correlation, retry
reconciliation, and duplicate prevention.

### Automated Results

- `npm run test:event-app`: passed; 5 test files, 0 failures.
- `npm run lint`: passed JavaScript ESLint and CSS stylelint.
- `test/event-app/cart.test.mjs` passed these state-machine scenarios:
  - one intent, one add, and one correlation mutation for a new booking;
  - an existing correlated SKU is blocked before intent creation;
  - an existing uncorrelated SKU is blocked as an integrity error;
  - retry repairs an uncorrelated line without another intent or add;
  - a retryable correlation failure retains the exact item UID;
  - a definitive correlation failure removes the exact item UID;
  - ambiguous duplicate SKU lines fail closed.
- `test/event-app/client.test.mjs` verified that Integration HTTP `409` maps to
  the duplicate-booking state.

### Browser Results

Google Chrome 150, native headless mode:

- Duplicate submission rendered
  “This event is already being booked in your cart” with a `/cart` link.
- The duplicate path invoked the booking callback exactly once and retained all
  entered form values.
- A retryable failure retained form values.
- Manual retry reused the same `source_request_id`, invoked the callback twice
  total, rendered success, and cleared the form only after success.
- Feedback retained `role="status"` and `aria-live="assertive"`.
- All form controls had associated labels.
- Desktop 1440 × 900 and mobile 390 × 844 rendered successfully.
- Mobile document width equaled viewport width.

Evidence:

- `test/browser/event-booking-saas-smoke.mjs`
- `scratch/test-results/event-booking-saas-duplicate-desktop.png`
- `scratch/test-results/event-booking-saas-retry-mobile.png`

### Connected SaaS Sandbox Result

- Commerce initialization, Product Search, and PDP GraphQL requests returned
  HTTP 200.
- Product Search returned the `test-event` event product and its enrichment.
- The discovered local PDP route did not render the booking form, so the test did
  not create a real booking intent or mutate a real cart.

### External Gates

- The Integration service must implement and contract-test transactional
  uniqueness for active `(commerce_cart_id, commerce_sku)` pairs:
  same `source_request_id` returns the original intent; a different request
  returns `409 BOOKING_ALREADY_EXISTS`.
- The target SaaS tenant still needs a controlled end-to-end contract test proving
  `setCustomAttributesOnCartItem` accepts `booking_intent_ref` and copies it to the
  order item.
- Event cart editing and a cart-level orphan-line checkout guard remain blocked
  until an approved event-line discriminator and SaaS compensating-transaction
  design are available.

---

## Cart Booking Display Verification

### Date

2026-07-29

### Automated Results

- `npm run test:event-app`: passed; 6 test files, 0 failures.
- `npm run lint`: passed JavaScript ESLint and CSS stylelint.
- `test/event-app/cart-display.test.mjs` verified strict UID joins, batched and
  deduplicated event enrichment, surface-specific content, all correlation and
  enrichment fallbacks, privacy-safe text, shared in-flight requests, and stale
  response suppression.

### Browser Results

Headless Google Chrome against the local AEM development server:

- Full cart showed linked status, event-timezone schedule, venue, organizer, and
  Commerce ticket quantity.
- Mini-cart showed linked status, schedule, venue, and quantity while omitting
  organizer.
- Missing-correlation and temporary-unavailable states rendered with the expected
  alert/status semantics.
- Non-event product attributes produced no booking panel.
- Both presenters shared one Commerce correlation request and one Event App
  enrichment batch.
- No opaque intent reference, contact data, or participant data appeared in
  rendered text.
- Desktop 1440 × 900 and mobile 390 × 844 had no horizontal overflow.
- The accessibility tree exposed booking headings, live statuses, and the
  missing-correlation alert.
- No feature console errors or uncaught page exceptions were observed.

Evidence:

- `test/browser/cart-booking-display-smoke.mjs`
- `scratch/test-results/cart-booking-display-desktop.png`
- `scratch/test-results/cart-booking-display-mobile.png`

### Connected SaaS Limitation

A real mixed cart with a correlated event line was not available in the connected
tenant during this run. Real removal, quantity, wishlist, checkout-link, and
order-copy behavior therefore still requires the controlled connected SaaS smoke
fixture described in the existing external gates.
