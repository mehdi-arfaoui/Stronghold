import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  createLoginRateLimit,
  reportRateLimit,
  resolveLoginRateLimitPolicy,
  scanRateLimit,
} from "../../middleware/rateLimitMiddleware.js";

async function withServer(
  app: express.Express,
  handler: (baseUrl: string) => Promise<void>
) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "string" ? 0 : (address?.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function buildLimiterTestApp(route: string, limiter: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post(route, limiter, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

async function burst(baseUrl: string, route: string, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index: i }),
    });
    statuses.push(response.status);
  }
  return statuses;
}

test("login rate limit policy allows 100 req/min in development", () => {
  assert.deepEqual(resolveLoginRateLimitPolicy("development"), {
    windowMs: 60_000,
    limit: 100,
  });
});

test("login rate limit policy allows 20 req/min in production", () => {
  assert.deepEqual(resolveLoginRateLimitPolicy("production"), {
    windowMs: 60_000,
    limit: 20,
  });
});

test("POST /auth/login limiter rejects burst traffic after request 20 in production", { concurrency: false }, async () => {
  const app = buildLimiterTestApp("/auth/login", createLoginRateLimit("production"));
  await withServer(app, async (baseUrl) => {
    const statuses = await burst(baseUrl, "/auth/login", 25);
    const first429 = statuses.findIndex((status) => status === 429);
    assert.ok(first429 >= 0, "auth limiter never returned 429");
    assert.equal(first429 + 1, 21, `unexpected first 429 position: request #${first429 + 1}`);
  });
});

test("POST /auth/login limiter stays permissive in development", { concurrency: false }, async () => {
  const app = buildLimiterTestApp("/auth/login", createLoginRateLimit("development"));
  await withServer(app, async (baseUrl) => {
    const statuses = await burst(baseUrl, "/auth/login", 25);
    assert.ok(statuses.every((status) => status === 200), `unexpected status sequence: ${statuses.join(",")}`);
  });
});

test("POST /api/discovery/scan limiter throttles high request volume", { concurrency: false }, async () => {
  const app = buildLimiterTestApp("/api/discovery/scan", scanRateLimit);
  await withServer(app, async (baseUrl) => {
    const statuses = await burst(baseUrl, "/api/discovery/scan", 15);
    const first429 = statuses.findIndex((status) => status === 429);
    assert.ok(first429 >= 0, "scan limiter never returned 429");
    assert.ok(first429 + 1 <= 15, `first 429 too late: request #${first429 + 1}`);
  });
});

test("POST /api/reports/executive-financial limiter throttles burst calls", { concurrency: false }, async () => {
  const app = buildLimiterTestApp("/api/reports/executive-financial", reportRateLimit);
  await withServer(app, async (baseUrl) => {
    const statuses = await burst(baseUrl, "/api/reports/executive-financial", 15);
    const first429 = statuses.findIndex((status) => status === 429);
    assert.ok(first429 >= 0, "report limiter never returned 429");
    assert.ok(first429 + 1 <= 15, `first 429 too late: request #${first429 + 1}`);
  });
});

test("POST /api/business-flows/ai/suggest uses dedicated max 5/h guard", { concurrency: false }, () => {
  const routeFile = path.resolve(process.cwd(), "src", "routes", "businessFlowRoutes.ts");
  const content = fs.readFileSync(routeFile, "utf8");

  assert.match(content, /const AI_SUGGESTION_MAX_PER_HOUR = 5;/);
  assert.match(content, /if \(!checkAISuggestionRateLimit\(tenantId\)\)/);
  assert.match(content, /Rate limit exceeded\. Maximum 5 AI flow suggestions per hour/);
});
