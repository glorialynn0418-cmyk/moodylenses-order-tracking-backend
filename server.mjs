import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_ADMIN_API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION || '2026-07';
const SHOPIFY_SHOP_DOMAIN = normalizeShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || '');
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
const SHOPIFY_APP_PROXY_SECRET = process.env.SHOPIFY_APP_PROXY_SECRET || '';
const DISABLE_PROXY_SIGNATURE_CHECK = process.env.DISABLE_PROXY_SIGNATURE_CHECK === 'true';

const ORDER_TRACKING_QUERY = `#graphql
  query OrderTracking($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        name
        email
        customer {
          email
        }
        createdAt
        displayFulfillmentStatus
        fulfillments(first: 10) {
          status
          trackingInfo(first: 10) {
            company
            number
            url
          }
        }
      }
    }
  }
`;

const server = http.createServer(async (request, response) => {
  try {
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      return sendJson(response, 204, null);
    }

    const requestUrl = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      return sendJson(response, 200, { ok: true });
    }

    if (!isTrackingPath(requestUrl.pathname)) {
      return sendJson(response, 404, { error: true, message: 'Not found' });
    }

    if (request.method !== 'POST') {
      return sendJson(response, 405, { error: true, message: 'Method not allowed' });
    }

    assertConfigured();

    if (!DISABLE_PROXY_SIGNATURE_CHECK && !verifyAppProxySignature(requestUrl, SHOPIFY_APP_PROXY_SECRET)) {
      return sendJson(response, 401, { error: true, message: 'Unauthorized request' });
    }

    const body = await readJsonBody(request);
    const orderNumber = String(body.order_number || '').trim();
    const email = String(body.email || '').trim().toLowerCase();

    if (!orderNumber || !email || !email.includes('@')) {
      return sendJson(response, 400, {
        error: true,
        message: 'Enter a valid order number and email address.'
      });
    }

    const order = await findOrderByNumberAndEmail(orderNumber, email);

    if (!order) {
      return sendJson(response, 200, {
        found: false,
        message: 'We could not find an order matching that order number and email.'
      });
    }

    return sendJson(response, 200, buildTrackingResponse(order));
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, {
      error: true,
      message: 'We could not look up this order right now. Please try again later.'
    });
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Order tracking backend listening on port ${PORT}`);
  });
}

export {
  ORDER_TRACKING_QUERY,
  buildOrderSearchQuery,
  buildOrderSearchQueries,
  buildTrackingResponse,
  findOrderByNumberAndEmail,
  isTrackingPath,
  normalizeShopDomain,
  server,
  verifyAppProxySignature
};

function assertConfigured() {
  const missing = [];

  if (!SHOPIFY_SHOP_DOMAIN) missing.push('SHOPIFY_SHOP_DOMAIN');
  if (!SHOPIFY_ADMIN_ACCESS_TOKEN) missing.push('SHOPIFY_ADMIN_ACCESS_TOKEN');
  if (!DISABLE_PROXY_SIGNATURE_CHECK && !SHOPIFY_APP_PROXY_SECRET) {
    missing.push('SHOPIFY_APP_PROXY_SECRET');
  }

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

function isTrackingPath(pathname) {
  return pathname === '/apps/order-tracking' || pathname === '/order-tracking';
}

function normalizeShopDomain(domain) {
  return String(domain)
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

function buildOrderSearchQuery(orderNumber) {
  return buildOrderSearchQueries(orderNumber)[0];
}

function buildOrderSearchQueries(orderNumber) {
  const trimmed = String(orderNumber).trim();
  const candidates = trimmed.startsWith('#') || !/^\d+$/.test(trimmed)
    ? [trimmed]
    : [`#${trimmed}`, trimmed];

  return candidates.map((candidate) => `name:${escapeSearchValue(candidate)}`);
}

function escapeSearchValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function findOrderByNumberAndEmail(orderNumber, email) {
  for (const query of buildOrderSearchQueries(orderNumber)) {
    const data = await shopifyGraphql(ORDER_TRACKING_QUERY, { query });

    const orders = data?.orders?.nodes || [];
    const matchingOrder = orders.find((order) => orderMatchesEmail(order, email));

    if (matchingOrder) return matchingOrder;
  }

  return null;
}

async function shopifyGraphql(query, variables) {
  const endpoint = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN
    },
    body: JSON.stringify({ query, variables })
  });

  const payload = await response.json();

  if (!response.ok || payload.errors) {
    throw new Error(JSON.stringify(payload.errors || payload));
  }

  return payload.data;
}

function buildTrackingResponse(order) {
  const tracking = [];

  for (const fulfillment of order.fulfillments || []) {
    for (const info of fulfillment.trackingInfo || []) {
      if (!info.number && !info.url) continue;

      tracking.push({
        company: info.company || '',
        number: info.number || '',
        url: info.url || '',
        fulfillment_status: fulfillment.status || ''
      });
    }
  }

  return {
    found: true,
    order: {
      id: order.id,
      name: order.name,
      order_number: order.name,
      email: getOrderEmails(order)[0] || '',
      created_at: order.createdAt,
      status: order.displayFulfillmentStatus,
      fulfillment_status: order.displayFulfillmentStatus,
      tracking
    },
    tracking
  };
}

function orderMatchesEmail(order, email) {
  return getOrderEmails(order).includes(String(email || '').toLowerCase());
}

function getOrderEmails(order) {
  return [
    order.email,
    order.customer?.email
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
}

function verifyAppProxySignature(requestUrl, secret) {
  const signature = requestUrl.searchParams.get('signature');

  if (!signature || !secret) {
    return false;
  }

  const params = [];

  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (key === 'signature') continue;
    params.push([key, value]);
  }

  params.sort(([a], [b]) => a.localeCompare(b));

  const message = params.map(([key, value]) => `${key}=${value}`).join('');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');

  return safeEqual(signature, digest);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > 1024 * 64) {
      throw new Error('Request body too large');
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;

  if (statusCode === 204) {
    response.end();
    return;
  }

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}
