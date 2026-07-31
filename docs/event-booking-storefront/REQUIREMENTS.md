# EDS Event Booking Storefront Requirements

<!--
  Scope: Adobe Commerce Storefront on AEM Edge Delivery Services only.
  Backend App Builder implementation remains owned by the Integration Starter Kit repository.
-->

## Document Control

| Field | Value |
| --- | --- |
| Version | 0.6 |
| Status | Phase 4 partial implementation — external contract gates open |
| Last updated | 2026-07-28 |
| Target storefront | AEM Edge Delivery Services Commerce Boilerplate |
| Commerce offering | Adobe Commerce as a Cloud Service (SaaS) |
| Backend dependency | Event Booking Integration Starter Kit |
| Product owner | TBD |
| Technical owner | TBD |

## 1. Purpose

Define the storefront requirements for an event-booking proof of concept in which AEM Edge Delivery Services (EDS):

1. Uses Adobe Commerce as the authoritative catalog, price, inventory, cart, checkout, and order system.
2. Enriches Commerce event products with event-domain metadata from public App Builder Runtime APIs.
3. Collects booking contact and participant information before adding an event product to the Commerce cart.
4. Carries the backend-issued `intent_ref` on the applicable Commerce cart item as `booking_intent_ref`.
5. Uses standard Commerce checkout and sandbox payment methods without checkout or payment customization.
6. Presents order confirmation and, where supported by the backend contract, booking and ticket status.

This document specifies EDS behavior and its API contracts. It does not authorize changes to the Integration Starter Kit backend, Commerce modules, Checkout Starter Kit, or Adobe Commerce Admin.

## 2. Source Requirements and Precedence

This document was derived from:

1. `docs/README.md` in this storefront repository, which defines the overall event-booking POC.
2. `/home/duongvo/Projects/paved-prj-ab-event-app-integration/REQUIREMENTS.md` version 1.5, which defines Integration Starter Kit ownership and the cross-system contracts.
3. The integration repository's current `ARCHITECTURE.md`, action configuration, public action source, and response projections.
4. Existing storefront PLP, PDP, cart, checkout, checkout-success, account/order blocks, drop-in initializers, and installed TypeScript declarations.

If sources disagree, use the following precedence:

1. Approved cross-repository business and system requirements.
2. Approved, versioned API contracts such as OpenAPI specifications and shared DTO schemas.
3. Deployed Runtime manifests and passing contract-test evidence for the target environment.
4. Current implementation source as evidence of existing behavior only.

Implementation behavior does not override an approved requirement or contract. Any mismatch must be recorded as contract drift and resolved by either:

- changing the implementation to conform to the approved contract; or
- approving and versioning a requirements/contract change before the storefront depends on it.

Until the mismatch is resolved, affected storefront functionality remains blocked from implementation approval and deployment.

## 3. Scope

### 3.1 In Scope

- Event discovery through Commerce-driven listing/search/category results.
- Commerce event-listing selection and filtering using `is_event_ticket`, `event_type`, `event_status`, and `event_date`.
- Event cards with image, short description, organizer, price, category, date, and location where data is available.
- Event filtering by Commerce-owned fields and page-local filtering by event-owned fields for the POC.
- Event detail with Commerce-owned category and long description plus event enrichment for schedule, venue, organizer, age requirement, and tags.
- Ticket quantity selection subject to Commerce salability, the configured Commerce per-order limit, and the provisional current backend action limit of 20.
- Booking contact and participant form with one participant per ticket.
- An order summary shown with the participant form before booking-intent submission.
- Consent capture required by the booking-intent API.
- Booking-intent creation through the public App Builder action.
- Adding a virtual event product to the Commerce cart with the returned correlation reference.
- Standard cart, standard Commerce checkout, and preconfigured sandbox payment methods.
- Order confirmation with ticket-processing guidance.
- EDS-hosted booking/ticket-status page reached using only a high-entropy `booking_ref`.
- Loading, empty, partial-data, validation, retry, and unavailable-event states.
- Responsive behavior, accessibility, analytics, privacy, security, and browser testing.

### 3.2 Out of Scope

- Recurring events, generated occurrences, multi-session selection, or seat selection.
- Independent event capacity or price calculation in EDS or App Builder.
- Checkout flow, payment method, shipping, or tax customization.
- Backend Runtime actions, Commerce event subscriptions, ticket generation, QR signing, SendGrid delivery, database schema, retention jobs, or App Builder deployment.
- Event administration UI or Checkout Starter Kit Admin actions.
- Map display, map-provider integration, and interactive map embedding.
- Refunds, ticket reassignment, ticket regeneration, or ticket transfer.
- Production approval of the public unauthenticated API model.

## 4. Target Architecture and Ownership

### 4.1 System Ownership

| Domain | Authority | EDS responsibility |
| --- | --- | --- |
| Product selection, search, category, pagination, sorting | Adobe Commerce | Request and preserve Commerce results and order. |
| Product name, descriptions, media, URL, status, visibility | Adobe Commerce | Render through existing product-discovery/PDP patterns. |
| Price and currency | Adobe Commerce | Display Commerce values only. |
| Inventory, capacity, maximum sale quantity, salability | Adobe Commerce | Treat Commerce result as final before add-to-cart and checkout. |
| `is_event_ticket`, `event_type`, `event_status`, `event_date` | Adobe Commerce product attributes | Define and filter the event-product listing. |
| `external_event_id` | Adobe Commerce product attribute | Join a Commerce event product to App Builder event metadata. |
| Schedule, timezone, organizer, venue, age requirement, tags | App Builder Database via Event API | Fetch and render allowlisted enrichment data; map data is not rendered for this POC. |
| Contact, participants, consent, booking intent | App Builder Database via create-intent API | Collect, validate, submit, and avoid local persistence. |
| Cart and checkout | Adobe Commerce | Use installed cart/checkout drop-ins. |
| Ticket generation, validity, email delivery | Integration backend | Render only approved public status or hosted-ticket information. |

Commerce category, product name, short description, and long description remain authoritative wherever event enrichment is rendered. App Builder event responses may supply only the allowlisted event-domain fields in the approved public DTO and must not overwrite or compete with those Commerce fields.

### 4.2 Commerce-First Composition Rule

EDS must fetch Commerce before App Builder for listings and PDPs. App Builder may enrich only products returned by Commerce and must never add or reorder products. A missing enrichment record must not turn a non-event product into an event or override Commerce salability.

### 4.3 Event Product Model

- One one-time event maps to one enabled virtual Commerce product.
- `is_event_ticket` must be `Yes` for event products.
- `external_event_id` must equal the immutable App Builder `event_id`.
- SKU and `external_event_id` are immutable correlation identifiers.
- Managed Commerce inventory represents event capacity.
- Backorders are disabled unless separately approved.
- The Commerce catalog response consumed by EDS must expose `is_event_ticket` and `external_event_id` without rendering them as shopper-facing attributes.
- The Commerce catalog/search response used for event discovery must also expose filterable `event_type`, `event_status`, and `event_date` attributes.

## 5. Users and Primary Journeys

