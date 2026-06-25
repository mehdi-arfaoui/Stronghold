import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FORBIDDEN_CONTRACT_TOKENS = [
  'estimatedRTO',
  'suggestedRTO',
  'validatedRTO',
  'estimatedRPO',
  'suggestedRPO',
];

const DEFAULT_CONTRACT_TARGETS = [
  'packages/core/src/contracts',
  'packages/cli/src/commands/contracts.ts',
  'packages/cli/src/commands/scan.ts',
];

const PURE_DOMAIN_TARGETS = [
  'packages/core/src',
];

const PURE_DOMAIN_EXCLUDED_TARGETS = [
  'packages/core/src/providers',
  'packages/core/src/auth',
  'packages/core/src/orchestration',
];

const PURE_DOMAIN_EXCLUDED_SEGMENTS = [
  '/__tests__/',
  '/__fixtures__/',
  '/__e2e__/',
  '/__generated__/',
  '/generated/',
];
const PURE_DOMAIN_EXCLUDED_FILE_PATTERN =
  /\.(?:test|spec|generated)\.[cm]?[jt]sx?$/u;

const TARGETED_BEHAVIOR_TESTS = [
  'packages/core/src/contracts/evaluators/rto-rpo-evaluator.test.ts',
  'packages/core/src/contracts/contract-evaluator.test.ts',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const FALLBACK_CONTEXT_PATTERN =
  /(?:fallback|default|estimate|estimated|suggested|validated|unknown)[^\n]{0,80}\b(120|60|30)\b/iu;
const FALLBACK_COALESCE_PATTERN = /(?:rto|rpo)[^\n]{0,40}(?:\?\?|\|\|)\s*(120|60|30)\b/iu;

const FORBIDDEN_PURITY_PATTERNS = [
  ...[
    'node:http',
    'node:https',
    'http',
    'https',
    'node:net',
    'net',
    'node:tls',
    'tls',
    'node:child_process',
    'child_process',
    'axios',
  ].map((moduleName) => ({
    token: moduleName,
    pattern: moduleImportPattern(moduleName),
  })),
  {
    token: 'fetch',
    pattern: /\b(?:globalThis\.)?fetch\s*\(/u,
  },
  {
    token: '@aws-sdk',
    pattern: /['"](@aws-sdk\/[^'"]+)['"]/u,
  },
  {
    token: 'AWS SDK client',
    pattern:
      /\b((?:AutoScaling|Backup|CloudWatch|DynamoDB|EC2|ECS|EFS|EKS|ElastiCache|ElasticLoadBalancingV2|EventBridge|Lambda|RDS|Route53|S3|SFN|SNS|SQS|STS)Client)\b/u,
  },
  {
    token: 'WebhookClient',
    pattern: /\b(WebhookClient|IncomingWebhook)\b/u,
  },
  {
    token: 'webhook-client',
    pattern: /['"](@slack\/webhook|discord-webhook-node|webhook-discord|webhook-client)['"]/u,
  },
];

export function findInvariantViolations(options = {}) {
  const root = options.root ?? resolveRepoRoot();
  const contractTargets = options.contractTargets ?? options.targets ?? DEFAULT_CONTRACT_TARGETS;
  const pureDomainTargets = options.pureDomainTargets ?? PURE_DOMAIN_TARGETS;
  const contractFiles = collectTargetFiles(root, contractTargets);
  const pureDomainFiles = collectTargetFiles(root, pureDomainTargets, {
    excludeTargets: PURE_DOMAIN_EXCLUDED_TARGETS,
    excludeTestFiles: true,
  });
  const violations = [];

  for (const file of contractFiles) {
    const relativePath = toPosix(path.relative(root, file));
    const contents = fs.readFileSync(file, 'utf8');
    const lines = contents.split(/\r?\n/u);

    lines.forEach((line, index) => {
      if (line.includes('ai-invariant-allow')) {
        return;
      }

      for (const token of FORBIDDEN_CONTRACT_TOKENS) {
        if (line.includes(token)) {
          violations.push({
            file: relativePath,
            line: index + 1,
            rule: 'contract-estimate-token',
            match: token,
            text: line.trim(),
          });
        }
      }

      if (line.includes('graph-scenario-engine')) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: 'contract-graph-scenario-engine',
          match: 'graph-scenario-engine',
          text: line.trim(),
        });
      }

      const fallbackValue = findFallbackValue(line);
      if (fallbackValue !== null) {
        violations.push({
          file: relativePath,
          line: index + 1,
          rule: 'contract-fallback-rto-rpo',
          match: fallbackValue,
          text: line.trim(),
        });
      }
    });
  }

  for (const file of pureDomainFiles) {
    const relativePath = toPosix(path.relative(root, file));
    const contents = fs.readFileSync(file, 'utf8');
    const lines = contents.split(/\r?\n/u);

    lines.forEach((line, index) => {
      if (line.includes('ai-invariant-allow')) {
        return;
      }

      for (const forbidden of FORBIDDEN_PURITY_PATTERNS) {
        const match = line.match(forbidden.pattern);
        if (match) {
          violations.push({
            file: relativePath,
            line: index + 1,
            rule: 'pure-domain-network-side-effect',
            match: match[1] ?? forbidden.token,
            text: line.trim(),
          });
        }
      }
    });
  }

  const scannedFiles = new Set([...contractFiles, ...pureDomainFiles]).size;

  return {
    scannedFiles,
    scannedContractFiles: contractFiles.length,
    scannedPureDomainFiles: pureDomainFiles.length,
    violations,
  };
}

