import { api } from './client';

export interface DashboardLayoutItem {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const dashboardApi = {
  getConfig: () =>
    api.get<DashboardLayoutItem[]>('/dashboard/config'),

  saveConfig: (layout: DashboardLayoutItem[]) =>
    api.put<{ layout: DashboardLayoutItem[] }>('/dashboard/config', { layout }),
};
