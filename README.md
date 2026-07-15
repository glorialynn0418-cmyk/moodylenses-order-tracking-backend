# Order Tracking Backend

This is the backend for the Shopify theme order tracking page.

## What it does

- Receives `POST /apps/order-tracking` from the storefront app proxy.
- Accepts `order_number` and `email`.
- Queries Shopify Admin GraphQL for the order.
- Verifies the submitted email matches the order email.
- Returns tracking numbers and tracking URLs as JSON.

## Setup

1. Copy the environment example:

   ```bash
   cp .env.example .env
   ```

2. Fill in:

   - `SHOPIFY_SHOP_DOMAIN`: `rqxbft-fw.myshopify.com`
   - `SHOPIFY_ADMIN_ACCESS_TOKEN`: Admin API access token with order read scopes
   - `SHOPIFY_APP_PROXY_SECRET`: Shopify app client secret

3. Run locally:

   ```bash
   npm start
   ```

4. Test locally without app proxy signature verification:

   ```bash
   DISABLE_PROXY_SIGNATURE_CHECK=true npm start
   ```

   Then call:

   ```bash
   curl -X POST http://localhost:3000/apps/order-tracking \
     -H 'Content-Type: application/json' \
     -d '{"order_number":"1001","email":"customer@example.com"}'
   ```

## Shopify App Proxy

In the Shopify app settings, configure an app proxy:

- Subpath prefix: `apps`
- Subpath: `order-tracking`
- Proxy URL: your deployed backend URL, for example:

  `https://your-backend.example.com/apps/order-tracking`

The theme page already posts to `/apps/order-tracking`.

## Required Admin API scopes

The GraphQL query was validated against the Shopify Admin schema. It requires order/fulfillment read access, including:

- `read_orders`
- fulfillment order read scopes as required by the app and store setup

If you use a custom app, make sure these scopes are enabled and reinstall the app after changing scopes.
