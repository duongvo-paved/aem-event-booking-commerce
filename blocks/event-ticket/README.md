# Event Ticket Block

## Purpose

The Event Ticket block renders the allowlisted public booking and ticket
projection reached from an emailed hosted link. It accepts only the
`booking_ref` URL parameter and never accepts an order number, intent reference,
participant data, Runtime endpoint, or QR value from authored content.

Building new because: no existing project block performs a public non-Commerce
booking lookup or renders booking status and backend-generated QR images.

## Content Structure

```text
| Event Ticket |
|--------------|
| Optional heading |
| Optional introductory text |
| Optional support link |
```

Data begins immediately after the block-name row; authors must not add a second
header row.

## Rows

1. **Heading** (optional): Rich text heading shown before ticket status.
2. **Introduction** (optional): Short explanatory content.
3. **Support link** (optional): A support message or link shown after the result.

Extra rows are ignored. Missing rows do not prevent the lookup UI from rendering.

## Variants

- **default**: Booking summary followed by responsive ticket cards.

## Runtime Behavior

- Reads `booking_ref` only from the current URL.
- Requires a high-entropy base64url-style reference.
- Uses environment-level Event App action configuration; endpoints are not
  authored.
- Rejects responses with fields outside the approved public booking/ticket
  projection.
- Requires each QR render URL to use HTTPS and an approved configured origin.
- Adds `referrerpolicy="no-referrer"` to QR images so the hosted page URL is not
  sent to the QR endpoint.
- Does not log, persist, parse, transform, or send booking/ticket/QR values to
  analytics.

## Contract Gate

Live ticket lookup must remain disabled until Integration deploys the versioned
projection without `intent_ref`, supplies opaque HTTPS `qr_render_url` values, and
passes contract, security, and browser CORS tests.