### 5.1 Personas

- Anonymous shopper discovering and booking an event.
- Authenticated customer using the same booking flow.
- Ticket holder opening a hosted ticket link received by email.
- Support/operator diagnosing a failed or pending booking without exposing participant PII in the browser.

### 5.2 Happy Path

1. Shopper opens an event listing.
2. EDS obtains a Commerce product page filtered to event products.
3. EDS batch-enriches that page by `external_event_id` and renders joined cards in Commerce order.
4. Shopper opens a Commerce PDP.
5. EDS detail-enriches the event and renders event-specific information.
6. Shopper chooses a quantity that Commerce reports as salable.
7. Shopper enters booking contact, one participant per ticket, and required consent.
8. EDS shows an order summary using Commerce price and product data plus the selected event schedule and quantity.
9. EDS creates a booking intent using a stable client-generated `source_request_id`.
10. EDS adds the Commerce virtual product to cart with matching quantity and `booking_intent_ref` equal to the returned `intent_ref`.
11. Shopper reviews the cart and completes the standard Commerce checkout.
12. EDS renders standard Commerce order confirmation with non-blocking asynchronous ticket-processing guidance.
13. Integration correlates the order after invoice creation, generates tickets, and emails the hosted ticket link to the Commerce order email.
14. Ticket holder opens the EDS-hosted ticket page using only `booking_ref` and sees allowlisted booking status, ticket status, and backend-rendered QR images.

## 6. Storefront Functional Requirements

### EDS-FR-1: Event Product Discovery

**Priority:** Must Have

EDS must use the existing product-discovery flow as the primary event listing source.

Acceptance criteria:

- [ ] Commerce limits the result set to products with `is_event_ticket = true`.
- [ ] Commerce exposes `event_type`, `event_status`, and `event_date` as the approved event-listing filter attributes.
- [ ] The exact attribute types, option values, date format, filter operators, and indexed/faceted behavior are verified against the target Commerce schema before implementation approval.
- [ ] Commerce owns search, base filters, price filters, sorting, pagination, product URLs, media, and salability.
- [ ] EDS extracts non-empty `external_event_id` values from the current Commerce page and deduplicates them.
- [ ] Under the provisional current Runtime contract, EDS sends at most 100 identifiers per enrichment request; the final bound must come from the approved versioned API contract.
- [ ] EDS joins enrichment by key rather than response position and preserves Commerce result ordering.
- [ ] App Builder records absent from the Commerce response are never added to the page.
- [ ] Missing enrichment renders the approved fallback and does not remove or reorder the Commerce product.
- [ ] Cards can display Commerce image, name, short description, price, currency, and category plus App Builder organizer, date/time, and location.
- [ ] Empty Commerce results render an accessible empty state.
- [ ] Commerce and enrichment errors are distinguishable and provide an accessible retry path where retry is safe.

### EDS-FR-2: Event Filters

**Priority:** Must Have

Acceptance criteria:

- [ ] Category, price, `event_type`, `event_status`, and `event_date` filters use Commerce-owned fields and supported Commerce filter/facet behavior.
- [ ] Location/venue, organizer, tag, and age filters may operate only on the enriched Commerce page for the POC.
- [ ] `event_date` is a Commerce-owned discovery/filter field; the App Builder UTC schedule and timezone remain authoritative for displayed event timing.
- [ ] Page-local event filters clearly avoid claiming globally accurate counts when applied after Commerce pagination.
- [ ] Event-owned filters do not add products, reorder the unfiltered Commerce result, or alter Commerce facet counts.
- [ ] Filter state is represented in the URL using the existing PLP URL-state convention where feasible.
- [ ] A production solution requiring globally correct event-domain facets is deferred to an approved Commerce attribute or composed-index design.

### EDS-FR-3: Event Detail

**Priority:** Must Have

Acceptance criteria:

- [ ] PDP product identity, title, descriptions, media, price, currency, product options, and salability come from Commerce.
- [ ] EDS reads `external_event_id` from the Commerce PDP response and requests one matching Event API detail record.
- [ ] Commerce remains authoritative for the product title, category, short description, and long description.
- [ ] The page renders organizer, UTC schedule converted using the supplied source timezone, venue information, age requirement, tags, and other approved event-domain metadata when supplied.
- [ ] `venue` is a non-null object containing required, non-null, non-empty string fields `name` and `address`.
- [ ] No optional venue fields are part of the approved v1 storefront DTO.
- [ ] Event enrichment is presented as supplemental metadata and never overwrites Commerce-owned title, category, or description fields.
- [ ] Dates remain unambiguous across browser locale, event timezone, and daylight-saving transitions.
- [ ] An unknown/inactive enrichment record preserves the Commerce PDP but disables event booking until the approved fallback is confirmed.
- [ ] Commerce out-of-stock or insufficient-quantity responses always disable or reject booking regardless of App Builder metadata.

### EDS-FR-4: Quantity and Participant Form

**Priority:** Must Have

Acceptance criteria:

- [ ] Quantity is an integer from 1 through the minimum of Commerce's permitted/salable quantity and the provisional current backend limit of 20.
- [ ] The backend quantity limit is not treated as an approved business constant until it appears in the approved versioned API contract.
- [ ] Contact contains exactly `firstName`, `lastName`, and `email`.
- [ ] Each participant contains exactly `firstName` and `lastName`.
- [ ] The participant row count always equals the selected ticket quantity.
- [ ] Consent must be explicitly checked and must not be preselected.
- [ ] Client validation mirrors backend rules but never replaces backend validation.
- [ ] Validation messages are associated with fields, announced to assistive technology, and focus moves to the first invalid field on submission.
- [ ] The form prevents accidental duplicate submissions while preserving entered values after recoverable errors.
- [ ] Contact/participant PII is not placed in URLs, analytics, console logs, localStorage, sessionStorage, or authored page content.
- [ ] Before submission, an order summary displays the Commerce product name, selected event date/time and timezone, venue, quantity, Commerce unit price, currency, and Commerce-derived total.
- [ ] The order summary updates when quantity changes and never calculates from an App Builder price field.
- [ ] The order summary is programmatically associated with the form and remains understandable with keyboard and screen-reader navigation.

### EDS-FR-5: Create Booking Intent

**Priority:** Must Have

EDS must call the public `create-intent` action before adding the event product to the cart.

Acceptance criteria:

- [ ] EDS generates a high-entropy or UUID-grade `source_request_id` once per logical submission and reuses it for safe retries of that submission.
- [ ] The JSON request contains only `source_request_id`, `commerce_cart_id`, `commerce_sku`, `event_id`, `quantity`, `contact`, `participants`, and `consent: true`.
- [ ] `Content-Type: application/json` is sent.
- [ ] A `201` response and an idempotent `200` response are both treated as success when they contain `intent_ref` and status.
- [ ] Integration transactionally permits only one active intent per
  `(commerce_cart_id, commerce_sku)`.
- [ ] The same `source_request_id` returns the original intent; a different request
  for an active pair returns `409 BOOKING_ALREADY_EXISTS` without creating an
  intent.
