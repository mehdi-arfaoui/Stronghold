import { api } from './client';
import type { Risk } from '@/types/risks.types';

export const risksApi = {
  getRisks: () =>
    api.get<Risk[]>('/risks'),

  getRisk: (id: string) =>
    api.get<Risk>(`/risks/${id}`),

  updateMitigationStatus: (riskId: string, mitigationId: string, status: string) =>
    api.patch(`/risks/${riskId}/mitigations/${mitigationId}`, { status }),
};
