import {
  awsCli,
  componentRunbook,
  createStep,
  resolveIdentifier,
  resolveRegion,
  rollback,
  verification,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateEksRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const clusterName = resolveIdentifier(metadata, ['clusterName'], componentId);
  const region = resolveRegion(metadata);
  const describeCluster =
    `aws eks describe-cluster --name ${clusterName} --query "cluster.[status,version,endpoint]" --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Ensure kubeconfig access, GitOps tooling, and any Velero backup credentials are available before cluster recovery.'],
    steps: [
      createStep({
        order: 1,
        title: 'Check EKS cluster status',
        description: 'Verify whether the control plane is active and which version is running.',
        command: awsCli(describeCluster, 'Reads the EKS cluster status, version, and endpoint.'),
        estimatedMinutes: 1,
        verification: verification(describeCluster, 'Cluster status and endpoint are returned.'),
      }),
      createStep({
        order: 2,
        title: 'List node groups',
        description: 'Enumerate the node groups attached to the cluster.',
        command: awsCli(
          `aws eks list-nodegroups --cluster-name ${clusterName} --region ${region}`,
          'Lists all node groups on the EKS cluster.',
        ),
        estimatedMinutes: 1,
      }),
      createStep({
        order: 3,
        title: 'Inspect each node group',
        description: 'Describe each node group to check health and scaling settings.',
        command: awsCli(
          `aws eks describe-nodegroup --cluster-name ${clusterName} --nodegroup-name <NODEGROUP_NAME> --query "nodegroup.[status,scalingConfig]" --region ${region}`,
          'Describes a single EKS node group.',
        ),
        estimatedMinutes: 1,
        notes: ['Replace <NODEGROUP_NAME> with each value returned by the previous step.'],
      }),
      createStep({
        order: 4,
        title: 'Inspect workloads with kubectl',
        description: 'Check pod health if kubeconfig access to the cluster is still available.',
        command: {
          type: 'script',
          description: 'Run a cluster-wide workload inventory.',
          scriptContent: 'kubectl get pods --all-namespaces',
        },
        estimatedMinutes: 2,
      }),
      createStep({
        order: 5,
        title: 'Rebuild the cluster if it is unrecoverable',
        description: 'Recreate the cluster with IaC and restore workloads through GitOps or Velero.',
        command: { type: 'manual', description: 'Recreate the cluster from Terraform or CloudFormation, then restore workloads via GitOps or Velero.' },
        estimatedMinutes: null,
        requiresApproval: true,
        notes: ['Document your GitOps or Velero restore workflow separately and keep it tested.'],
      }),
    ],
    rollback: rollback('EKS rollback depends on your GitOps and backup tooling.', [
      createStep({
        order: 1,
        title: 'Use the platform rollback procedure',
        description: 'Rebuild the previous cluster topology using your GitOps, Velero, or IaC rollback workflow.',
        command: { type: 'manual', description: 'Follow the documented GitOps or Velero rollback procedure for the cluster.' },
        estimatedMinutes: null,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(describeCluster, 'The cluster status is ACTIVE and the API endpoint is reachable.'),
    warnings: ['Cluster recovery depends heavily on how GitOps, Velero, and external secrets are configured in your platform.'],
  });
}

registerRunbookStrategy('eks', '*', {
  generate: generateEksRunbook,
  executionRisk: 'caution',
  riskReason: 'Cluster and node-group changes should be planned because workload placement can shift.',
});
registerRunbookStrategy('eks-cluster', '*', {
  generate: generateEksRunbook,
  executionRisk: 'caution',
  riskReason: 'Cluster and node-group changes should be planned because workload placement can shift.',
});