- [ ] A `400`, `404`, `413`, or `415` response renders a safe actionable message and does not add a product to cart.
- [ ] A transient/server/network failure permits a bounded manual retry with the same `source_request_id`.
- [ ] EDS never logs or exposes the complete submitted request.

### EDS-FR-6: Add Correlated Event Product to Cart

**Priority:** Must Have

Acceptance criteria:

- [ ] After intent creation succeeds, EDS calls the installed cart drop-in `addProductsToCart` flow for the Commerce SKU and the same quantity.
- [ ] EDS adds the product without arbitrary `CartItemInput` fields, captures the
  exact cart item UID, and calls SaaS `setCustomAttributesOnCartItem`.
- [ ] The mutation stores `booking_intent_ref: intent_ref` on that cart item and
  the response is verified before the form is cleared.
- [ ] Before intent creation, EDS queries the active cart and blocks an existing
  correlated SKU with a link to the cart.
- [ ] Retry reconciles the cart first and never creates another intent or adds
  quantity again for the same logical submission.
- [ ] If add-to-cart fails, the UI explains that no cart item was created and allows a safe retry without creating a duplicate intent.
- [ ] If add-to-cart succeeds, EDS clears the in-memory participant form and navigates or confirms using the established storefront cart behavior.
- [ ] Event intent data is not inferred later from SKU, URL, browser storage, or participant names.

### EDS-FR-7: Cart Integrity

**Priority:** Must Have

Acceptance criteria:

- [ ] Each event cart line retains its own `booking_intent_ref` and quantity.
- [ ] Cart display uses Commerce price and salability only.
- [ ] The storefront must not allow an event quantity change that causes the cart quantity to differ from the participant count stored for that intent.
- [ ] EDS supports editing an event cart line's quantity and participant details.
- [ ] Editing requires an approved, versioned, idempotent Integration intent-replacement contract that returns a new `intent_ref` without invalidating the intent currently linked to the cart line.
- [ ] The edit UI always collects exactly one participant for the requested quantity and revalidates Commerce salability before committing the edit.
- [ ] EDS updates the Commerce cart quantity and `booking_intent_ref` to the replacement values in one supported cart mutation so the active quantity always matches the replacement participant count.
- [ ] If intent replacement fails, the Commerce cart line remains unchanged and the shopper's edited form values are preserved for retry.
- [ ] If the Commerce cart update fails after replacement-intent creation, the original cart line and original intent correlation remain authoritative; the unused replacement intent is handled by backend retention cleanup.
- [ ] Removing an event cart item does not require a backend delete call; abandoned intent cleanup remains a backend retention responsibility.
- [ ] Non-event items continue to use existing cart behavior.

### EDS-FR-8: Standard Checkout

**Priority:** Must Have

Acceptance criteria:

- [ ] Checkout uses the existing Commerce checkout drop-in and configured sandbox payment methods.
- [ ] EDS adds no payment, shipping, tax, or backend checkout customization.
- [ ] `booking_intent_ref` survives SaaS cart-to-order-item conversion.
- [ ] Mixed carts remain supported; only linked event quantities later produce tickets.
- [ ] Commerce performs final inventory/salability validation and may reject unavailable quantity.

### EDS-FR-9: Order Confirmation

**Priority:** Must Have

Acceptance criteria:

- [ ] The existing checkout-success block remains the authoritative order confirmation UI.
- [ ] When the order contains event items, EDS displays that ticket creation is asynchronous and that the hosted ticket link will be sent to the Commerce order email after confirmation/invoicing.
- [ ] The confirmation page does not claim tickets are issued until a backend status confirms issuance.
- [ ] A support path is available for delayed or failed ticket delivery.
- [ ] No participant PII or opaque QR verification value is exposed in page markup, URL parameters, analytics, or logs.
- [ ] Immediate ticket or QR polling/display is not part of the POC order-confirmation requirement.

### EDS-FR-10: Hosted Booking and Ticket Status Page

**Priority:** Should Have

Acceptance criteria:

- [ ] The page accepts only `booking_ref` from an approved hosted link and never queries by a guessable order number.
- [ ] EDS calls the public ticket `get` action with that `booking_ref`.
- [ ] The approved public projection contains booking status, optional `order_increment_id`, and for each ticket only `ticket_ref`, status, and a backend-generated HTTPS `qr_render_url`.
- [ ] The page may display booking status, the approved optional order increment ID, ticket reference, ticket status, and the QR image loaded from `qr_render_url`.
- [ ] Invalidated tickets are visually and semantically distinct from active tickets.
- [ ] Unknown, expired, or unavailable bookings render a non-sensitive not-found/expired state.
- [ ] The page and its API client must not consume participant/contact PII, `intent_ref`, internal identifiers, raw verification values, hashes, or processing records.
- [ ] Integration remains responsible for QR generation through the public `ticket-api/render` action; EDS must never derive a QR value from `ticket_ref`.
- [ ] EDS treats `qr_render_url` as an opaque backend-generated HTTPS URL, verifies it against the approved backend origin policy, and never extracts or handles its underlying verification value.
- [ ] Integration must update and version the public ticket projection before EDS-hosted QR display receives implementation approval.

### EDS-FR-11: Failure and Partial-Data Behavior

**Priority:** Must Have

| Scenario | Required EDS behavior |
| --- | --- |
| Commerce listing fails | Show listing error/retry; do not call enrichment without identifiers. |
| Batch enrichment fails | Preserve Commerce products and use approved metadata fallback. |
| One event lacks enrichment | Preserve its Commerce position and apply the approved per-card fallback. |
| Detail enrichment returns 404 | Preserve Commerce PDP but disable event booking pending approved fallback. |
| Event becomes unsalable | Disable booking and surface Commerce availability state. |
| Intent validation fails | Keep form values, show field/summary errors, do not add to cart. |
| Intent call times out | Permit retry with the same `source_request_id`. |
| Intent succeeds but cart add fails | Retry cart add with the same `intent_ref`; do not create a new intent automatically. |
| Replacement intent creation fails during cart edit | Preserve the original cart line/correlation and the shopper's edited values; allow a safe retry. |
| Replacement intent succeeds but cart edit fails | Preserve the original cart line/correlation; report the failure and leave unused replacement cleanup to backend retention. |
| Checkout completes but ticket is pending | Confirm order and explain asynchronous email delivery. |
| Ticket lookup returns 404 | Show non-sensitive unavailable message and support route. |

### EDS-FR-12: Localization and Authoring

**Priority:** Should Have

Acceptance criteria:

- [ ] Shopper-facing labels and messages use the repository placeholder/localization pattern.
- [ ] Locale-aware formatting is used for dates, times, price, and currency while retaining event timezone context.
- [ ] Authors control surrounding editorial content, headings, help text, empty states, and support links without authoring API endpoints or technical identifiers.
- [ ] Runtime endpoint configuration is environment-owned, not authored in document content.
- [ ] The implementation is defensive when optional authored content or enrichment fields are absent.

## 7. Observed Public Backend Contract — Pending Approval

