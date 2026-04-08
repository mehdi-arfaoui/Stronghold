export {
  DEFAULT_HISTORY_RETENTION_LIMIT,
  FileHistoryStore,
  buildFindingKey,
  buildScanSnapshot,
} from './history-store.js';

export {
  FileFindingLifecycleStore,
  collectTrackedFindings,
  parseFindingKey,
  trackFindings,
  type TrackFindingsOptions,
} from './finding-tracker.js';

export {
  applyDebtToSnapshot,
  calculateServiceDebt,
  type FindingDebt,
  type ServiceDebt,
} from './debt-calculator.js';

export {
  analyzeTrend,
} from './trend-analyzer.js';

export type {
  BuildScanSnapshotInput,
  HistoryQueryOptions,
  HistoryStore,
  ScanSnapshot,
  ServiceSnapshot,
} from './history-types.js';

export type {
  FindingLifecycle,
  FindingLifecycleDelta,
  FindingLifecycleStore,
  FindingStatus,
  StoredFindingLifecycle,
  TrackedFinding,
} from './finding-lifecycle-types.js';

export type {
  HighlightType,
  PostureTrend,
  ServiceTrend,
  TrendDirection,
  TrendHighlight,
  TrendPoint,
} from './trend-types.js';
