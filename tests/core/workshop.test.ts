import { describe, expect, test } from 'bun:test';
import { AxeError } from '../../src/core/errors.ts';
import { getPublishedFileDetails } from '../../src/core/workshop.ts';

const CAPTURED_RESPONSE = {
  response: {
    result: 1,
    resultcount: 1,
    publishedfiledetails: [
      {
        publishedfileid: '3721090132',
        result: 1,
        creator: '76561198010625307',
        creator_app_id: 440900,
        consumer_app_id: 440900,
        title: 'Tot ! Enhanced Sudo 1.3.2',
        description: '...',
        time_created: 1778086209,
        time_updated: 1778205653,
        visibility: 0,
        banned: 0,
        // many other fields the API returns; .passthrough() ignores them
      },
    ],
  },
};

describe('getPublishedFileDetails', () => {
  test('zod-validates captured live response shape', async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify(CAPTURED_RESPONSE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const items = await getPublishedFileDetails([3721090132n], { fetchImpl: fakeFetch });
    expect(items.length).toBe(1);
    const item = items[0];
    if (!item) throw new Error('expected item');
    expect(item.published_file_id).toBe(3721090132n);
    expect(item.title).toBe('Tot ! Enhanced Sudo 1.3.2');
    expect(item.time_updated).toBe(1778205653);
    expect(item.result).toBe(1);
  });

  test('throws AxeError(workshop_api) on non-200 response', async () => {
    const fakeFetch = async () =>
      new Response('upstream error', { status: 503, statusText: 'Service Unavailable' });
    await expect(getPublishedFileDetails([1n], { fetchImpl: fakeFetch })).rejects.toBeInstanceOf(
      AxeError,
    );
  });
});