The following describes behavior observed in the current Integration implementation. It is not an approved cross-repository API contract. EDS must not depend on these details until they are captured in a versioned contract,
verified against the deployed target environment, and approved by the Integration and EDS owners.

For each observed endpoint, record:

- Contract status: Provisional, Approved, or Drift detected
- Contract version
- Owning repository/team
- Deployed environment tested
- Contract-test reference
- Known differences from requirements

This preserves useful implementation discoveries—such as current action paths and response shapes—without allowing accidental backend behavior to become the storefront specification.

### 7.1 Batch Event Enrichment

- Runtime action: `event-api/enrich`
- Authentication: none
- Input: `external_event_ids`, a non-empty deduplicated string array, maximum 100
- Success: `200 { "events": { "<event_id>": <PublicEvent> } }`
- Validation failure: `400`

### 7.2 Event Detail

- Runtime action: `event-api/detail`
- Authentication: none
- Input: `external_event_id` (current source also accepts `event_id`)
- Success: `200 { "event": <PublicEvent> }`
- Not found: `404 { "error": "Event not found" }`

### 7.3 Public Event DTO

```json
{
  "event_id": "string",
  "organizer": "string",
  "tags": ["string"],
  "age_requirement": "string",
  "starts_at_utc": "ISO-8601 string",
  "ends_at_utc": "ISO-8601 string",
  "timezone": "IANA timezone string",
  "venue": {}
}
```

Commerce remains authoritative for title, category, short description, and long description; the current Integration public projection no longer returns those fields. Current Integration source does not constrain the public `venue` shape.

The approved target v1 venue projection is:

```json
{
  "venue": {
    "name": "non-empty string",
    "address": "non-empty string"
  }
}
```

No optional venue fields are approved for v1. The venue object and both fields must be non-null and non-empty. Integration must capture this target in the versioned public contract and contract tests before storefront implementation approval.

### 7.4 Create Booking Intent

- Runtime action: `booking-api/create-intent`
- Authentication: none
- Transport: JSON body, maximum 64 KiB, `Content-Type: application/json`
- Quantity: integer 1–20

```json
{
  "source_request_id": "client-generated stable idempotency key",
  "commerce_cart_id": "active Commerce cart id",
  "commerce_sku": "event product sku",
  "event_id": "immutable event id",
  "quantity": 2,
  "contact": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com"
  },
  "participants": [
    { "firstName": "Ada", "lastName": "Lovelace" },
    { "firstName": "Grace", "lastName": "Hopper" }
  ],
  "consent": true
}
```

Success is `201`, or `200` for an idempotent replay, with:

```json
{
  "intent_ref": "opaque string",
  "status": "awaiting_order"
}
```

### 7.5 Get Booking/Ticket Status

- Runtime action: `ticket-api/get`
- Authentication: none
- Input: `booking_ref`
- Success:

```json
{
  "booking": {
    "order_increment_id": "string",
    "intent_ref": "opaque string",
    "booking_ref": "opaque string",
    "status": "string",
    "tickets": [
      {
        "ticket_ref": "opaque string",
        "status": "string"
      }
    ]
  }
}
```

- Not found: `404 { "error": "Booking not found" }`

This observed response is not the approved EDS projection because it exposes `intent_ref` and does not provide `qr_render_url`. Integration must version the response so EDS receives only booking status, optional `order_increment_id`, and per-ticket `ticket_ref`, status, and backend-generated HTTPS `qr_render_url`.

### 7.6 Render Ticket QR

- Runtime action: `ticket-api/render`
- Authentication: none
- Method: `GET`
- Input: `verification_ref`, currently a 43-character opaque base64url value
- Success: `200 image/svg+xml` with `Cache-Control: no-store`
- Unknown ticket: `404`
- Inactive ticket: `410`
- Ownership: Integration validates the opaque reference and renders the QR SVG; EDS must not generate a QR payload or derive one from a public ticket identifier.

The parameter length, encoding, response headers, and error statuses remain provisional until included in the approved versioned API contract and verified against the deployed action.

### 7.7 Contract Drift and Missing Contracts

Review baseline: Integration `REQUIREMENTS.md` v2.4, `ARCHITECTURE.md`,
Runtime manifests, public action source, and action tests inspected on 2026-07-30.
Source alignment below is not deployment approval; every browser-consumed contract
remains provisional until the versioned environment contract and deployed tests
required by Sections 8 and 13 are approved.

**Resolved in current Integration source:**

- Integration requirements now document `ticket-api/render` and
  `ticket-api/verify`; both actions are registered under `ticket-api` and have
  method, input, response, security-header, and error-path tests.
- `ticket-api/get` now returns the approved allowlisted booking projection,
  excludes `intent_ref`, normalizes public statuses, adds an HTTPS
  `qr_render_url` per ticket, and applies `Cache-Control: no-store`.
- Integration requirements now define the five Commerce discovery attributes:
  `is_event_ticket`, `external_event_id`, `event_date`, `event_type`, and
  `event_status`, including the approved dropdown labels and pre-pagination
  filtering intent. Tenant schema/query support and fixtures remain unverified.
- A public mapping from `intent_ref` to `booking_ref` is intentionally not
  required by the approved storefront flow. Integration creates `booking_ref`
  during order correlation and delivers the hosted link asynchronously by email.
- Integration architecture, Runtime manifest, action source, telemetry name, and
  storefront configuration now consistently use `booking-api/create-intent`.

**Open drift or missing contracts:**

- No versioned OpenAPI or equivalent environment contract was found that fixes
  development/stage URLs, action paths, allowed HTTP methods, parameter encoding,
  request/response schemas, error behavior, contract version, and tested
  deployment. Source and unit-test evidence therefore remains Provisional.
- No Integration intent-replacement action supports the EDS cart
  quantity/participant editing transaction required by EDS-FR-7.
- Public event projection code passes `venue` through without enforcing the
  approved v1 object containing exactly non-empty `name` and `address`; its tests
  currently accept a venue containing only `name`.
- Browser-required CORS response headers or an approved same-origin proxy were
  not found in the public action response path. Per-environment EDS origin
  allowlists and browser preflight/response tests remain required.
- `event-api/enrich`, `event-api/detail`, and `ticket-api/get` do not enforce an
  explicit HTTP method in action code. Their method and parameter transport
  contracts must be fixed by the approved API specification and verified against
  deployed Runtime behavior.
- Integration `REQUIREMENTS.md` v2.4 contains internal status drift: its
  implementation-state bullets still say the v1.7 filter attributes and v1.8
  ticket projection are not implemented, while its handoff gate marks the ticket
  projection resolved and current source/tests implement it. Integration must
  reconcile those status statements before cross-repository approval.

## 8. Storefront Configuration Requirements

