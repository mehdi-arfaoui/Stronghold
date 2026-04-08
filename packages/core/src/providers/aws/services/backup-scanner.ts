/**
 * Scans AWS Backup plans, vaults, protected resources, and recovery points.
 */

import {
  BackupClient,
  GetBackupPlanCommand,
  GetBackupSelectionCommand,
  ListBackupPlansCommand,
  ListBackupSelectionsCommand,
  ListTagsCommand,
  ListBackupVaultsCommand,
  ListProtectedResourcesCommand,
  ListRecoveryPointsByBackupVaultCommand,
} from '@aws-sdk/client-backup';
import type { BackupRule, ProtectedResource, RecoveryPointByBackupVault } from '@aws-sdk/client-backup';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { buildResource, paginateAws } from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, normalizeTagMap } from '../tag-utils.js';

interface ProtectedResourceSummary {
  readonly resourceArn: string;
  readonly resourceName?: string;
  readonly resourceType?: string;
  readonly lastBackupTime?: string;
  readonly lastBackupVaultArn?: string;
  readonly lastRecoveryPointArn?: string;
}

interface RecoveryPointSummary {
  readonly resourceArn?: string;
  readonly backupPlanId?: string;
  readonly backupVaultName?: string;
  readonly recoveryPointArn?: string;
  readonly status?: string;
  readonly completionDate?: string;
  readonly backupSizeInBytes?: number;
  readonly lifecycle?: Record<string, unknown>;
}

