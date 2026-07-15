import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  buildOrderSearchQuery,
  buildTrackingResponse,
  isTrackingPath,
  normalizeShopDomain,
  verifyAppProxySignature
} from './server.mjs';

test('normalizes shop domains', () => {
  assert.equal(normalizeShopDomain('https://rqxbft-fw.myshopify.com/admin'), 'rqxbft-fw.myshopify.com');
});

test('matches expected tracking paths', () => {
  assert.equal(isTrackingPath('/apps/order-tracking'), true);
  assert.equal(isTrackingPath('/order-tracking'), true);
  assert.equal(isTrackingPath('/apps/other'), false);
});

test('builds order search query from bare order number', () => {
  assert.equal(buildOrderSearchQuery('1001'), 'name:#1001');
});

test('builds tracking response from fulfillments', () => {
  const response = buildTrackingResponse({
    id: 'gid://shopify/Order/1',
    name: '#1001',
    email: 'customer@example.com',
    createdAt: '2026-07-14T00:00:00Z',
    displayFulfillmentStatus: 'FULFILLED',
    fulfillments: [
      {
        status: 'SUCCESS',
        trackingInfo: [
          {
            company: 'UPS',
            number: '1Z999',
            url: 'https://example.com/track'
          }
        ]
      }
    ]
  });

  assert.equal(response.found, true);
  assert.equal(response.tracking[0].company, 'UPS');
  assert.equal(response.tracking[0].number, '1Z999');
});

test('verifies app proxy signature', () => {
  const secret = 'secret';
  const message = 'path_prefix=/apps/order-trackingshop=rqxbft-fw.myshopify.comtimestamp=1783990000';
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const url = new URL(`https://example.com/apps/order-tracking?shop=rqxbft-fw.myshopify.com&path_prefix=/apps/order-tracking&timestamp=1783990000&signature=${signature}`);

  assert.equal(verifyAppProxySignature(url, secret), true);
});
