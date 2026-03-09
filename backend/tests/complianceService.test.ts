import assert from "node:assert/strict";
import test from "node:test";
import {
  ComplianceService,
  UnknownComplianceFrameworkError,
} from "../src/services/compliance/complianceService.js";
import type { ComplianceStatus } from "../src/services/compliance/types.js";

const TENANT_ID = "tenant-compliance-tests";

type MethodKey =
  | "bIAReport2.findFirst"
  | "businessProcess.count"
  | "graphAnalysis.findFirst"
  | "infraNode.findMany"
  | "infraNode.count"
  | "businessFlow.count"
  | "exercise.count"
  | "pRAExercise.count"
  | "scanSchedule.count"
  | "discoverySchedule.count"
  | "driftSchedule.findUnique"
  | "infraEdge.count";

type MockState = {
  biaReport: {
    processes: Array<{
      validationStatus?: string;
      suggestedRTO?: number | null;
      suggestedRPO?: number | null;
      validatedRTO?: number | null;
      validatedRPO?: number | null;
    }>;
  } | null;
  businessProcessCount: number;
  graphAnalysis: { spofCount: number; totalNodes: number } | null;
  infraNodeMetadatas: unknown[];
  infraNodeCount: number;
  businessFlowCount: number;
  exerciseCompletedCount: number;
  exerciseTotalCount: number;
  praExerciseCompletedCount: number;
  praExerciseTotalCount: number;
  scanScheduleActiveCount: number;
  scanScheduleTotalCount: number;
  discoveryScheduleActiveCount: number;
  discoveryScheduleTotalCount: number;
  driftSchedule: { enabled: boolean } | null;
  infraEdgeCount: number;
  throwByMethod: Partial<Record<MethodKey, Error>>;
};

function recommendationMetadata(status: "pending" | "validated" | "rejected") {
  return {
    landingZoneRecommendation: {
      status,
      notes: null,
      updatedAt: null,
      history: [],
    },
  };
}

function createMockState(overrides: Partial<MockState> = {}): MockState {
  return {
    biaReport: null,
    businessProcessCount: 0,
    graphAnalysis: null,
    infraNodeMetadatas: [],
    infraNodeCount: 0,
    businessFlowCount: 0,
    exerciseCompletedCount: 0,
    exerciseTotalCount: 0,
    praExerciseCompletedCount: 0,
    praExerciseTotalCount: 0,
    scanScheduleActiveCount: 0,
    scanScheduleTotalCount: 0,
    discoveryScheduleActiveCount: 0,
    discoveryScheduleTotalCount: 0,
    driftSchedule: null,
    infraEdgeCount: 0,
    throwByMethod: {},
    ...overrides,
    throwByMethod: {
      ...(overrides.throwByMethod ?? {}),
    },
  };
}

function createHarness(overrides: Partial<MockState> = {}) {
  const state = createMockState(overrides);

  const maybeThrow = (method: MethodKey) => {
    const error = state.throwByMethod[method];
    if (error) {
      throw error;
    }
  };

  const prismaMock = {
    bIAReport2: {
      findFirst: async () => {
        maybeThrow("bIAReport2.findFirst");
        return state.biaReport;
      },
    },
    businessProcess: {
      count: async () => {
        maybeThrow("businessProcess.count");
        return state.businessProcessCount;
      },
    },
    graphAnalysis: {
      findFirst: async () => {
        maybeThrow("graphAnalysis.findFirst");
        return state.graphAnalysis;
      },
    },
    infraNode: {
      findMany: async () => {
        maybeThrow("infraNode.findMany");
        return state.infraNodeMetadatas.map((metadata) => ({ metadata }));
      },
      count: async () => {
        maybeThrow("infraNode.count");
        return state.infraNodeCount;
      },
    },
    businessFlow: {
      count: async () => {
        maybeThrow("businessFlow.count");
        return state.businessFlowCount;
      },
    },
    exercise: {
      count: async (args?: { where?: { status?: string } }) => {
        maybeThrow("exercise.count");
        if (args?.where?.status === "COMPLETED") {
          return state.exerciseCompletedCount;
        }
        return state.exerciseTotalCount;
      },
    },
    pRAExercise: {
      count: async (args?: { where?: { status?: string } }) => {
        maybeThrow("pRAExercise.count");
        if (args?.where?.status === "completed") {
          return state.praExerciseCompletedCount;
        }
        return state.praExerciseTotalCount;
      },
    },
    scanSchedule: {
      count: async (args?: { where?: { isActive?: boolean } }) => {
        maybeThrow("scanSchedule.count");
        if (args?.where?.isActive) {
          return state.scanScheduleActiveCount;
        }
        return state.scanScheduleTotalCount;
      },
    },
    discoverySchedule: {
      count: async (args?: { where?: { active?: boolean } }) => {
        maybeThrow("discoverySchedule.count");
        if (args?.where?.active) {
          return state.discoveryScheduleActiveCount;
        }
        return state.discoveryScheduleTotalCount;
      },
    },
    driftSchedule: {
      findUnique: async () => {
        maybeThrow("driftSchedule.findUnique");
        return state.driftSchedule;
      },
    },
    infraEdge: {
      count: async () => {
        maybeThrow("infraEdge.count");
        return state.infraEdgeCount;
      },
    },
  } as any;

  return {
    state,
    service: new ComplianceService(prismaMock),
  };
}

