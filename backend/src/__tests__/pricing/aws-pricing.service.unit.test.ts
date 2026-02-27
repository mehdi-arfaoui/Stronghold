import assert from 'node:assert/strict';
import test from 'node:test';
import { PricingClient } from '@aws-sdk/client-pricing';
import { fetchAwsPricingProducts } from '../../services/awsPricingService.js';

test('fetchAwsPricingProducts parses boxed String entries from AWS SDK', async () => {
  const originalSend = PricingClient.prototype.send;
  const payload = JSON.stringify({
    serviceCode: 'AmazonEC2',
    terms: { OnDemand: { sample: { priceDimensions: {} } } },
  });

  (PricingClient.prototype as any).send = async () => ({
    PriceList: [new String(payload)],
    NextToken: undefined,
  });

  try {
    const result = await fetchAwsPricingProducts({
      serviceCode: 'AmazonEC2',
      maxResults: 1,
      maxPages: 1,
    });

    assert.equal(result.rawCount, 1);
    assert.equal(result.priceList.length, 1);
    assert.equal(typeof result.priceList[0], 'object');
    assert.equal((result.priceList[0] as any).serviceCode, 'AmazonEC2');
    assert.ok((result.priceList[0] as any).terms?.OnDemand);
  } finally {
    PricingClient.prototype.send = originalSend;
  }
});
