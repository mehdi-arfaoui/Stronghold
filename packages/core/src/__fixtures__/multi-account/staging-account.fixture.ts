import { EdgeType } from '../../types/infrastructure.js';
import { createResource, type Resource } from '../../types/resource.js';
import {
  PROD_ACCOUNT_ID,
  PROD_REGION,
  STAGING_ACCOUNT_CONTEXT,
  STAGING_ACCOUNT_ID,
  STAGING_REGION,
  iamRootArn,
  prodArn,
  stagingArn,
} from './constants.js';
import type { FixtureEdge } from './prod-account.fixture.js';

const STAGING_VPC_ARN = stagingArn('ec2', 'vpc', 'staging-vpc');
const STAGING_PUBLIC_SUBNET_ARN = stagingArn('ec2', 'subnet', 'staging-subnet-public');
const STAGING_SG_ARN = stagingArn('ec2', 'security-group', 'staging-sg');
const STAGING_APP_INSTANCE_ARN = stagingArn('ec2', 'instance', 'staging-app-server');
const STAGING_BUCKET_ARN = stagingArn('s3', null, 'staging-data-bucket', null);
const STAGING_ASSUME_ROLE_ARN = stagingArn('iam', 'role', 'StrongholdTestCrossAccountRole', null);
const STAGING_ROOT_ARN = iamRootArn(STAGING_ACCOUNT_ID);
const STAGING_PEERING_ARN = stagingArn(
  'ec2',
  'vpc-peering-connection',
  'pcx-prod-staging',
);
const STAGING_TGW_ATTACHMENT_ARN = stagingArn(
  'ec2',
  'transit-gateway-attachment',
  'tgw-attach-shared-core',
);

export function buildStagingAccountResources(): Resource[] {
  return [
    createResource({
      arn: STAGING_VPC_ARN,
      source: 'aws',
      type: 'VPC',
      name: 'staging-vpc',
      tags: {
        Name: 'staging-vpc',
        environment: 'staging',
      },
      metadata: {
        region: STAGING_REGION,
        vpcId: 'staging-vpc',
        cidrBlock: '10.1.0.0/16',
      },
    }),
    createResource({
      arn: STAGING_PUBLIC_SUBNET_ARN,
      source: 'aws',
      type: 'SUBNET',
      name: 'staging-subnet-public',
      tags: {
        Name: 'staging-subnet-public',
      },
      metadata: {
        region: STAGING_REGION,
        subnetId: 'staging-subnet-public',
        vpcId: 'staging-vpc',
        cidrBlock: '10.1.1.0/24',
        availabilityZone: 'eu-west-3a',
      },
    }),
    createResource({
      arn: STAGING_SG_ARN,
      source: 'aws',
      type: 'SECURITY_GROUP',
      name: 'staging-sg',
      metadata: {
        region: STAGING_REGION,
        securityGroupId: 'staging-sg',
        vpcId: 'staging-vpc',
      },
    }),
    createResource({
      arn: STAGING_APP_INSTANCE_ARN,
      source: 'aws',
      type: 'EC2',
      name: 'staging-app-server',
      tags: {
        Name: 'staging-app-server',
        service: 'orders',
        environment: 'staging',
      },
      metadata: {
        region: STAGING_REGION,
        instanceType: 't3.micro',
        subnetId: 'staging-subnet-public',
        vpcId: 'staging-vpc',
        securityGroups: ['staging-sg'],
      },
    }),
    createResource({
      arn: STAGING_BUCKET_ARN,
      source: 'aws',
      type: 'S3_BUCKET',
      name: 'staging-data-bucket',
      account: STAGING_ACCOUNT_CONTEXT,
      tags: {
        Name: 'staging-data-bucket',
      },
      metadata: {
        region: STAGING_REGION,
        bucketName: 'staging-data-bucket',
        bucketArn: STAGING_BUCKET_ARN,
      },
    }),
    createResource({
      arn: STAGING_ASSUME_ROLE_ARN,
      source: 'aws',
      type: 'IAM_ROLE',
      name: 'StrongholdTestCrossAccountRole',
      metadata: {
        roleName: 'StrongholdTestCrossAccountRole',
        path: '/service-role/',
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'sts:AssumeRole',
              Principal: {
                AWS: STAGING_ROOT_ARN,
              },
            },
          ],
        }),
        inlinePolicies: [
          {
            policyName: 'AssumeProdScannerRole',
            policyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: 'sts:AssumeRole',
                  Resource: prodArn(
                    'iam',
                    'role',
                    'StrongholdTestScannerRole',
                    null,
                  ),
                },
              ],
            },
          },
        ],
      },
    }),
    createResource({
      arn: STAGING_ROOT_ARN,
      source: 'aws',
      type: 'ACCOUNT_PRINCIPAL',
      name: 'staging-root',
      metadata: {
        accountId: STAGING_ACCOUNT_ID,
      },
    }),
    createResource({
      arn: STAGING_PEERING_ARN,
      source: 'aws',
      type: 'VPC_PEERING_CONNECTION',
      name: 'pcx-prod-staging',
      metadata: {
        region: STAGING_REGION,
        peeringConnectionId: 'pcx-prod-staging',
        requesterOwnerId: PROD_ACCOUNT_ID,
        accepterOwnerId: STAGING_ACCOUNT_ID,
        requesterVpcId: 'prod-vpc',
        accepterVpcId: 'staging-vpc',
        requesterRegion: PROD_REGION,
        accepterRegion: STAGING_REGION,
        status: 'active',
        routeTableIds: ['rtb-staging-core'],
      },
    }),
    createResource({
      arn: STAGING_TGW_ATTACHMENT_ARN,
      source: 'aws',
      type: 'TRANSIT_GATEWAY_ATTACHMENT',
      name: 'shared-core-attachment',
      metadata: {
        region: STAGING_REGION,
        attachmentId: 'tgw-attach-shared-core',
        transitGatewayAttachmentId: 'tgw-attach-shared-core',
        tgwId: 'tgw-prod',
        transitGatewayId: 'tgw-prod',
        tgwOwnerId: PROD_ACCOUNT_ID,
        transitGatewayOwnerId: PROD_ACCOUNT_ID,
        attachmentType: 'vpc',
        routeTableId: 'tgw-rtb-core',
        state: 'available',
      },
    }),
  ];
}