- Add an environment-specific Event API base URL through the established storefront configuration mechanism.
- Do not store App Builder IMS credentials, database credentials, SendGrid keys, QR secrets, or other backend secrets in EDS.
- Allow separate development, stage, and production-like POC endpoints.
- Validate HTTPS and an allowlisted origin before sending PII.
- The backend must explicitly permit required EDS origins through CORS, or an approved same-origin edge/proxy design must be provided.
- Endpoint failures must not reveal namespace internals, stack traces, credentials, or submitted PII to shoppers.
- Production must not use the unauthenticated API model without the required security/privacy review and approved compensating controls.
- Integration and EDS owners must approve a versioned OpenAPI contract containing the exact development/stage Runtime URLs, action paths, HTTP methods, parameter encoding, request/response schemas, and error behavior.
- DevOps/Security must approve an explicit per-environment EDS origin allowlist.
- Contract tests and browser CORS tests must pass against each deployed environment before storefront implementation approval.

## 9. Proposed Storefront Integration Surfaces

These are requirement-level integration surfaces, not an approved implementation architecture.

| Surface | Existing basis | Required extension |
| --- | --- | --- |
| Event listing | `product-list-page` and product-discovery drop-in | Join batch event metadata and render event filters/card fields. |
| Event detail | `product-details` and PDP drop-in | Fetch detail metadata and render event schedule/venue, participant form, and pre-submission order summary. |
| Add to cart | PDP cart API call | Create intent, add normally, then attach `booking_intent_ref` with SaaS `setCustomAttributesOnCartItem`. |
| Cart | `commerce-cart` | Edit event quantity/participants through intent replacement, update quantity and `booking_intent_ref` together, protect correlation integrity, and show the event summary. |
| Checkout | `commerce-checkout` | No custom checkout behavior; preserve correlation attribute. |
| Confirmation | `commerce-checkout-success` | Add asynchronous ticket-processing guidance for event orders. |
| Hosted ticket page | New or reusable content/commerce block to be assessed | Accept only `booking_ref`, render the allowlisted ticket projection, and load backend-rendered QR images only through approved HTTPS `qr_render_url` values. |

Before any new block is created, Phase 2 must perform the mandatory block reusability and authoring-model assessment.

## 10. Non-Functional Requirements

### 10.1 Performance

- Maintain green Core Web Vitals and target Lighthouse 100 for catalog/PDP where feasible.
- Event enrichment must not block initial Commerce product rendering or the PDP's primary product/LCP media.
- Batch listing enrichment into one request per Commerce page; never issue one request per card.
- Backend target is P95 under 500 ms for batch/detail enrichment at up to 100 active POC events and 50 peak concurrent API requests.
- Use bounded timeouts and avoid automatic retry storms.
- Load ticket-page code and non-critical event UI lazily.
- Prevent layout shift by reserving space for enriched card/detail fields and loading states.

### 10.2 Accessibility

- Meet WCAG 2.2 AA for new or changed UI.
- All form fields have programmatic labels, instructions, error associations, and keyboard-operable controls.
- Quantity changes announce participant-row changes without unexpectedly moving focus.
- Loading, success, validation, and API error states use suitable live-region behavior.
- Event dates include machine-readable values and human-readable timezone labels.
- Ticket status and invalidation are not communicated by color alone.

### 10.3 Security and Privacy

- Treat every Event App endpoint as public and every response as potentially shareable.
- Send PII only over HTTPS to the configured allowlisted backend origin.
- Never place participant/contact data, `intent_ref`, `booking_ref`, or ticket/QR references in analytics payloads.
- Do not persist contact or participant PII in browser storage.
- Use strict request/response field allowlists and render text safely.
- Do not insert backend-provided strings through `innerHTML`.
- Generate `source_request_id` client-side using a cryptographically strong browser API.
- Avoid automatic retries of writes except with the same idempotency key and explicit bounded behavior.
- Retain the explicit consent control required by the booking-intent API. Bespoke consent/privacy copy and a privacy-policy URL are deferred for this demo and are mandatory before any production release.

### 10.4 Resilience and Maintainability

- Centralize Event API transport, DTO normalization, timeouts, and safe error mapping.
- Isolate provisional Runtime action names, limits, and DTO adapters behind the centralized client so contract changes do not spread through blocks.
- Do not modify generated files under `scripts/__dropins__/`.
- Use native DOM construction for new storefront UI.
- Keep Commerce and event DTOs separate until an explicit join step.
- Missing optional event fields must not crash a card, PDP, confirmation, or ticket page.
- Correlation and endpoint behavior must have contract tests against both mocked and deployed POC APIs.

### 10.5 Browser Support and Responsive Design

- Support the storefront's current browser policy.
- Verify mobile, tablet, and desktop layouts.
- Participant entry must remain usable for the maximum supported quantity without horizontal scrolling.
- Venue and ticket content must work with touch, keyboard, zoom, and reduced-motion preferences.

## 11. Analytics Requirements

- Preserve existing Adobe Client Data Layer commerce events for product view, add to cart, cart view, checkout, and purchase.
- Add event-domain analytics only after a data-layer schema is approved.
- Permitted event metadata should use non-PII identifiers/categories only.
- Never send contact, participant, consent payload, `intent_ref`, `booking_ref`, `ticket_ref`, or QR/verification values.
- Avoid double-counting add-to-cart when intent creation succeeds but Commerce add-to-cart fails.

## 12. Testing and Acceptance

### 12.1 Unit and Contract Testing

- Public Event API client request encoding and response normalization.
- Batch deduplication, approved/versioned identifier bound, keyed join, Commerce order preservation, and missing enrichment.
- Date/time conversion using event timezone and daylight-saving boundaries.
- Contact, participant-count, quantity, email, consent, and exact-field validation.
- Stable `source_request_id` reuse after timeout/retry.
- `intent_ref` propagation through SaaS `setCustomAttributesOnCartItem`.
- Intent replacement, stable retry idempotency, participant-count validation, and atomic cart quantity/`booking_intent_ref` update behavior.
- Safe error mapping without PII leakage.
- Ticket status projection and invalidated state.

### 12.2 Browser End-to-End Testing

- Event listing: Commerce-only, fully enriched, partially enriched, empty, and failed enrichment.
- Event filters and URL/back-forward behavior.
- Event PDP: active, missing metadata, unsalable, maximum quantity, form validation, and API retry.
- Event PDP order summary: quantity updates, Commerce price/currency/total, event schedule, venue, and accessible form association.
- Intent success followed by cart success.
- Intent success followed by cart failure and safe retry.
- Successful event quantity/participant edit with replacement intent and updated cart correlation.
- Intent-replacement failure and cart-update failure without corruption of the original cart line.
- Guest and authenticated standard checkout with sandbox payment.
- Mixed event/non-event order.
- Checkout confirmation before and after asynchronous ticket generation expectations.
- Hosted booking page: active, pending, invalidated, unknown, and expired/unavailable `booking_ref` values.
- Ticket projection allowlist: approved fields only, no `intent_ref`, PII, raw verification values, hashes, or internal processing fields.
- Backend-rendered QR URL: HTTPS/origin validation, active SVG, unknown ticket, and inactive ticket.
- Mobile/tablet/desktop visual checks, keyboard-only use, screen-reader semantics, 200% zoom, and reduced motion.

### 12.3 Performance and Security Verification

