import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { saveScanResults } from "../storage/file-store.js";
import { createDemoResults, createTempDirectory } from "./test-utils.js";

const execMock = vi.fn(
  (command: string, callback?: (error: Error | null) => void) => {
    void command;
    callback?.(null);
    return {} as object;
  },
);

vi.mock("node:child_process", () => ({
  exec: execMock,
}));

describe("graph command", () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("registers the graph command in commander", async () => {
    const programModule = await import("../index.js");
    const help = programModule.createProgram().helpInformation();

    expect(help).toContain("graph");
  });

  it("fails with a friendly message when no scan data exists", async () => {
    const cwd = createTempDirectory("stronghold-graph-cli-");
    process.chdir(cwd);
    await stubAuditIdentity();

    const programModule = await import("../index.js");
    await expect(
      programModule
        .createProgram()
        .parseAsync(["node", "stronghold", "graph", "--no-open"]),
    ).rejects.toThrow(/No scan data found/);
  });

  it("creates the standalone html export at the default path", async () => {
    const cwd = createTempDirectory("stronghold-graph-cli-");
    process.chdir(cwd);
    await stubAuditIdentity();
    await saveDemoScan(cwd);

    const programModule = await import("../index.js");
    await programModule
      .createProgram()
      .parseAsync(["node", "stronghold", "graph", "--no-open"]);

    expect(fs.existsSync(path.join(cwd, ".stronghold", "graph.html"))).toBe(
      true,
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  it("redacts arn identifiers from the generated html", async () => {
    const cwd = createTempDirectory("stronghold-graph-cli-");
    process.chdir(cwd);
    await stubAuditIdentity();
    await saveDemoScan(cwd);

    const programModule = await import("../index.js");
    await programModule
      .createProgram()
      .parseAsync(["node", "stronghold", "graph", "--redact", "--no-open"]);

    const contents = fs.readFileSync(
      path.join(cwd, ".stronghold", "graph.html"),
      "utf8",
    );
    expect(contents).not.toContain("arn:aws:");
  });

  it("supports a custom output path", async () => {
    const cwd = createTempDirectory("stronghold-graph-cli-");
    process.chdir(cwd);
    await stubAuditIdentity();
    await saveDemoScan(cwd);
    const customPath = path.join(cwd, "exports", "dr-graph.html");

    const programModule = await import("../index.js");
    await programModule
      .createProgram()
      .parseAsync([
        "node",
        "stronghold",
        "graph",
        "--no-open",
        "--output",
        customPath,
      ]);

    expect(fs.existsSync(customPath)).toBe(true);
  });

  it("writes an audit trail entry for graph exports", async () => {
    const cwd = createTempDirectory("stronghold-graph-cli-");
    process.chdir(cwd);
    await stubAuditIdentity();
    await saveDemoScan(cwd);

    const programModule = await import("../index.js");
    await programModule
      .createProgram()
      .parseAsync(["node", "stronghold", "graph", "--no-open"]);

    const auditPath = path.join(cwd, ".stronghold", "audit.jsonl");
    const lines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines.some((line) => line.includes('"action":"graph_export"'))).toBe(
      true,
    );
  });
});

async function stubAuditIdentity(): Promise<void> {
  const auditModule = await import("../audit/command-audit.js");
  vi.spyOn(auditModule, "resolveAuditIdentity").mockResolvedValue(null);
}

async function saveDemoScan(cwd: string): Promise<void> {
  const results = await createDemoResults("startup");
  saveScanResults(results, path.join(cwd, ".stronghold", "latest-scan.json"));
}