export function buildStagingAccountEdges(): readonly FixtureEdge[] {
  return [
    createFixtureEdge(STAGING_VPC_ARN, STAGING_PUBLIC_SUBNET_ARN, EdgeType.CONTAINS, {
      relation: 'vpc_contains_subnet',
    }),
    createFixtureEdge(STAGING_VPC_ARN, STAGING_SG_ARN, EdgeType.CONTAINS, {
      relation: 'vpc_contains_security_group',
    }),
    createFixtureEdge(STAGING_APP_INSTANCE_ARN, STAGING_BUCKET_ARN, EdgeType.DEPENDS_ON, {
      relation: 'app_reads_bucket',
    }),
    createFixtureEdge(STAGING_APP_INSTANCE_ARN, STAGING_SG_ARN, EdgeType.SECURED_BY, {
      relation: 'instance_secured_by_group',
    }),
    createFixtureEdge(
      STAGING_ASSUME_ROLE_ARN,
      prodArn('iam', 'role', 'StrongholdTestScannerRole', null),
      EdgeType.IAM_ACCESS,
      {
        relation: 'role_can_assume_prod_scanner_role',
      },
    ),
    createFixtureEdge(STAGING_TGW_ATTACHMENT_ARN, STAGING_VPC_ARN, EdgeType.DEPENDS_ON, {
      relation: 'attachment_connects_vpc',
    }),
  ];
}

function createFixtureEdge(
  source: string,
  target: string,
  type: string,
  metadata: Readonly<Record<string, unknown>>,
): FixtureEdge {
  return {
    source,
    target,
    attributes: {
      type,
      confidence: 1,
      confirmed: true,
      provenance: 'manual',
      metadata,
    },
  };
}
