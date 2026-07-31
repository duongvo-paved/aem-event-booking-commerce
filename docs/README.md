# 1.1 Objective

Deliver a Proof of Concept (POC) for an event booking platform built on Adobe Experience Manager Edge Delivery Services (AEM EDS) as the frontend, integrated with Adobe Commerce as a Cloud Service (SaaS) as the commerce backend, and extended via Adobe App Builder for custom booking logic.

The POC will validate the feasibility of the following core booking type:

- Event Booking - Ticketed events with venue information, quantity picker, payment checkout.

# 1.2 Goals

- Demonstrate that a headless system, AEM EDS block-based architecture, can support a dynamic, commerce-driven booking flows
- Validate App Builder as a middleware layer for custom booking APIs, with Document DB as the data source for all booking data
- Validate end-to-end payment processing and checkout completion within the booking flow
- Demonstrate automated ticket generation (QR code) upon booking confirmation

# 1.3 POC – Scope of work

- Event listing
  - Cards with image, short description, organizer, price, categories.
  - Filters by category, price, date, location.
- Event detail page
  - Display schedule/availability.
  - Date/time, pricing, age requirements.
  - Venue detail.
  - Long description, tags/categories.
- Contact and participant details collecting form
- Use Commerce cart for storing booking intent
- Use the standard Adobe Commerce checkout with preconfigured sandbox payment methods. No checkout or payment-method customization is included.
- Booking confirmation page
- Automated ticket generation (QR code + unique reference) per quantity booked
- Ticket email delivery to a customer upon booking confirmation
- Checkout-owned authenticated Admin APIs for event management in the shared App Builder workspace and Runtime namespace
- App Builder Document DB as the data source for event data that cannot be stored in Commerce products

## Shared Runtime deployment coordination

Integration and Checkout must use the same Adobe Developer Console Project, Workspace, Runtime namespace, and App Builder Database region (`aus`). Integration owns the shared `events` schema, indexes, migrations, and retention purge. Checkout may update `events` only through its authenticated Admin actions and the shared optimistic-concurrency contract.

Integration reserves the Runtime packages `product-commerce`, `order-commerce`,
`event-api`, `booking-api`, and `ticket-api`. Checkout reserves `checkout-admin`;
neither repository may reuse the other application's package, action, trigger,
rule, API, or registration names.

Before deployment, inventory the selected workspace and its Runtime entities. Deploy Integration first when a schema/index migration is required so its `post-app-deploy` hook establishes the compatible indexes before Checkout writes shared data. Deploy Checkout only after that hook succeeds. Rollbacks use the same order when they include a schema contract change.

Do not use workspace-wide cleanup or deletion. Before `aio app undeploy`, compare the generated Integration manifest with the shared inventory and confirm that only Integration-owned packages and registrations will be removed. Checkout must be undeployed independently from its repository. Database collections and retained event metadata are not deleted by either application undeploy; purge is an explicit Integration-owned retention operation.
