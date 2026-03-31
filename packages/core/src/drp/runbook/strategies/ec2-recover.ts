import { readNumber, readString } from '../../../graph/analysis-helpers.js';
import {
  awsCli,
  awsWait,
  componentRunbook,
  createStep,
  joinCliValues,
  resolveIdentifier,
  resolveRegion,
  resolveSecurityGroups,
  rollback,
  verification,
  withOption,
} from '../runbook-helpers.js';
import { registerRunbookStrategy } from '../strategy-registry.js';
import type { ComponentRunbook } from '../runbook-types.js';

function generateEc2Runbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  return readString(metadata.autoScalingGroupName)
    ? buildAsgRunbook(componentId, componentName, componentType, strategy, metadata)
    : buildStandaloneRunbook(componentId, componentName, componentType, strategy, metadata);
}

function buildAsgRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const asgName = resolveIdentifier(metadata, ['autoScalingGroupName'], componentId);
  const region = resolveRegion(metadata);
  const desiredCapacity = readNumber(metadata.asgDesiredCapacity) ?? readNumber(metadata.desiredCapacity) ?? 1;
  const healthCommand =
    `aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${asgName} --query "AutoScalingGroups[0].[DesiredCapacity,Instances[*].HealthStatus]" --region ${region}`;
  const forceCapacity =
    `aws autoscaling set-desired-capacity --auto-scaling-group-name ${asgName} --desired-capacity ${desiredCapacity} --region ${region}`;
  const waitCommand =
    `aws ec2 wait instance-running --filters "Name=tag:aws:autoscaling:groupName,Values=${asgName}" --region ${region}`;

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Confirm the Auto Scaling group launch template or launch configuration is still valid.'],
    steps: [
      createStep({
        order: 1,
        title: 'Verify Auto Scaling group replacement',
        description: 'Check whether the ASG is already replacing the failed instance automatically.',
        command: awsCli(healthCommand, 'Shows desired capacity and instance health for the ASG.'),
        estimatedMinutes: 1,
        notes: ['The ASG should normally replace unhealthy instances automatically.'],
        verification: verification(healthCommand, 'Desired capacity is met and at least one instance reports Healthy.'),
      }),
      createStep({
        order: 2,
        title: 'Force desired capacity if replacement stalled',
        description: 'Reassert the intended ASG desired capacity if automatic replacement did not happen.',
        command: awsCli(forceCapacity, 'Sets the desired capacity on the Auto Scaling group.'),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: ['Only run this if step 1 shows the instance was not replaced automatically.'],
      }),
      createStep({
        order: 3,
        title: 'Wait for a replacement instance',
        description: 'Block until an ASG-managed instance reaches the running state.',
        command: awsWait(waitCommand, 'Waits for at least one ASG-managed instance to be running.'),
        estimatedMinutes: null,
      }),
    ],
    rollback: rollback('Restore the ASG to its original desired capacity if you changed it during recovery.', [
      createStep({
        order: 1,
        title: 'Reset desired capacity',
        description: 'Set the Auto Scaling group back to the original desired capacity.',
        command: awsCli(forceCapacity, 'Restores the original desired capacity on the ASG.'),
        estimatedMinutes: 1,
        requiresApproval: true,
      }),
    ]),
    finalValidation: verification(healthCommand, 'The ASG reports the desired capacity and healthy instance replacements.'),
  });
}

function buildStandaloneRunbook(
  componentId: string,
  componentName: string,
  componentType: string,
  strategy: string,
  metadata: Record<string, unknown>,
): ComponentRunbook {
  const region = resolveRegion(metadata);
  const instanceType = readString(metadata.instanceType) ?? 't3.medium';
  const subnetId = readString(metadata.subnetId);
  const securityGroups = joinCliValues(resolveSecurityGroups(metadata));
  const amiLookup =
    `aws ec2 describe-images --owners self --filters "Name=name,Values=*${componentName}*" --query "reverse(sort_by(Images,&CreationDate))[0].ImageId" --output text --region ${region}`;
  const runInstances = withOption(
    withOption(
      `aws ec2 run-instances --image-id <AMI_ID> --instance-type ${instanceType}`,
      '--subnet-id',
      subnetId,
    ),
    '--security-group-ids',
    securityGroups || null,
  );

  return componentRunbook({
    componentId,
    componentName,
    componentType,
    strategy,
    prerequisites: ['Verify that a recent AMI or EBS snapshot exists for this standalone instance.'],
    steps: [
      createStep({
        order: 1,
        title: 'Find the latest AMI',
        description: 'Select the newest AMI matching this instance naming pattern.',
        command: awsCli(amiLookup, 'Returns the most recent self-owned AMI ID matching the instance name.'),
        estimatedMinutes: 1,
      }),
      createStep({
        order: 2,
        title: 'Launch a replacement instance',
        description: 'Create a new EC2 instance from the selected AMI in the target subnet.',
        command: awsCli(`${runInstances} --region ${region}`, 'Launches a new EC2 instance from the selected AMI.'),
        estimatedMinutes: 2,
        requiresApproval: true,
        notes: ['Replace <AMI_ID> with the result of the previous step.', 'Record the new instance ID returned by this command for the wait and rollback steps.'],
      }),
      createStep({
        order: 3,
        title: 'Wait for the new instance to run',
        description: 'Block until the newly created EC2 instance enters the running state.',
        command: awsWait(
          `aws ec2 wait instance-running --instance-ids <NEW_INSTANCE_ID> --region ${region}`,
          'Waits for the new instance to be running.',
        ),
        estimatedMinutes: null,
        notes: ['Replace <NEW_INSTANCE_ID> with the instance ID returned by the previous step.'],
      }),
    ],
    rollback: rollback('Terminate the replacement instance if the rebuild attempt is not needed or was created incorrectly.', [
      createStep({
        order: 1,
        title: 'Terminate the replacement instance',
        description: 'Remove the newly launched instance.',
        command: awsCli(
          `aws ec2 terminate-instances --instance-ids <NEW_INSTANCE_ID> --region ${region}`,
          'Terminates the replacement EC2 instance.',
        ),
        estimatedMinutes: 1,
        requiresApproval: true,
        notes: ['Replace <NEW_INSTANCE_ID> with the instance ID returned by the launch step.'],
      }),
    ]),
    finalValidation: verification(
      `aws ec2 describe-instances --instance-ids <NEW_INSTANCE_ID> --region ${region} --query "Reservations[0].Instances[0].[State.Name,PrivateIpAddress]"`,
      'The replacement instance state is running and it has a private IP address.',
    ),
    warnings: ['Standalone EC2 recovery may still require reattaching Elastic IPs, volumes, or bootstrap configuration.'],
  });
}

registerRunbookStrategy('ec2', '*', generateEc2Runbook);
registerRunbookStrategy('ec2-instance', '*', generateEc2Runbook);
