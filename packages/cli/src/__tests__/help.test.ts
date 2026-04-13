import { describe, expect, it } from "vitest";
import {
  generateRecommendations,
  selectTopRecommendations,
} from "@stronghold-dr/core";

import { createProgram } from "../index.js";
import {
  renderRecommendationHighlights,
  renderRecommendationSection,
} from "../output/recommendations.js";
import { renderTerminalReport } from "../output/report-renderer.js";
import { renderScanSummary } from "../output/scan-summary.js";
import { createDemoResults } from "./test-utils.js";

describe("CLI help output", () => {
  it("stronghold --help lists the top-level commands", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("init");
    expect(help).toContain("scan");
    expect(help).toContain("report");
    expect(help).toContain("graph");
    expect(help).toContain("plan");
    expect(help).toContain("drift");
    expect(help).toContain("evidence");
    expect(help).toContain("history");
    expect(help).toContain("overrides");
    expect(help).toContain("demo");
    expect(help).toContain("iam-policy");
    expect(help).toContain("scenarios");
    expect(help).toContain("services");
    expect(help).toContain("status");
  });

  it("stronghold plan --help lists generate, validate, and runbook", () => {
    const planCommand = createProgram().commands.find(
      (command) => command.name() === "plan",
    );
    const help = planCommand?.helpInformation() ?? "";

    expect(help).toContain("generate");
    expect(help).toContain("validate");
    expect(help).toContain("runbook");
  });

  it("stronghold scan --help lists account and auth options", () => {
    const scanCommand = createProgram().commands.find(
      (command) => command.name() === "scan",
    );
    const help = scanCommand?.helpInformation() ?? "";

    expect(help).toContain("--account");
    expect(help).toContain("--profile");
    expect(help).toContain("--role-arn");
    expect(help).toContain("--external-id");
  });

  it("stronghold report --help lists evidence-related flags", () => {
    const reportCommand = createProgram().commands.find(
      (command) => command.name() === "report",
    );
    const help = reportCommand?.helpInformation() ?? "";

    expect(help).toContain("--show-passed");
    expect(help).toContain("--show-resolved");
    expect(help).toContain("--explain-score");
  });
});

describe("CLI rendered output", () => {
  it("scan summary suggests the runbook command after saving results", async () => {
    const results = await createDemoResults("startup");
    const summary = renderScanSummary(results, {
      savedPath: ".stronghold/latest-scan.json",
    });

    expect(summary).toContain("stronghold plan runbook");
    expect(summary).toContain("stronghold services list");
  });

  it("terminal report includes the scoring disclaimer", async () => {
    const results = await createDemoResults("startup");
    const report = renderTerminalReport(results.validationReport, {});

    expect(report).toContain(
      results.validationReport.scoreBreakdown.disclaimer,
    );
  });

  it("terminal report surfaces evidence lines and score explanation", async () => {
    const results = await createDemoResults("startup");
    const report = renderTerminalReport(results.validationReport, {
      showPassed: true,
      explainScore: true,
    });

    expect(report).toContain("Evidence Maturity");
    expect(report).toContain("Evidence:");
    expect(report).toContain("Verified Controls");
    expect(report).toContain("Score Decomposition");
  });

  it("demo results render a top recommendations block", async () => {
    const results = await createDemoResults("startup");
    const recommendations = generateRecommendations({
      nodes: results.nodes,
      validationReport: results.validationReport,
      drpPlan: results.drpPlan,
      isDemo: true,
    });
    const rendered = renderRecommendationHighlights(
      selectTopRecommendations(recommendations),
      results.validationReport.score,
      "stronghold report",
      recommendations.length,
    );

    expect(rendered).toContain("Top Recommendations");
    expect(rendered).toContain("stronghold report");
  });

  it("markdown output includes a recommendations section", async () => {
    const results = await createDemoResults("startup");
    const recommendations = generateRecommendations({
      nodes: results.nodes,
      validationReport: results.validationReport,
      drpPlan: results.drpPlan,
      isDemo: true,
    });
    const rendered = renderRecommendationSection(
      recommendations,
      results.validationReport.score,
      "markdown",
    );

    expect(rendered).toContain("## Recommendations");
    expect(rendered).toContain("### Safe");
  });

  it("scan summary includes evidence distribution", async () => {
    const results = await createDemoResults("startup");
    const summary = renderScanSummary(results);

    expect(summary).toContain("Evidence:");
    expect(summary).toContain("observed");
  });
});
