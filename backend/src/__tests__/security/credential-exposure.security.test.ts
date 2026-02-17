import assert from "node:assert/strict";
import test from "node:test";
import { buildJobResponse } from "../../services/discoveryService.js";
import { sanitizeScanConfig } from "../../services/scanConfigSecurityService.js";

const AWS_KEY_PATTERN = /AKIA[0-9A-Z]{16}/;
const SENSITIVE_FIELD_PATTERN = /(secret|password|private[_-]?key|token|credential|access[_-]?key)/i;
const MASKED_VALUE_PATTERN = /^(\*{4,8}|.{4}\*{4}.{4}|\[REDACTED\])$/;

function containsExposedCredential(
  value: unknown,
  currentPath = ""
): string[] {
  const findings: string[] = [];

  if (typeof value === "string") {
    if (AWS_KEY_PATTERN.test(value)) {
      findings.push(`${currentPath}:aws_key`);
    }
    return findings;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...containsExposedCredential(entry, `${currentPath}[${index}]`));
    });
    return findings;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const keyPath = currentPath ? `${currentPath}.${key}` : key;
      if (typeof nested === "string" && SENSITIVE_FIELD_PATTERN.test(key)) {
        if (!MASKED_VALUE_PATTERN.test(nested) && !nested.startsWith("****")) {
          findings.push(`${keyPath}:sensitive_field`);
        }
      }
      findings.push(...containsExposedCredential(nested, keyPath));
    }
  }

  return findings;
}

test("scan schedule config sanitization masks cloud credentials", () => {
  const sanitized = sanitizeScanConfig({
    providers: [
      {
        type: "aws",
        credentials: {
          accessKeyId: "AKIA1234567890ABCD12",
          secretAccessKey: "very-secret-key-should-not-leak",
        },
      },
      {
        type: "azure",
        credentials: {
          clientSecret: "azure-secret-value",
        },
      },
    ],
    kubernetes: [
      {
        name: "prod",
        kubeconfig: "apiVersion: v1\nclusters:\n- name: prod",
      },
    ],
  });

  const findings = containsExposedCredential(sanitized);
  assert.equal(findings.length, 0, `credential exposure detected: ${findings.join(", ")}`);
});

test("discovery job API response sanitizes sensitive fields recursively", () => {
  const response = buildJobResponse({
    id: "job_1",
    tenantId: "tenant_1",
    status: "COMPLETED",
    jobType: "RUN",
    progress: 100,
    step: "COMPLETED",
    parameters: JSON.stringify({
      provider: "aws",
      credentials: {
        accessKeyId: "AKIAZZZZZZZZZZZZZZZZ",
        secretAccessKey: "super-secret-token-value",
      },
    }),
    resultSummary: JSON.stringify({
      notes: [
        {
          token: "very-secret-token",
        },
      ],
    }),
    errorMessage: null,
    requestedByApiKeyId: "api_1",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const findings = containsExposedCredential(response);
  assert.equal(findings.length, 0, `credential exposure detected: ${findings.join(", ")}`);
});