async function runAtomicCheck(service: ComplianceService, checkName: string) {
  return (service as any).evaluateCheck(checkName, TENANT_ID) as Promise<{
    status: ComplianceStatus;
    details: string;
  }>;
}

function getRequirementStatus(
  report: Awaited<ReturnType<ComplianceService["evaluate"]>>,
  requirementId: string,
): ComplianceStatus {
  const check = report.checks.find((entry) => entry.requirementId === requirementId);
  assert.ok(check, `Requirement ${requirementId} not found`);
  return check.status;
}

function createScoringService(checkStatuses: Record<string, ComplianceStatus>) {
  const { service } = createHarness();
  const target = service as any;

  target.loadFramework = async () => ({
    id: "custom",
    name: "Custom Framework",
    description: "Custom scoring test",
    version: "test",
    requirements: [
      { id: "r1", clause: "1", title: "R1", description: "", dataSource: "bia", check: "c1", weight: 2 },
      { id: "r2", clause: "2", title: "R2", description: "", dataSource: "bia", check: "c2", weight: 2 },
      { id: "r3", clause: "3", title: "R3", description: "", dataSource: "bia", check: "c3", weight: 2 },
    ],
  });

  target.evaluateCheck = async (checkName: string) => ({
    status: checkStatuses[checkName] ?? "non_compliant",
    details: `mocked ${checkName}`,
  });

  return service;
}

// ---------------------------------------------------------------------------
// 1) Checks atomiques
// ---------------------------------------------------------------------------

test("biaCompleted returns compliant when BIA has validated processes", async () => {
  const { service } = createHarness({
    biaReport: {
      processes: [{ validationStatus: "validated" }],
    },
  });

  const result = await runAtomicCheck(service, "biaCompleted");
  assert.equal(result.status, "compliant");
});

test("biaCompleted returns partial when BIA exists but none is validated", async () => {
  const { service } = createHarness({
    biaReport: {
      processes: [{ validationStatus: "pending" }],
    },
  });

  const result = await runAtomicCheck(service, "biaCompleted");
  assert.equal(result.status, "partial");
});

test("biaCompleted returns non_compliant when no BIA exists", async () => {
  const { service } = createHarness();
  const result = await runAtomicCheck(service, "biaCompleted");
  assert.equal(result.status, "non_compliant");
});

test("biaCompleted returns unavailable when underlying service throws", async () => {
  const { service } = createHarness({
    throwByMethod: {
      "bIAReport2.findFirst": new Error("BIA service down"),
    },
  });

  const result = await runAtomicCheck(service, "biaCompleted");
  assert.equal(result.status, "unavailable");
  assert.match(result.details, /BIA service down/i);
});

test("spofIdentified returns compliant when SPOFs are found", async () => {
  const { service } = createHarness({
    graphAnalysis: { spofCount: 3, totalNodes: 12 },
  });

  const result = await runAtomicCheck(service, "spofIdentified");
  assert.equal(result.status, "compliant");
});

test("spofIdentified returns compliant when analysis exists with 0 SPOF", async () => {
  const { service } = createHarness({
    graphAnalysis: { spofCount: 0, totalNodes: 8 },
  });

  const result = await runAtomicCheck(service, "spofIdentified");
  assert.equal(result.status, "compliant");
});

test("spofIdentified returns non_compliant when no analysis exists", async () => {
  const { service } = createHarness();
  const result = await runAtomicCheck(service, "spofIdentified");
  assert.equal(result.status, "non_compliant");
});

