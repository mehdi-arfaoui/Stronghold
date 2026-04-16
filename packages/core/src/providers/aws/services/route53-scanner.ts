/**
 * Scans Route53 hosted zones and record sets.
 */

import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  ListTagsForResourceCommand,
} from '@aws-sdk/client-route-53';
import type { ResourceRecordSet } from '@aws-sdk/client-route-53';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createRoute53Client, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import {
  createAccountContextResolver,
  createResource,
} from '../scan-utils.js';
import { fetchAwsTagsWithRetry, getNameTag, tagsArrayToMap } from '../tag-utils.js';

function normalizeDnsName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\.$/, '');
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeHostedZoneId(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  return raw.split('/').pop() ?? raw;
}

function determineRoutingPolicy(record: ResourceRecordSet): string {
  if (record.Failover) return 'failover';
  if (record.Weight != null) return 'weighted';
  if (record.Region) return 'latency';
  if (record.GeoLocation) return 'geolocation';
  if (record.MultiValueAnswer) return 'multivalue';
  return 'simple';
}

function createRoute53RecordArn(
  partition: string,
  record: ResourceRecordSet,
  hostedZoneId: string,
): string {
  const name = normalizeDnsName(record.Name) ?? 'record';
  const identifier = record.SetIdentifier ?? record.Failover ?? determineRoutingPolicy(record);
  return `arn:${partition}:route53:::recordset/${hostedZoneId}/${name}/${record.Type}/${identifier}`;
}

async function listRoute53RecordSets(
  options: AwsClientOptions,
  hostedZoneId: string,
): Promise<readonly ResourceRecordSet[]> {
  const route53 = createRoute53Client(options);
  const recordSets: ResourceRecordSet[] = [];
  let startRecordName: string | undefined;
  let startRecordType: ResourceRecordSet['Type'] | undefined;
  let startRecordIdentifier: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await route53.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ...(startRecordName ? { StartRecordName: startRecordName } : {}),
        ...(startRecordType ? { StartRecordType: startRecordType } : {}),
        ...(startRecordIdentifier ? { StartRecordIdentifier: startRecordIdentifier } : {}),
      }),
      getAwsCommandOptions(options),
    );
    recordSets.push(...(response.ResourceRecordSets ?? []));
    startRecordName = response.NextRecordName;
    startRecordType = response.NextRecordType;
    startRecordIdentifier = response.NextRecordIdentifier;
    isTruncated = response.IsTruncated ?? false;
  }

  return recordSets;
}

export async function scanRoute53HostedZones(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const route53 = createRoute53Client(options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const tagWarnings = new Set<string>();
  const accountContext = await createAccountContextResolver(options)();
  let marker: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await route53.send(
      new ListHostedZonesCommand({ Marker: marker }),
      getAwsCommandOptions(options),
    );
    for (const zone of response.HostedZones ?? []) {
      const hostedZoneId = normalizeHostedZoneId(zone.Id);
      if (!hostedZoneId) continue;
      const zoneName = normalizeDnsName(zone.Name) ?? hostedZoneId;
      const tags = await fetchAwsTagsWithRetry(
        () =>
          route53.send(
            new ListTagsForResourceCommand({
              ResourceType: 'hostedzone',
              ResourceId: hostedZoneId,
            }),
            getAwsCommandOptions(options),
          ),
        (response) => tagsArrayToMap(response.ResourceTagSet?.Tags),
        {
          description: `Route53 tag discovery unavailable in global`,
          warnings,
          warningDeduper: tagWarnings,
        },
      );
      const displayName = getNameTag(tags) ?? zoneName;

      resources.push(
        createResource({
          source: 'aws',
          arn: `arn:${accountContext.partition}:route53:::hostedzone/${hostedZoneId}`,
          name: displayName,
          kind: 'infra',
          type: 'ROUTE53_HOSTED_ZONE',
          account: accountContext,
          tags,
          metadata: {
            region: 'global',
            hostedZoneId,
            name: zoneName,
            recordCount: zone.ResourceRecordSetCount ?? 0,
            isPrivate: zone.Config?.PrivateZone ?? false,
            displayName,
            ...(Object.keys(tags).length > 0 ? { awsTags: tags } : {}),
          },
        }),
      );

      try {
        const recordSets = await listRoute53RecordSets(options, hostedZoneId);
        for (const record of recordSets) {
          const recordName = normalizeDnsName(record.Name) ?? 'record';
          const aliasTargetDnsName = normalizeDnsName(record.AliasTarget?.DNSName);
          resources.push(
            createResource({
              source: 'aws',
              arn: createRoute53RecordArn(accountContext.partition, record, hostedZoneId),
              name: recordName,
              kind: 'infra',
              type: 'ROUTE53_RECORD',
              account: accountContext,
              metadata: {
                region: 'global',
                hostedZoneId,
                name: recordName,
                type: record.Type,
                ttl: record.TTL ?? undefined,
                failover: record.Failover ?? undefined,
                routingPolicy: determineRoutingPolicy(record),
                healthCheckId: record.HealthCheckId ?? undefined,
                aliasTarget: record.AliasTarget
                  ? {
                      hostedZoneId: record.AliasTarget.HostedZoneId,
                      dnsName: aliasTargetDnsName ?? record.AliasTarget.DNSName,
                      evaluateTargetHealth: record.AliasTarget.EvaluateTargetHealth,
                    }
                  : undefined,
                aliasTargetDnsName,
                regionName: record.Region ?? undefined,
                weight: record.Weight ?? undefined,
                setIdentifier: record.SetIdentifier ?? undefined,
                resourceValues: (record.ResourceRecords ?? [])
                  .map((entry) => entry.Value)
                  .filter((value): value is string => Boolean(value)),
                displayName: `${recordName} (${record.Type})`,
              },
            }),
          );
        }
      } catch {
        warnings.push(`Route53 record scan unavailable for hosted zone ${zoneName}.`);
      }
    }

    marker = response.NextMarker;
    isTruncated = response.IsTruncated ?? false;
  }

  return { resources, warnings };
}
