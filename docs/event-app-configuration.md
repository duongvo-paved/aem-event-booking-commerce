# Event App Storefront Configuration

Event App browser calls are disabled unless the public `config.json` supplies an
explicit, approved `event-app` object.

The values must be generated from the versioned OpenAPI contract for the target
environment. Do not copy action names, paths, methods, or encoding from source code
or Runtime manifests without contract approval.

```json
{
  "event-app": {
    "enabled": true,
    "timeout-ms": 8000,
    "allowed-qr-origins": [
      "https://approved-ticket-runtime.example"
    ],
    "actions": {
      "enrich": {
        "url": "https://approved-runtime.example/approved-enrich-path",
        "method": "POST",
        "encoding": "json-body"
      },
      "detail": {
        "url": "https://approved-runtime.example/approved-detail-path",
        "method": "GET",
        "encoding": "query"
      },
      "create-intent": {
        "url": "https://approved-runtime.example/api/v1/web/booking-api/create-intent",
        "method": "POST",
        "encoding": "json-body"
      },
      "ticket-get": {
        "url": "https://approved-runtime.example/approved-ticket-path",
        "method": "GET",
        "encoding": "query"
      }
    }
  }
}
```

Supported action encoding values:

- `json-body`: JSON request body with `Content-Type: application/json`.
- `query`: URL query parameters. Array values are encoded as repeated parameters.

Only HTTPS URLs are accepted. `GET` actions must use `query` encoding. The
configuration must remain disabled until:

1. Integration and EDS owners approve the versioned OpenAPI document.
2. DevOps/Security approve the exact EDS origin allowlist.
3. Contract and browser CORS tests pass against the deployed environment.
4. Commerce exposes and tests the event catalog and cart/order correlation fields.
5. Ticket lookup returns the strict public projection without `intent_ref` and with
   approved HTTPS `qr_render_url` values.

The approved `create-intent` contract must include `commerce_cart_id` and
`commerce_sku`. Integration must enforce one active intent for that pair:

- the same `source_request_id` returns the original intent with HTTP `200`;
- a different request for an active pair returns HTTP `409` with
  `BOOKING_ALREADY_EXISTS`; and
- a new pair returns HTTP `201`.

This server-side uniqueness contract is required because browser checks cannot
prevent concurrent requests from different tabs or devices.

Never place IMS credentials, Database credentials, SendGrid keys, QR secrets,
participant data, booking references, intent references, or ticket references in
this public configuration.