test("recommendationsAccepted returns compliant when >= 50% are accepted", async () => {
  const { service } = createHarness({
    infraNodeMetadatas: [
      recommendationMetadata("validated"),
      recommendationMetadata("validated"),
      recommendationMetadata("pending"),
    ],
  });

  const result = await runAtomicCheck(service, "recommendationsAccepted");
  assert.equal(result.status, "compliant");
});

test("recommendationsAccepted returns partial when < 50% but > 0 are accepted", async () => {
  const { service } = createHarness({
    infraNodeMetadatas: [
      recommendationMetadata("validated"),
      recommendationMetadata("pending"),
      recommendationMetadata("rejected"),
      recommendationMetadata("pending"),
    ],
  });

  const result = await runAtomicCheck(service, "recommendationsAccepted");
  assert.equal(result.status, "partial");
});

test("recommendationsAccepted returns non_compliant when 0 are accepted", async () => {
  const { service } = createHarness({
    infraNodeMetadatas: [
      recommendationMetadata("pending"),
      recommendationMetadata("rejected"),
    ],
  });

  const result = await runAtomicCheck(service, "recommendationsAccepted");
  assert.equal(result.status, "non_compliant");
});

test("recommendationsAccepted returns non_compliant when there is no recommendation", async () => {
  const { service } = createHarness();
  const result = await runAtomicCheck(service, "recommendationsAccepted");
  assert.equal(result.status, "non_compliant");
});

test("exerciseCompleted returns compliant when at least one exercise is completed", async () => {
  const { service } = createHarness({
    exerciseCompletedCount: 1,
    exerciseTotalCount: 1,
  });

  const result = await runAtomicCheck(service, "exerciseCompleted");
  assert.equal(result.status, "compliant");
});

test("exerciseCompleted returns non_compliant when there is no exercise", async () => {
  const { service } = createHarness();
  const result = await runAtomicCheck(service, "exerciseCompleted");
  assert.equal(result.status, "non_compliant");
});

test("scheduledScanActive returns compliant when an active schedule exists", async () => {
  const { service } = createHarness({
    scanScheduleActiveCount: 1,
  });

  const result = await runAtomicCheck(service, "scheduledScanActive");
  assert.equal(result.status, "compliant");
});

test("scheduledScanActive returns non_compliant when there is no scan schedule", async () => {
  const { service } = createHarness();
  const result = await runAtomicCheck(service, "scheduledScanActive");
  assert.equal(result.status, "non_compliant");
});

test("driftDetectionActive returns compliant when drift is active", async () => {
  const { service } = createHarness({
    driftSchedule: { enabled: true },
  });

  const result = await runAtomicCheck(service, "driftDetectionActive");
  assert.equal(result.status, "compliant");
});

test("driftDetectionActive returns partial when drift is not configured", async () => {
  const { service } = createHarness({
    driftSchedule: null,
  });

  const result = await runAtomicCheck(service, "driftDetectionActive");
  assert.equal(result.status, "partial");
});

test("incidentProcessDefined returns unavailable when incident module is absent", async () => {
  const { service } = createHarness();
  const result = await runAtomicCheck(service, "incidentProcessDefined");
  assert.equal(result.status, "unavailable");
});

// ---------------------------------------------------------------------------
// 2) Checks composites (post-traitement)
// ---------------------------------------------------------------------------

test("biaAndDrPlansInPlace => compliant (BIA compliant + recos compliant)", async () => {
  const { service } = createHarness({
    biaReport: { processes: [{ validationStatus: "validated" }] },
    infraNodeMetadatas: [
      recommendationMetadata("validated"),
      recommendationMetadata("validated"),
    ],
  });

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2c"), "compliant");
});

test("biaAndDrPlansInPlace => partial (BIA partial + recos compliant)", async () => {
  const { service } = createHarness({
    biaReport: { processes: [{ validationStatus: "pending" }] },
    infraNodeMetadatas: [
      recommendationMetadata("validated"),
      recommendationMetadata("validated"),
    ],
  });

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2c"), "partial");
});

test("biaAndDrPlansInPlace => non_compliant (both non compliant)", async () => {
  const { service } = createHarness();
  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2c"), "non_compliant");
});

test("drPlansValidated => compliant (recos compliant + exercises compliant)", async () => {
  const { service } = createHarness({
    infraNodeMetadatas: [
      recommendationMetadata("validated"),
      recommendationMetadata("validated"),
    ],
    exerciseCompletedCount: 1,
    exerciseTotalCount: 1,
  });

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2j"), "compliant");
});

