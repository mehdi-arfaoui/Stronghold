import {
  countDistinctNonEmpty,
  readBoolean,
  readPositiveNumber,
  readPositiveNumberFromKeys,
  readString,
  readStringArray,
  readStringFromKeys,
} from '../metadataUtils.js';

export function readReplicaCount(metadata: Record<string, unknown>): number {
  return (
    readPositiveNumberFromKeys(metadata, [
      'readReplicaCount',
      'readReplicas',
      'replicaCount',
      'replica_count',
      'replicas',
      'replicasPerMaster',
      'geoReplicationLinks',
      'replicaNames',
    ]) || 0
  );
}

export function isMultiAzEnabled(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.multiAZ) === true ||
    readBoolean(metadata.multiAz) === true ||
    readBoolean(metadata.multi_az) === true ||
    readBoolean(metadata.isMultiAZ) === true ||
    readBoolean(metadata.zoneRedundant) === true ||
    readBoolean(metadata.zone_redundant) === true
  );
}

export function hasDeadLetterQueue(metadata: Record<string, unknown>): boolean {
  const direct =
    readString(metadata.deadLetterTargetArn) ??
    readString(metadata.deadLetterQueueArn) ??
    readString(metadata.dlqArn) ??
    readString(metadata.dlq) ??
    readString(metadata.deadLetterQueue);
  if (direct) return true;

  const redrivePolicy = metadata.redrivePolicy;
  if (typeof redrivePolicy === 'string') {
    const trimmed = redrivePolicy.trim();
    return trimmed.length > 0 && trimmed !== '{}';
  }
  if (redrivePolicy && typeof redrivePolicy === 'object' && !Array.isArray(redrivePolicy)) {
    return Object.keys(redrivePolicy as Record<string, unknown>).length > 0;
  }
  return false;
}

export function hasAwsAutoScalingGroup(metadata: Record<string, unknown>): boolean {
  const asg = readStringFromKeys(metadata, ['autoScalingGroupName', 'autoScalingGroup', 'asgName']);
  if (asg) return true;
  const sourceType = String(metadata.sourceType || '').toLowerCase();
  return sourceType.includes('asg') || sourceType.includes('auto_scaling');
}

export function hasAzureVmScaleSet(metadata: Record<string, unknown>): boolean {
  const vmssId =
    readString(metadata.vmssId) ??
    readString(metadata.virtualMachineScaleSetId) ??
    readString(metadata.virtualMachineScaleSet);
  if (vmssId) return true;
  const vmssCount = readPositiveNumber(metadata.vmssInstanceCount) ?? 0;
  if (vmssCount > 1) return true;
  const sourceType = String(metadata.sourceType || '').toLowerCase();
  return sourceType.includes('virtualmachinescaleset') || sourceType.includes('vmss');
}

export function hasGcpManagedInstanceGroup(metadata: Record<string, unknown>): boolean {
  const mig = readString(metadata.instanceGroupManager) ?? readString(metadata.managedInstanceGroup);
  if (mig) return true;
  const groupSize = readPositiveNumber(metadata.instanceGroupSize) ?? 0;
  if (groupSize > 1) return true;
  return false;
}

export function countKnownZones(metadata: Record<string, unknown>): number {
  const zones = readStringArray(metadata.availabilityZones);
  if (zones.length > 0) return new Set(zones).size;

  const nodePoolZones = Array.isArray(metadata.nodePoolZones)
    ? metadata.nodePoolZones
        .flatMap((item) => (Array.isArray(item) ? item : [item]))
        .map((item) => readString(item))
        .filter((item): item is string => Boolean(item))
    : [];
  if (nodePoolZones.length > 0) return new Set(nodePoolZones).size;

  const single = [
    readString(metadata.availabilityZone),
    readString(metadata.zone),
    readString(metadata.location),
  ];
  return countDistinctNonEmpty(single);
}
