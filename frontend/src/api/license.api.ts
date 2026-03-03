import { api } from './client';
import type { LicenseActivationResponse, LicenseStatus } from '@/types/license';

export const licenseApi = {
  getLicenseStatus: () => api.get<LicenseStatus>('/license/status'),
  activateLicense: (token: string) =>
    api.post<LicenseActivationResponse>('/license/activate', { token }),
};