export function renderInvariantReport(result) {
  if (result.violations.length === 0) {
    return [
      'AI invariant check: PASS',
      `Scanned files: ${result.scannedFiles}`,
      `Contract guard files: ${result.scannedContractFiles}`,
      `Pure domain guard files: ${result.scannedPureDomainFiles}`,
      '',
    ].join('\n');
  }

  const lines = [
    'AI invariant check: FAIL',
    `Scanned files: ${result.scannedFiles}`,
    `Contract guard files: ${result.scannedContractFiles}`,
    `Pure domain guard files: ${result.scannedPureDomainFiles}`,
    `Violations: ${result.violations.length}`,
    '',
  ];

  for (const violation of result.violations) {
    lines.push(
      `${violation.file}:${violation.line} ${violation.rule} (${violation.match})`,
    );
    lines.push(`  ${violation.text}`);
  }

  return `${lines.join('\n')}\n`;
}

export function runTargetedInvariantTests(root = resolveRepoRoot()) {
  const command = process.execPath;
  const args = [
    path.join(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    ...TARGETED_BEHAVIOR_TESTS,
    '--reporter=dot',
  ];

  try {
    execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    return {
      status: 'passed',
      tests: TARGETED_BEHAVIOR_TESTS,
      stdout: '',
      stderr: '',
    };
  } catch (error) {
    return {
      status: 'failed',
      tests: TARGETED_BEHAVIOR_TESTS,
      stdout: outputFromError(error, 'stdout'),
      stderr: outputFromError(error, 'stderr'),
      message: error instanceof Error ? error.message : '',
    };
  }
}

export function renderTargetedTestReport(result) {
  const lines = [
    `Targeted behavior tests: ${result.status === 'passed' ? 'PASS' : 'FAIL'}`,
    ...result.tests.map((testPath) => `- ${testPath}`),
  ];

  if (result.status === 'failed') {
    if (result.stdout.length > 0) {
      lines.push('', result.stdout.trim());
    }
    if (result.stderr.length > 0) {
      lines.push('', result.stderr.trim());
    }
    if (result.message && result.message.length > 0) {
      lines.push('', result.message);
    }
  }

  return `${lines.join('\n')}\n`;
}

function collectTargetFiles(root, targets, options = {}) {
  const excludedRoots = (options.excludeTargets ?? []).map((target) =>
    path.resolve(root, target),
  );
  const files = [];
  for (const target of targets) {
    const absolute = path.resolve(root, target);
    if (!fs.existsSync(absolute)) {
      continue;
    }

    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(root, absolute, excludedRoots, options));
    } else if (isSourceFile(absolute) && !isExcludedFile(root, absolute, excludedRoots, options)) {
      files.push(absolute);
    }
  }
  return [...new Set(files)].sort();
}

function walkSourceFiles(root, directory, excludedRoots, options) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (isExcludedFile(root, absolute, excludedRoots, options)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(root, absolute, excludedRoots, options));
    } else if (entry.isFile() && isSourceFile(absolute)) {
      files.push(absolute);
    }
  }

  return files;
}

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

function isExcludedFile(root, filePath, excludedRoots, options) {
  if (excludedRoots.some((excludedRoot) => isPathInside(filePath, excludedRoot))) {
    return true;
  }

  if (options.excludeTestFiles) {
    const relativePath = `/${toPosix(path.relative(root, filePath))}`;
    if (
      PURE_DOMAIN_EXCLUDED_SEGMENTS.some((segment) => relativePath.includes(segment)) ||
      PURE_DOMAIN_EXCLUDED_FILE_PATTERN.test(filePath)
    ) {
      return true;
    }
  }

  return false;
}

function isPathInside(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findFallbackValue(line) {
  return (
    line.match(FALLBACK_COALESCE_PATTERN)?.[1] ??
    line.match(FALLBACK_CONTEXT_PATTERN)?.[1] ??
    null
  );
}

function moduleImportPattern(moduleName) {
  const escaped = escapeRegExp(moduleName);
  return new RegExp(
    String.raw`(?:from\s+['"]${escaped}['"]|import\s+['"]${escaped}['"]|import\s*\(\s*['"]${escaped}['"]\s*\)|require\s*\(\s*['"]${escaped}['"]\s*\))`,
    'u',
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function outputFromError(error, key) {
  const output = error?.[key];
  if (Buffer.isBuffer(output)) {
    return output.toString('utf8');
  }
  return typeof output === 'string' ? output : '';
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

function toPosix(value) {
  return value.replace(/\\/gu, '/');
}

if (isMain()) {
  const result = findInvariantViolations();
  const report = renderInvariantReport(result);
  if (result.violations.length > 0) {
    process.stderr.write(report);
    process.exitCode = 1;
  } else {
    process.stdout.write(report);
    const testResult = runTargetedInvariantTests();
    const testReport = renderTargetedTestReport(testResult);
    if (testResult.status === 'failed') {
      process.stderr.write(testReport);
      process.exitCode = 1;
    } else {
      process.stdout.write(testReport);
    }
  }
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
