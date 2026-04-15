import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { Command } from "commander";
import {
  buildGraphVisualData,
  redact,
  renderGraphHtml,
  type ReasoningScanResult,
  type GraphVisualSource,
  type GraphVisualData,
} from "@stronghold-dr/core";

import {
  CommandAuditSession,
  collectAuditFlags,
  resolveAuditIdentity,
} from "../audit/command-audit.js";
import type { GraphCommandOptions } from "../config/options.js";
import { getCommandOptions } from "../config/options.js";
import { CliError } from "../errors/cli-error.js";
import { writeError, writeOutput } from "../output/io.js";
import {
  loadScanResultsWithEncryption,
  writeTextFile,
} from "../storage/secure-file-store.js";
import { rebuildScanResults } from "../pipeline/rebuild-scan.js";
import { loadLocalPostureMemory } from "../history/posture-memory.js";
import {
  resolvePreferredScanPath,
  resolveStrongholdPaths,
} from "../storage/paths.js";

const DEFAULT_GRAPH_OUTPUT = path.join(".stronghold", "graph.html");

export function registerGraphCommand(program: Command): void {
  program
    .command("graph")
    .description(
      "Export the interactive DR dependency graph as standalone HTML",
    )
    .option("--output <path>", "Output HTML path", DEFAULT_GRAPH_OUTPUT)
    .option("--no-open", "Generate the file without opening the browser")
    .option("--scenario <id>", "Pre-select a scenario in the exported graph")
    .action(async (_: GraphCommandOptions, command: Command) => {
      const options = getCommandOptions<GraphCommandOptions>(command);
      const auditFlags = collectAuditFlags({
        "--redact": options.redact,
        "--no-open": options.open === false,
        "--output": Boolean(options.output),
        "--scenario": Boolean(options.scenario),
      });
      const audit = new CommandAuditSession("graph_export", {
        outputFormat: "html",
        ...(auditFlags ? { flags: auditFlags } : {}),
      });
      audit.setIdentityPromise(resolveAuditIdentity());
      await audit.start();

      try {
        const paths = resolveStrongholdPaths();
        const scanPath = resolvePreferredScanPath(
          paths.latestEncryptedScanPath,
          paths.latestScanPath,
        );
        if (!fs.existsSync(scanPath)) {
          throw new CliError(
            "No scan data found. Run 'stronghold scan' or 'stronghold demo' first.",
            1,
          );
        }

        const scan = await loadScanResultsWithEncryption(scanPath, {
          passphrase: options.passphrase,
        });
        const effectiveScan = await rebuildScanResults(scan);
        const baselinePath = resolveExistingScanPath(
          paths.baselineEncryptedScanPath,
          paths.baselineScanPath,
        );
        const baselineScan = baselinePath
          ? await loadScanResultsWithEncryption(baselinePath, {
              passphrase: options.passphrase,
            }).catch(() => null)
          : null;
        const effectivePreviousScan = baselineScan ? await rebuildScanResults(baselineScan) : null;
        const postureMemory = await loadLocalPostureMemory(effectiveScan, paths);
        const visual = buildGraphVisualData({
          ...(effectiveScan as GraphVisualSource),
          previousScanResult: effectivePreviousScan
            ? toReasoningScanResult(effectivePreviousScan)
            : null,
          findingLifecycles: postureMemory.allLifecycles,
        });
        const redacted = options.redact ? redactGraphVisualData(visual) : null;
        const outputVisual = redacted?.data ?? visual;
        const html = renderGraphHtml(outputVisual, {
          initialScenarioId: options.redact
            ? (redacted?.scenarioIdMap.get(options.scenario ?? "") ?? null)
            : (options.scenario ?? null),
        });
        const targetPath = await writeTextFile(
          html,
          options.output ?? DEFAULT_GRAPH_OUTPUT,
          {
            encrypt: false,
          },
        );
        const displayPath = formatOutputPath(targetPath);

        await writeOutput(`Graph exported to ${displayPath}`);
        if (options.open !== false) {
          await writeOutput("Opening in browser...");
          try {
            await openGraphInBrowser(targetPath);
          } catch (error) {
            writeError(
              `Warning: unable to open the browser automatically: ${resolveErrorMessage(error)}`,
            );
          }
        } else {
          await writeOutput(
            "Use --no-open to skip opening the browser automatically.",
          );
        }

        await audit.finish({
          status: "success",
          resourceCount: visual.nodes.length,
        });
      } catch (error) {
        await audit.fail(error);
        throw error;
      }
    });
}

function resolveExistingScanPath(encryptedPath: string, plainPath: string): string | null {
  if (!fs.existsSync(encryptedPath) && !fs.existsSync(plainPath)) {
    return null;
  }

  return resolvePreferredScanPath(encryptedPath, plainPath);
}

function toReasoningScanResult(
  scan: Awaited<ReturnType<typeof rebuildScanResults>>,
): ReasoningScanResult {
  if (!scan.servicePosture) {
    throw new Error("Service posture is unavailable for graph reasoning.");
  }

  return {
    ...scan,
    servicePosture: scan.servicePosture,
    nodes: [...scan.nodes],
    edges: [...scan.edges],
    fullChainCoverage: scan.fullChainCoverage ?? null,
    scannedAt: new Date(scan.timestamp),
  };
}