- Lighthouse/Core Web Vitals on event listing and PDP.
- No per-card enrichment fan-out.
- No event enrichment on non-event pages.
- Browser CORS preflight and actual requests from every approved EDS origin.
- Request-size, malformed JSON, rate-limit, timeout, and safe retry behavior.
- Browser storage, URL, logs, page source, and analytics contain no participant/contact PII.
- Approved event-product fixtures exist and are queryable before storefront E2E execution; each fixture has the required virtual-product type, attributes, immutable identifiers, inventory, salability, and matching active event metadata.

## 13. Dependencies and Delivery Gates

| Dependency or gate | Status | Owner |
| --- | --- | --- |
| Commerce target is Adobe Commerce as a Cloud Service | Confirmed by user on 2026-07-28 | Commerce owner |
| Event products expose `is_event_ticket`, `event_type`, `event_status`, `event_date`, and `external_event_id` to storefront queries with approved types/options/operators | Blocking schema/query verification | Commerce owner |
| SaaS `setCustomAttributesOnCartItem` is available and copies item attributes to orders | Blocking tenant contract test | EDS + Commerce owners |
| Integration enforces one active intent per `(commerce_cart_id, commerce_sku)` and returns `409` for a conflicting request | Blocking | Integration owner |
| SaaS event cart editing has an approved compensating transaction across quantity and attribute mutations | Blocking contract/design | EDS + Commerce owners |
| Integration provides a versioned, idempotent intent-replacement contract for cart editing | Blocking | Integration owner |
| Development/stage Runtime URLs, action paths, methods, encoding, schemas, and errors are approved in versioned OpenAPI | Blocking | Integration + EDS owners |
| Explicit per-environment EDS origin allowlists are approved and browser CORS tests pass | Blocking | DevOps/Security |
| Public event DTO with non-null `venue.name` and `venue.address` is versioned and contract-tested | Blocking | Integration owner |
| EDS-hosted ticket route accepts only `booking_ref` | Confirmed requirement | EDS owner |
| Public ticket projection excludes forbidden fields and provides approved HTTPS `qr_render_url` values | Blocking for EDS-hosted QR | Integration/Security |
| Backend `ticket-api/render` action and generated QR URLs are deployed, contract-tested, and CORS-compatible | Blocking for EDS-hosted QR | Integration/Security |
| Bespoke consent/privacy copy and privacy-policy URL | Deferred for demo; production blocker | Privacy/Product |
| Standard Commerce checkout and sandbox payment are configured | External prerequisite | Commerce owner |
| Approved event-product and event-metadata fixtures are available for storefront E2E testing | Blocking for E2E | Commerce + Checkout + Integration owners |
| Integration and Checkout use the same approved Project, Workspace, Runtime namespace, and `aus` Database region | External POC deployment blocker | Product/DevOps owners |
| Exposed Integration workspace credentials are revoked/rotated and repository credential hygiene is verified | External POC deployment blocker | Integration/DevOps owners |
| Checkout implements its authenticated event Admin actions and shared Database access contract | External POC deployment blocker | Checkout owner |
| Checkout architecture and sanitized authoritative configuration are approved and under source control | External POC deployment blocker | Checkout/Product owners |
| Runtime entity inventory confirms non-colliding Integration and Checkout packages, actions, triggers, rules, APIs, and registrations | External POC deployment blocker | Integration + Checkout + DevOps owners |

## 14. Assumptions

1. The POC supports anonymous and authenticated shoppers, but all Event App APIs remain unauthenticated.
2. Event listing is a Commerce category/search experience filtered by `is_event_ticket`, `event_type`, `event_status`, and `event_date`, not an independent App Builder event catalog.
3. Location/venue, organizer, tag, and age filters are page-local for the POC; sparse pages and non-global counts are accepted.
4. Event quantity is selected and participant data is collected on the PDP before add-to-cart.
5. Event quantity and participants are editable in cart through a replacement-intent workflow; implementation remains blocked until the Integration and cart mutation contracts exist.
6. The POC uses standard Commerce order confirmation with asynchronous ticket-processing and Commerce-order-email guidance; immediate ticket or QR display is not required.
7. The email-hosted link routes to an EDS page using only a high-entropy `booking_ref`.
8. Map display and map-provider integration are not required for this POC.
9. Bespoke privacy copy and a privacy-policy URL are deferred for the demo; the API-required explicit consent control and all PII protections remain in force.

## 15. Resolved Stakeholder Decisions

1. The approved v1 `venue` DTO contains required non-null, non-empty `name` and `address` fields and no optional fields.
2. Commerce event discovery uses `is_event_ticket`, `event_type`, `event_status`, and `event_date`; remaining event-domain filters may be page-local as defined in EDS-FR-2.
3. EDS must support editing event quantity and participant details in cart through the failure-safe replacement-intent workflow defined in EDS-FR-7.
4. Bespoke consent/privacy copy and a privacy-policy URL are deferred for the demo, while the explicit API-required consent control, 180-day PII retention, Australian residency, and PII safeguards remain unchanged.
5. Integration and EDS owners will approve a versioned OpenAPI contract defining exact development/stage Runtime URLs, action paths, HTTP methods, parameter encoding, schemas, and error behavior. DevOps/Security will approve per-environment EDS origin allowlists. Contract and browser CORS tests must pass against each environment before storefront implementation approval.
6. The hosted ticket page is part of this EDS repository and accepts only `booking_ref`. It may consume/display booking status, optional approved order increment ID, and each ticket's reference, status, and backend-generated HTTPS QR render URL. It must not consume participant/contact PII, `intent_ref`, internal identifiers, raw verification values, hashes, or processing records. Integration must update and version the public ticket projection before EDS-hosted QR display is approved.

## 16. Traceability

| Overall POC requirement | EDS requirement coverage | Backend dependency |
| --- | --- | --- |
| Event listing and filters | EDS-FR-1, EDS-FR-2 | Commerce attributes plus Event batch enrichment |
| Event detail, schedule, and venue information; map display excluded by stakeholder decision | EDS-FR-3 | Event detail DTO |
| Contact and participant details plus pre-submission order summary | EDS-FR-4, EDS-FR-5 | Create-intent |
| Commerce cart stores booking intent and supports event editing | EDS-FR-6, EDS-FR-7 | Cart/order correlation plus Integration intent replacement |
| Standard checkout/payment | EDS-FR-8 | Commerce configuration |
| Booking confirmation | EDS-FR-9 | Async invoice/ticket processing and Commerce-order-email delivery |
| QR ticket and unique reference | EDS-FR-10 displays approved backend QR URLs; no EDS QR generation | Versioned ticket projection and Integration-owned `ticket-api/render` |
| SendGrid delivery | EDS-FR-9, EDS-FR-10 | Integration-owned email delivery |
| Checkout-owned authenticated Admin APIs | No EDS implementation; external dependency/gate | Checkout-owned Admin application |
| App Builder Database for event-only and booking data | EDS consumes only allowlisted public APIs | Integration-owned Database schema and lifecycle |
| Shared Runtime and Database coordination | No EDS implementation; external POC deployment gate | Integration + Checkout + DevOps coordination |

