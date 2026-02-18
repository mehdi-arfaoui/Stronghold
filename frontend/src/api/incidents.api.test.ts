import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, postMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('./client', () => ({
  api: {
    get: getMock,
    post: postMock,
    patch: patchMock,
  },
}));

import { incidentsApi } from './incidents.api';

function axiosResponse<T>(data: T) {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} },
  } as any;
}

describe('incidentsApi', () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
  });

  it('normalizes backend incident payloads with missing affectedNodes', async () => {
    getMock.mockResolvedValue(
      axiosResponse([
        {
          id: 'inc-1',
          title: 'Database outage',
          description: null,
          status: 'OPEN',
          detectedAt: '2026-02-18T10:00:00.000Z',
          services: [{ serviceId: 'svc-1' }],
          actions: [],
        },
      ])
    );

    const response = await incidentsApi.getAll();

    expect(response.data).toHaveLength(1);
    expect(response.data[0].status).toBe('open');
    expect(response.data[0].severity).toBe('medium');
    expect(response.data[0].affectedNodes).toEqual(['svc-1']);
  });

  it('sends status in uppercase for backend compatibility', async () => {
    postMock.mockResolvedValue(
      axiosResponse({
        id: 'inc-2',
        title: 'Incident test',
        description: 'desc',
        status: 'OPEN',
        severity: 'HIGH',
        affectedNodes: ['n1'],
        createdAt: '2026-02-18T10:00:00.000Z',
        actions: [],
      })
    );

    await incidentsApi.create({
      title: 'Incident test',
      status: 'open',
    } as any);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][1]).toMatchObject({ status: 'OPEN' });
  });
});
