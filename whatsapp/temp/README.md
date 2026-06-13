# TRANCHE WhatsApp Ordering App

Initial MVP framework for a menu-driven WhatsApp ordering flow using the Meta WhatsApp Cloud API.

## What Exists Now

- WhatsApp webhook verification at `GET /webhooks/whatsapp`
- Inbound message webhook at `POST /webhooks/whatsapp`
- Deterministic menu flow started by `hi` or website-style messages beginning with `hi`
- Category, item, quantity, pickup/delivery, cutoff warning, confirmation, and UPI screenshot steps
- Feedback capture
- JSON-backed local development storage
- Placeholder catalog seeded from the current static website
- Internal admin page at `/admin`
- Manual payment approval action for screenshots needing review

## Run Locally

```powershell
copy .env.example .env
npm.cmd start
```

Then open:

```text
http://localhost:3001/admin
```

Health check:

```text
http://localhost:3001/health
```

## Local Message Testing

You can simulate incoming WhatsApp text messages with:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/dev/inbound -ContentType "application/json" -Body '{"from":"919999999999","text":"hi"}'
```

In development mode, outgoing WhatsApp replies are printed to the terminal unless Meta credentials are configured.

## Meta Setup Notes

Configure the webhook callback URL in Meta as:

```text
https://your-public-domain.com/webhooks/whatsapp
```

Use the same token as `WHATSAPP_VERIFY_TOKEN`.

Required environment variables for sending real messages:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_VERIFY_TOKEN`

## Data Model Direction

The local JSON store mirrors the intended entities from `requirements.md`:

- `customers`
- `orders`
- `payments`
- `paymentScreenshots`
- `feedback`
- `whatsappConversations`
- `menuCategories`
- `menuItems`

When pricing and deployment are finalized, replace `JsonStore` with a database-backed repository while keeping the conversation service mostly unchanged.

## Catalog Notes

Prices are currently set to `0` paise, so summaries say `Price to be confirmed`. Once pricing is ready, update `src/catalog/seed.js` or migrate the catalog into the database.
