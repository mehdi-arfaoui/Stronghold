import assert from 'node:assert/strict';
import test from 'node:test';

import { paginateAws } from '../src/services/discoveryCloudConnectors.ts';

test('paginateAws concatenates all AWS pages until the next token disappears', async () => {
  const receivedTokens: Array<string | undefined> = [];

  const result = await paginateAws(
    async (nextToken?: string) => {
      receivedTokens.push(nextToken);

      if (!nextToken) {
        return {
          items: ['ec2-a', 'ec2-b'],
          nextToken: 'page-2',
        };
      }

      if (nextToken === 'page-2') {
        return {
          items: ['ec2-c'],
          nextToken: 'page-3',
        };
      }

      return {
        items: ['ec2-d', 'ec2-e'],
        nextToken: undefined,
      };
    },
    (response) => response.items,
    (response) => response.nextToken,
    'EC2'
  );

  assert.deepEqual(receivedTokens, [undefined, 'page-2', 'page-3']);
  assert.deepEqual(result, ['ec2-a', 'ec2-b', 'ec2-c', 'ec2-d', 'ec2-e']);
});