function redactGraphVisualData(data: GraphVisualData): {
  readonly data: GraphVisualData;
  readonly scenarioIdMap: ReadonlyMap<string, string>;
} {
  const nodeIdMap = new Map(
    data.nodes.map(
      (node, index) =>
        [node.id, `node-${String(index + 1).padStart(3, "0")}`] as const,
    ),
  );
  const nodeLabelMap = new Map(
    data.nodes.map(
      (node, index) =>
        [
          node.label,
          `${node.type.toUpperCase()} ${String(index + 1).padStart(3, "0")}`,
        ] as const,
    ),
  );
  const serviceIdMap = new Map(
    data.services.map(
      (service, index) =>
        [service.id, `service-${String(index + 1).padStart(2, "0")}`] as const,
    ),
  );
  const scenarioIdMap = new Map(
    data.scenarios.map(
      (scenario, index) =>
        [
          scenario.id,
          `scenario-${String(index + 1).padStart(2, "0")}`,
        ] as const,
    ),
  );
  const replacements = buildReplacementEntries(
    nodeIdMap,
    nodeLabelMap,
    serviceIdMap,
  );

  return {
    scenarioIdMap,
    data: {
      ...data,
      nodes: data.nodes.map((node, index) => ({
        ...node,
        id:
          nodeIdMap.get(node.id) ??
          `node-${String(index + 1).padStart(3, "0")}`,
        label:
          nodeLabelMap.get(node.label) ??
          `${node.type.toUpperCase()} ${String(index + 1).padStart(3, "0")}`,
        serviceId: node.serviceId
          ? (serviceIdMap.get(node.serviceId) ?? null)
          : null,
        serviceName: node.serviceName
          ? node.serviceName
          : null,
        findings: node.findings.map((finding) => ({
          ...finding,
          message: redactKnownIdentifiers(finding.message, replacements),
          remediation: finding.remediation
            ? redactKnownIdentifiers(finding.remediation, replacements)
            : null,
        })),
        recommendations: node.recommendations.map((recommendation) =>
          redactKnownIdentifiers(recommendation, replacements),
        ),
      })),
      edges: data.edges.map((edge) => ({
        ...edge,
        source: nodeIdMap.get(edge.source) ?? edge.source,
        target: nodeIdMap.get(edge.target) ?? edge.target,
        label: redactKnownIdentifiers(edge.label, replacements),
      })),
      services: data.services.map((service) => ({
        ...service,
        id: serviceIdMap.get(service.id) ?? service.id,
        name: service.name,
        nodeIds: service.nodeIds.map(
          (nodeId) => nodeIdMap.get(nodeId) ?? nodeId,
        ),
        reasoning: service.reasoning.map((bullet) =>
          redactKnownIdentifiers(bullet, replacements),
        ),
        insights: service.insights.map((bullet) =>
          redactKnownIdentifiers(bullet, replacements),
        ),
        conclusion: redactKnownIdentifiers(service.conclusion, replacements),
        nextAction: service.nextAction
          ? redactKnownIdentifiers(service.nextAction, replacements)
          : null,
        recoveryChain: service.recoveryChain
          ? {
              ...service.recoveryChain,
              steps: service.recoveryChain.steps.map((step) => ({
                ...step,
                resourceName: redactKnownIdentifiers(step.resourceName, replacements),
                statusReason: redactKnownIdentifiers(step.statusReason, replacements),
              })),
            }
          : null,
      })),
      scenarios: data.scenarios.map((scenario, index) => ({
        ...scenario,
        id:
          scenarioIdMap.get(scenario.id) ??
          `scenario-${String(index + 1).padStart(2, "0")}`,
        name: scenario.name,
        affectedNodeIds: scenario.affectedNodeIds.map(
          (nodeId) => nodeIdMap.get(nodeId) ?? nodeId,
        ),
        directlyAffectedNodeIds: scenario.directlyAffectedNodeIds.map(
          (nodeId) => nodeIdMap.get(nodeId) ?? nodeId,
        ),
        cascadeNodeIds: scenario.cascadeNodeIds.map(
          (nodeId) => nodeIdMap.get(nodeId) ?? nodeId,
        ),
        downServices: scenario.downServices.map(
          (name) => name,
        ),
        degradedServices: scenario.degradedServices.map(
          (name) => name,
        ),
        summary: scenario.summary
          ? redactKnownIdentifiers(scenario.summary, replacements)
          : null,
      })),
    },
  };
}

function buildReplacementEntries(
  ...maps: ReadonlyArray<ReadonlyMap<string, string>>
): readonly (readonly [string, string])[] {
  return maps
    .flatMap((map) => Array.from(map.entries()))
    .filter(([from]) => from.length > 0)
    .sort((left, right) => right[0].length - left[0].length);
}

function redactKnownIdentifiers(
  value: string,
  replacements: readonly (readonly [string, string])[],
): string {
  let output = value;
  replacements.forEach(([from, to]) => {
    if (output.includes(from)) {
      output = output.split(from).join(to);
    }
  });

  return redact(output, { level: "full" });
}

function formatOutputPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function openGraphInBrowser(filePath: string): Promise<void> {
  const quotedPath = `"${path.resolve(filePath)}"`;
  const command =
    process.platform === "win32"
      ? `start "" ${quotedPath}`
      : process.platform === "darwin"
        ? `open ${quotedPath}`
        : `xdg-open ${quotedPath}`;

  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