test("drPlansValidated => partial (recos compliant + exercises non compliant)", async () => {
  const { service } = createHarness({
    infraNodeMetadatas: [
      recommendationMetadata("validated"),
      recommendationMetadata("validated"),
    ],
  });

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2j"), "partial");
});

test("drPlansValidated => non_compliant (recos non compliant)", async () => {
  const { service } = createHarness();
  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2j"), "non_compliant");
});

test("vulnerabilityManagement => compliant (scans compliant + drift compliant)", async () => {
  const { service } = createHarness({
    scanScheduleActiveCount: 1,
    driftSchedule: { enabled: true },
  });

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2e"), "compliant");
});

test("vulnerabilityManagement => partial (scans compliant + drift partial)", async () => {
  const { service } = createHarness({
    scanScheduleActiveCount: 1,
    driftSchedule: { enabled: false },
  });

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2e"), "partial");
});

test("vulnerabilityManagement => non_compliant (scans non compliant)", async () => {
  const { service } = createHarness();

  (service as any).evaluateCheck = async (checkName: string) => {
    if (checkName === "scheduledScanActive" || checkName === "driftDetectionActive") {
      return {
        status: "non_compliant" as const,
        details: `${checkName} mocked as non_compliant`,
      };
    }

    return {
      status: "compliant" as const,
      details: `${checkName} mocked as compliant`,
    };
  };

  const report = await service.evaluate("nis2", TENANT_ID);
  assert.equal(getRequirementStatus(report, "art21-2e"), "non_compliant");
});

// ---------------------------------------------------------------------------
// 3) Scoring global
// ---------------------------------------------------------------------------

test("score excludes unavailable requirements from effective max", async () => {
  const service = createScoringService({
    c1: "compliant",
    c2: "non_compliant",
    c3: "unavailable",
  });

  const report = await service.evaluate("custom", TENANT_ID);
  assert.equal(report.totalPoints, 2);
  assert.equal(report.maxPoints, 4);
  assert.equal(report.overallScore, 50);
});

test("score is 100% when all requirements are compliant", async () => {
  const service = createScoringService({
    c1: "compliant",
    c2: "compliant",
    c3: "compliant",
  });

  const report = await service.evaluate("custom", TENANT_ID);
  assert.equal(report.overallScore, 100);
});

test("score handles partial status (1 compliant + 1 partial => 75%)", async () => {
  const service = createScoringService({
    c1: "compliant",
    c2: "partial",
    c3: "unavailable",
  });

  const report = await service.evaluate("custom", TENANT_ID);
  assert.equal(report.totalPoints, 3);
  assert.equal(report.maxPoints, 4);
  assert.equal(report.overallScore, 75);
});

// ---------------------------------------------------------------------------
// 4) Gestion des erreurs
// ---------------------------------------------------------------------------

test("all underlying services throwing returns 0% without crashing", async () => {
  const fatal = new Error("service unavailable");
  const { service } = createHarness({
    throwByMethod: {
      "bIAReport2.findFirst": fatal,
      "businessProcess.count": fatal,
      "graphAnalysis.findFirst": fatal,
      "infraNode.findMany": fatal,
      "businessFlow.count": fatal,
      "exercise.count": fatal,
      "pRAExercise.count": fatal,
      "scanSchedule.count": fatal,
      "discoverySchedule.count": fatal,
      "driftSchedule.findUnique": fatal,
    },
  });

  const report = await service.evaluate("iso22301", TENANT_ID);
  assert.equal(report.overallScore, 0);
  assert.ok(report.checks.every((entry) => entry.status === "unavailable"));
});

// ---------------------------------------------------------------------------
// 5) Disclaimer / metadata
// ---------------------------------------------------------------------------

test("report always includes a non-empty disclaimer", async () => {
  const { service } = createHarness();
  const report = await service.evaluate("iso22301", TENANT_ID);
  assert.ok(report.disclaimer.trim().length > 0);
});

test("frameworkVersion is populated for iso22301 and nis2", async () => {
  const { service } = createHarness();
  const iso = await service.evaluate("iso22301", TENANT_ID);
  const nis2 = await service.evaluate("nis2", TENANT_ID);

  assert.match(iso.frameworkVersion, /2019/);
  assert.match(nis2.frameworkVersion, /2022/);
});

test("unknown framework throws a managed error", async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.evaluate("pci-dss", TENANT_ID),
    (error: unknown) => error instanceof UnknownComplianceFrameworkError,
  );
});
