/**
 * Scans Route53 hosted zones and record sets.
 */

import {
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';
import type { ResourceRecordSet } from '@aws-sdk/client-route-53';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { type AwsClientOptions, createRoute53Client } from '../aws-client-factory.js';
import { buildResource } from '../scan-utils.js';

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

function createRoute53RecordId(record: ResourceRecordSet, hostedZoneId: string): string {
  const name = normalizeDnsName(record.Name) ?? 'record';
  const identifier = record.SetIdentifier ?? record.Failover ?? determineRoutingPolicy(record);
  return `route53-record:${hostedZoneId}:${name}:${record.Type}:${identifier}`;
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
  let marker: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response = await route53.send(new ListHostedZonesCommand({ Marker: marker }));
    for (const zone of response.HostedZones ?? []) {
      const hostedZoneId = normalizeHostedZoneId(zone.Id);
      if (!hostedZoneId) continue;
      const zoneName = normalizeDnsName(zone.Name) ?? hostedZoneId;

      resources.push(
        buildResource({
          source: 'aws',
          externalId: hostedZoneId,
          name: zoneName,
          kind: 'infra',
          type: 'ROUTE53_HOSTED_ZONE',
          metadata: {
            region: 'global',
            hostedZoneId,
            name: zoneName,
            recordCount: zone.ResourceRecordSetCount ?? 0,
            isPrivate: zone.Config?.PrivateZone ?? false,
            displayName: zoneName,
          },
        }),
      );

      try {
        const recordSets = await listRoute53RecordSets(options, hostedZoneId);
        for (const record of recordSets) {
          const recordName = normalizeDnsName(record.Name) ?? 'record';
          const aliasTargetDnsName = normalizeDnsName(record.AliasTarget?.DNSName);
          resources.push(
            buildResource({
              source: 'aws',
              externalId: createRoute53RecordId(record, hostedZoneId),
              name: recordName,
              kind: 'infra',
              type: 'ROUTE53_RECORD',
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