## Phase 1: Complete ✅

Date: 2026-07-23

User Approved: Yes — 2026-07-23

Status: All Phase 1 stakeholder questions are resolved and recorded in Section 15. The requirements baseline is approved for Phase 2 architectural planning. Blocking external contracts and deployment gates remain explicitly tracked and do not authorize backend implementation from this repository.

## 17. Phase 2 Architectural Plan

### 17.1 Architecture Summary

The storefront will remain Commerce-first and extend the installed drop-ins at their
documented slots and APIs. Event-specific browser code will be isolated behind a
small Event App client and controller layer. No generated file under
`scripts/__dropins__/` will be modified.

```text
Commerce listing/PDP/order data
           |
           v
Existing EDS commerce blocks ----> Event view controllers
           |                              |
           |                              v
           |                       Public Event App client
           |                              |
           v                              v
Cart and checkout drop-ins       Versioned Runtime API contract
           |
           v
Standard Commerce order confirmation

Email booking_ref link -> EDS hosted-ticket route -> public ticket projection
                                                -> approved HTTPS QR render URLs
```

The Event App client will own endpoint configuration, timeout behavior, request
encoding, response allowlisting, DTO validation, error normalization, and safe
retry primitives. Blocks will own DOM and user interaction, not transport details.

### 17.2 Reuse and Extension Decisions

| Surface | Decision | Architectural basis |
| --- | --- | --- |
| Event listing | Extend `product-list-page` | The existing product-discovery `SearchResults`, `Facets`, `SortBy`, and `Pagination` containers remain authoritative. Verified `SearchResults` slots include `ProductName`, `ProductPrice`, `ProductImage`, `ProductActions`, `Header`, and `Footer`. |
| Event PDP and booking | Extend `product-details` conditionally for products with `is_event_ticket` | The current composable PDP already owns Commerce media, title, price, options, quantity, descriptions, attributes, validation events, and cart API use. Event metadata, participant form, and order summary are supplemental native-DOM regions. |
| Add to cart | Extend the current PDP submit controller | Add normally, identify the returned cart item UID, and use the SaaS custom-attribute mutation through the Cart drop-in GraphQL transport. |
| Cart display/edit | Extend `commerce-cart` | The installed `CartSummaryList` exposes verified `ItemQuantity`, `ProductAttributes`, `CartItem`, and `Footer` slots. Event lines receive an event-specific edit control while non-event lines retain current behavior. |
| Checkout | Reuse `commerce-checkout` unchanged | Checkout remains entirely Commerce-owned. |
| Confirmation | Extend `commerce-checkout-success` | Preserve the standard order containers and add non-blocking asynchronous ticket guidance when an approved order-line event marker is available. |
| Hosted ticket page | Create one new `event-ticket` block | No existing block performs a public non-Commerce booking lookup or renders an allowlisted ticket/QR projection. The new block has one bounded responsibility. |
| Shared Event App behavior | Create shared storefront modules under `scripts/` | Transport, DTO validation, dates, event-product detection, and safe error mapping must not be duplicated across blocks. |

The new hosted-ticket block is justified only after checking the current `blocks/`
inventory: no existing commerce or content block provides equivalent lookup,
status, or QR-image behavior.

### 17.3 Listing Data Flow

1. `product-list-page` requests Commerce results using the existing search state.
2. Commerce filters the listing by `is_event_ticket` and supports
   `event_type`, `event_status`, and `event_date` through verified catalog
   attributes and facets.
3. After a Commerce result is available, the controller extracts and deduplicates
   non-empty `external_event_id` values from that page.
4. One batch enrichment request is made for the page, within the approved contract
   limit.
5. The response is validated into a map keyed by event ID. The view joins by key,
   never by response position, and does not add or reorder Commerce products.
6. Verified `SearchResults` slots append organizer, schedule, and venue text to
   event cards. Commerce-owned name, description, image, category, and price are
   never replaced by enrichment.
7. Commerce filters retain existing URL behavior. Approved page-local event-domain
   filters operate only on the current enriched page and label their result/count
   semantics accordingly.
8. Commerce content renders before enrichment. Skeleton/reserved metadata space
   limits layout shift; a failed batch request leaves Commerce cards usable.

### 17.4 PDP, Booking Form, and Add-to-Cart Flow

1. The existing PDP initializer supplies the Commerce product. Event mode is
   enabled only when the approved `is_event_ticket` value is present.
2. The controller validates `external_event_id` and loads one event detail record.
   Booking remains disabled for missing, inactive, invalid, or unsalable event data.
3. Existing Commerce containers continue to render identity, media, descriptions,
   options, price, and salability. A supplemental event region renders the
   allowlisted schedule, timezone, organizer, venue, age, and tags.
4. Event mode replaces the ordinary submit interaction with an accessible
   participant form and Commerce-derived order summary. Quantity state drives
   exactly one participant row per ticket.
5. On submit, the controller validates the form, ensures an active cart, checks for
   an existing correlated SKU, generates one cryptographically strong
   `source_request_id`, disables duplicate submission, and calls create-intent with
   the cart ID and SKU.
6. A successful intent response is allowlisted to `intent_ref` and status. The
   controller calls `addProductsToCart` without arbitrary custom fields, captures
   the exact new item UID, and calls SaaS `setCustomAttributesOnCartItem`.
7. If intent creation fails, no cart mutation occurs. If a later step fails, the
   in-memory submission retains the same request ID, intent reference, item UID,
   and operation stage so a bounded retry reconciles instead of duplicating work.
8. Successful add-to-cart clears PII from in-memory form state and follows the
   storefront's established cart feedback/navigation behavior.

### 17.5 Cart Editing Transaction

For an event line, the standard quantity editor is replaced through the verified
`ItemQuantity` slot with a single “Edit tickets and participants” action. The edit
dialog starts from the current quantity, but participant/contact values may be
loaded only through an approved replacement-intent contract; they are never
reconstructed from the cart or stored in browser persistence.

The commit sequence is:

1. Preserve the original cart line quantity and `booking_intent_ref`.
2. Validate the proposed quantity, participants, contact, consent, and current
   Commerce salability.
3. Create an idempotent replacement intent without invalidating the original.
4. Apply the approved SaaS compensating transaction for quantity and custom
   attribute changes.
5. Treat the edit as committed only after both Commerce mutations succeed.
6. On replacement failure, leave the original line unchanged and preserve edited
   form values in memory. On cart mutation failure, keep the original line and
   correlation authoritative and show a recoverable error.

Implementation of this transaction remains gated because SaaS exposes separate
quantity and custom-attribute mutations and the recovery contract is not approved.
Non-event cart items keep the current quantity, edit, remove, wishlist, and gift
options behavior.

### 17.6 Checkout and Confirmation

No event API call is added to checkout. Commerce remains responsible for cart
validation, payment, order placement, and conversion of
`booking_intent_ref` to the order item.

`commerce-checkout-success` continues to render the standard Commerce confirmation.
For an order confirmed to contain an event line through an approved order
projection, it appends guidance that ticket creation is asynchronous and that the
hosted link will be sent to the Commerce order email after confirmation/invoicing.
It does not poll, render a ticket, or expose participant or correlation data.