function toIsoString(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function summarizeProtectedResource(resource: ProtectedResource): ProtectedResourceSummary | null {
  if (!resource.ResourceArn) return null;
  return {
    resourceArn: resource.ResourceArn,
    resourceName: resource.ResourceName,
    resourceType: resource.ResourceType,
    lastBackupTime: toIsoString(resource.LastBackupTime),
    lastBackupVaultArn: resource.LastBackupVaultArn,
    lastRecoveryPointArn: resource.LastRecoveryPointArn,
  };
}

function summarizeRecoveryPoint(point: RecoveryPointByBackupVault): RecoveryPointSummary {
  return {
    resourceArn: point.ResourceArn,
    backupPlanId: point.CreatedBy?.BackupPlanId,
    backupVaultName: point.BackupVaultName,
    recoveryPointArn: point.RecoveryPointArn,
    status: point.Status,
    completionDate: toIsoString(point.CompletionDate),
    backupSizeInBytes:
      typeof point.BackupSizeInBytes === 'number' ? point.BackupSizeInBytes : undefined,
    lifecycle: point.Lifecycle ? { ...point.Lifecycle } : undefined,
  };
}

function summarizeRules(rules: readonly BackupRule[] | undefined): readonly Record<string, unknown>[] {
  return (rules ?? []).map((rule) => ({
    ruleName: rule.RuleName,
    schedule: rule.ScheduleExpression,
    lifecycle: rule.Lifecycle ? { ...rule.Lifecycle } : undefined,
    targetVault: rule.TargetBackupVaultName,
    enableContinuousBackup: rule.EnableContinuousBackup,
  }));
}

async function listBackupPlans(
  backup: BackupClient,
  options: AwsClientOptions,
): Promise<
  readonly { BackupPlanId?: string; BackupPlanArn?: string; BackupPlanName?: string }[]
> {
  return paginateAws(
    (nextToken) =>
      backup.send(
        new ListBackupPlansCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.BackupPlansList,
    (response) => response.NextToken,
  );
}

async function listProtectedResources(
  backup: BackupClient,
  options: AwsClientOptions,
): Promise<readonly ProtectedResourceSummary[]> {
  const resources = await paginateAws(
    (nextToken) =>
      backup.send(
        new ListProtectedResourcesCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.Results,
    (response) => response.NextToken,
  );
  return resources
    .map((resource) => summarizeProtectedResource(resource))
    .filter((resource): resource is ProtectedResourceSummary => resource !== null);
}

async function listBackupVaults(
  backup: BackupClient,
  options: AwsClientOptions,
): Promise<readonly { BackupVaultName?: string; BackupVaultArn?: string; CreationDate?: Date }[]> {
  return paginateAws(
    (nextToken) =>
      backup.send(
        new ListBackupVaultsCommand({ NextToken: nextToken }),
        getAwsCommandOptions(options),
      ),
    (response) => response.BackupVaultList,
    (response) => response.NextToken,
  );
}

async function listRecoveryPointsByVault(
  backup: BackupClient,
  options: AwsClientOptions,
  backupVaultName: string,
): Promise<readonly RecoveryPointSummary[]> {
  const recoveryPoints = await paginateAws(
    (nextToken) =>
      backup.send(
        new ListRecoveryPointsByBackupVaultCommand({
          BackupVaultName: backupVaultName,
          NextToken: nextToken,
        }),
        getAwsCommandOptions(options),
      ),
    (response) => response.RecoveryPoints,
    (response) => response.NextToken,
  );
  return recoveryPoints.map((point) => summarizeRecoveryPoint(point));
}

async function listSelectedResourceArns(
  backup: BackupClient,
  options: AwsClientOptions,
  backupPlanId: string,
): Promise<readonly string[]> {
  const selections = await paginateAws(
    (nextToken) =>
      backup.send(
        new ListBackupSelectionsCommand({
          BackupPlanId: backupPlanId,
          NextToken: nextToken,
        }),
        getAwsCommandOptions(options),
      ),
    (response) => response.BackupSelectionsList,
    (response) => response.NextToken,
  );

  const resourceArns: string[] = [];
  for (const selection of selections) {
    if (!selection.SelectionId) continue;
    const details = await backup.send(
      new GetBackupSelectionCommand({
        BackupPlanId: backupPlanId,
        SelectionId: selection.SelectionId,
      }),
      getAwsCommandOptions(options),
    );
    resourceArns.push(
      ...(details.BackupSelection?.Resources ?? []).filter((value): value is string => Boolean(value)),
    );
  }

  return Array.from(new Set(resourceArns));
}

function collectRecoveryPointsByPlan(
  recoveryPointsByVault: ReadonlyMap<string, readonly RecoveryPointSummary[]>,
): ReadonlyMap<string, readonly RecoveryPointSummary[]> {
  const byPlan = new Map<string, RecoveryPointSummary[]>();

  for (const recoveryPoints of recoveryPointsByVault.values()) {
    for (const recoveryPoint of recoveryPoints) {
      if (!recoveryPoint.backupPlanId) continue;
      const current = byPlan.get(recoveryPoint.backupPlanId) ?? [];
      current.push(recoveryPoint);
      byPlan.set(recoveryPoint.backupPlanId, current);
    }
  }

  return byPlan;
}

function collectProtectedResourcesForPlan(
  resourceArns: readonly string[],
  protectedResources: ReadonlyMap<string, ProtectedResourceSummary>,
): readonly ProtectedResourceSummary[] {
  return resourceArns.map((resourceArn) => protectedResources.get(resourceArn) ?? { resourceArn });
}

export async function scanBackupResources(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const backup = createAwsClient(BackupClient, options);
  const warnings: string[] = [];
  const resources: DiscoveredResource[] = [];
  const tagWarnings = new Set<string>();

  const [backupPlans, protectedResourcesList, backupVaults] = await Promise.all([
    listBackupPlans(backup, options),
    listProtectedResources(backup, options),
    listBackupVaults(backup, options),
  ]);
  const protectedResources = new Map(
    protectedResourcesList.map((resource) => [resource.resourceArn, resource] as const),
  );

  const recoveryPointsByVault = new Map<string, readonly RecoveryPointSummary[]>();
  for (const backupVault of backupVaults) {
    if (!backupVault.BackupVaultName) continue;
    try {
      recoveryPointsByVault.set(
        backupVault.BackupVaultName,
        await listRecoveryPointsByVault(backup, options, backupVault.BackupVaultName),
      );
    } catch {
      warnings.push(
        `AWS Backup recovery points unavailable for vault ${backupVault.BackupVaultName}.`,
      );
    }
  }

  const recoveryPointsByPlan = collectRecoveryPointsByPlan(recoveryPointsByVault);

  for (const backupVault of backupVaults) {
    if (!backupVault.BackupVaultName) continue;
    const tags = backupVault.BackupVaultArn
      ? await fetchAwsTagsWithRetry(
          () =>
            backup.send(
              new ListTagsCommand({ ResourceArn: backupVault.BackupVaultArn! }),
              getAwsCommandOptions(options),
            ),
          (response) => normalizeTagMap(response.Tags),
          {
            description: `AWS Backup tag discovery unavailable in ${options.region}`,
            warnings,
            warningDeduper: tagWarnings,
          },
        )
      : {};
    const displayName = getNameTag(tags) ?? backupVault.BackupVaultName;
    resources.push(
      buildResource({
        source: 'aws',
        externalId: backupVault.BackupVaultArn ?? backupVault.BackupVaultName,
        name: displayName,
        kind: 'infra',
        type: 'BACKUP_VAULT',
        tags,
        metadata: {
          region: options.region,
          backupVaultName: backupVault.BackupVaultName,
          backupVaultArn: backupVault.BackupVaultArn,
          creationDate: toIsoString(backupVault.CreationDate),
          recoveryPoints: recoveryPointsByVault.get(backupVault.BackupVaultName) ?? [],
          displayName,
          ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
        },
      }),
    );
  }

  for (const backupPlan of backupPlans) {
    const backupPlanId = backupPlan.BackupPlanId;
    if (!backupPlanId) continue;

    try {
      const planDetails = await backup.send(
        new GetBackupPlanCommand({ BackupPlanId: backupPlanId }),
        getAwsCommandOptions(options),
      );
      const selectedResourceArns = await listSelectedResourceArns(
        backup,
        options,
        backupPlanId,
      ).catch(() => {
        warnings.push(`AWS Backup selections unavailable for plan ${backupPlanId}.`);
        return [] as readonly string[];
      });
      const recoveryPoints = recoveryPointsByPlan.get(backupPlanId) ?? [];
      const protectedResourceArns = Array.from(
        new Set([
          ...selectedResourceArns,
          ...recoveryPoints
            .map((recoveryPoint) => recoveryPoint.resourceArn)
            .filter((resourceArn): resourceArn is string => Boolean(resourceArn)),
        ]),
      );
      const protectedResourcesForPlan = collectProtectedResourcesForPlan(
        protectedResourceArns,
        protectedResources,
      );
      const tags = backupPlan.BackupPlanArn
        ? await fetchAwsTagsWithRetry(
            () =>
              backup.send(
                new ListTagsCommand({ ResourceArn: backupPlan.BackupPlanArn! }),
                getAwsCommandOptions(options),
              ),
            (response) => normalizeTagMap(response.Tags),
            {
              description: `AWS Backup tag discovery unavailable in ${options.region}`,
              warnings,
              warningDeduper: tagWarnings,
            },
          )
        : {};
      const displayName =
        getNameTag(tags) ??
        planDetails.BackupPlan?.BackupPlanName ??
        backupPlan.BackupPlanName ??
        backupPlanId;

      resources.push(
        buildResource({
          source: 'aws',
          externalId: backupPlanId,
          name: displayName,
          kind: 'infra',
          type: 'BACKUP_PLAN',
          tags,
          metadata: {
            region: options.region,
            backupPlanId,
            backupPlanArn: backupPlan.BackupPlanArn,
            backupPlanName:
              planDetails.BackupPlan?.BackupPlanName ?? backupPlan.BackupPlanName ?? backupPlanId,
            rules: summarizeRules(planDetails.BackupPlan?.Rules),
            creationDate: toIsoString(planDetails.CreationDate),
            lastExecutionDate: toIsoString(planDetails.LastExecutionDate),
            coveredResourceArns: protectedResourceArns,
            protectedResources: protectedResourcesForPlan,
            recoveryPoints,
            displayName,
            ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
          },
        }),
      );
    } catch {
      warnings.push(`AWS Backup plan details unavailable for plan ${backupPlanId}.`);
    }
  }

  return { resources, warnings };
}