The exact order-line event discriminator is a Phase 3 discovery item and must be
verified from the installed order model and target Commerce response before code
is written. It must not be inferred from product text or URL structure.

### 17.7 Hosted Ticket Page

The new `event-ticket` block will:

1. Read only `booking_ref` from the page URL and reject missing or malformed input
   before making a request.
2. Request the versioned public ticket projection through the shared client.
3. Discard any response field outside the approved booking/ticket allowlist.
4. Render booking status, optional order increment ID, and each ticket's reference
   and status using native DOM.
5. Render QR images only from backend-provided HTTPS `qr_render_url` values whose
   origin matches the approved policy.
6. Provide accessible pending, invalidated, unavailable, error, and retry states.
7. Never inspect, derive, log, or persist raw QR verification parameters.

The block will not be approved for QR implementation until Integration removes
`intent_ref` from the public projection and supplies the versioned
`qr_render_url` contract.

### 17.8 Content and Configuration Model

- Listing, PDP, cart, checkout, and confirmation remain automatic Commerce blocks;
  authors do not enter product IDs, event IDs, intent references, API paths, or
  environment URLs.
- Event UI labels, validation text, asynchronous-ticket guidance, empty states, and
  support text use the existing storefront placeholder/localization mechanism.
- The `event-ticket` authored block contains only presentation content such as an
  optional heading, introductory text, and support link. `booking_ref` comes only
  from the approved hosted link.
- Runtime base URLs and allowed origins are environment configuration, never
  document-authored content.
- Bespoke consent/privacy copy remains deferred for the demo; the explicit
  unchecked consent control remains part of the automatic form.

### 17.9 Security, Privacy, and Resilience Design

- Contact and participant PII exists only in active form memory and the HTTPS
  create/replacement request. It is excluded from URLs, storage, logs, analytics,
  and authored markup.
- Responses are parsed through strict allowlists before reaching rendering code.
- Backend strings are rendered as text through native DOM APIs.
- Write retries are manual and bounded, reusing the same idempotency identifier.
- Read requests use bounded timeouts; listing enrichment does not fan out per card.
- `booking_ref`, `intent_ref`, ticket references, and QR URLs are excluded from
  analytics.
- Event enrichment cannot override Commerce product selection, ordering, price,
  currency, inventory, or salability.
- CORS, HTTPS origin, API schemas, methods, error behavior, and deployment URLs
  come only from the approved versioned OpenAPI contract.

### 17.10 Phase 3 Implementation Sequence

Implementation should proceed in gated vertical slices:

1. Verify target Commerce schemas, installed drop-in/order models, event fixtures,
   SaaS custom-attribute behavior, and deployed OpenAPI/CORS contracts.
2. Add shared Event App transport, DTO normalization, date formatting, validation,
   and unit/contract tests.
3. Extend listing and PDP read-only enrichment with partial-data behavior.
4. Add PDP participant form, order summary, create-intent, and correlated
   add-to-cart flow.
5. Add event cart display and replacement-intent editing only after its external
   contract and atomic cart mutation tests pass.
6. Add checkout-success guidance using a verified order-line discriminator.
7. Add the hosted-ticket block only after the public projection and QR URL contract
   pass security, contract, and CORS tests.
8. Run browser E2E, accessibility, responsive, analytics-leakage, and performance
   verification against approved fixtures in development and stage.

Each blocked slice may be deferred without weakening the safety gates or changing
the unaffected standard Commerce behavior.

### 17.11 Phase 2 Decisions and Remaining Gates

Architectural decisions:

- Reuse and conditionally extend existing commerce blocks for all shopping stages.
- Add only one new page block, `event-ticket`.
- Centralize public API and DTO behavior outside block decorators.
- Keep Commerce rendering non-blocking and authoritative.
- Keep cart editing blocked until a SaaS-safe compensating transaction is approved.
- Keep order confirmation standard and asynchronous.

Remaining external gates are the blocking entries already listed in Section 13,
especially the versioned OpenAPI/CORS contract, catalog attribute schema, SaaS
cart/order correlation and intent-uniqueness contracts, replacement-intent API, approved order-line event
discriminator, event fixtures, and sanitized public ticket/QR projection.

## Phase 2: Architectural Plan Presented

Date: 2026-07-23

Status: The Phase 2 storefront architecture is documented in Section 17.

## Phase 2: Complete ✅

User Approved: Yes

Approval Date: 2026-07-23

Status: Phase 2 is approved. Phase 3 implementation approach selection is now
authorized; no Phase 4 implementation is authorized until an approach is selected.

## Phase 3: Implementation Approach Selected

Approach: Option A — Detailed implementation plan

Selection Date: 2026-07-23

## Phase 4: Implementation Started

Date: 2026-07-23

Detailed Plan: `scratch/IMPLEMENTATION_PLAN.md`

## Phase 4: Partial Implementation — External Gates Open

Date: 2026-07-23

Status: The contract-safe storefront foundation, listing/PDP behavior, correlated
add-to-cart path, and hosted-ticket block are implemented and statically verified.
Cart editing, event-specific confirmation, live Runtime activation, and deployed
E2E remain blocked by the unresolved gates in Section 13. Phase 4 is not complete.

### 2026-07-28 Browser Test Update

Historical and superseded by the SaaS target change: the configured PaaS Commerce
endpoint responded successfully in Chrome, including
the Product Search request. The catalog returned no results for `event`, and the
public storefront configuration contains no enabled `event-app` Runtime actions.
The event-ticket block's disabled state passed desktop/mobile rendering, console,
responsive-overflow, and accessibility-role checks. Live event PDP booking,
intent creation, correlated add-to-cart, and successful ticket lookup remain
blocked. See `scratch/TEST_REPORT.md`.

### 2026-07-28 SaaS Cart-Correlation Implementation

The storefront no longer passes `booking_intent_ref` as an undefined
`CartItemInput` field. It now:

1. Ensures an active Commerce cart and checks the current SKU before creating an
   intent.
2. Sends `commerce_cart_id` and `commerce_sku` to create-intent.
3. Adds the product with the installed cart API without arbitrary custom fields.
4. Captures the exact new cart item UID.
5. Applies and verifies `booking_intent_ref` using
   `setCustomAttributesOnCartItem`.
6. Retains the request ID, intent reference, cart item UID, and operation stage
   across a retry so it repairs instead of creating or adding again.
7. Blocks duplicate/integrity states and links the shopper to the cart.

Unit, lint, desktop/mobile browser, responsive-overflow, label, live-region,
duplicate, and retry-idempotency checks pass. See `scratch/TEST_REPORT.md`.

The cross-tab/device guarantee remains an Integration Starter Kit contract:
transactional uniqueness for active `(commerce_cart_id, commerce_sku)` pairs and
HTTP `409 BOOKING_ALREADY_EXISTS` for a conflicting request. Tenant-level
cart-to-order propagation, event cart editing, and an orphan-line checkout guard
remain externally gated.
