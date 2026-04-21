import { EdgeType } from '../../types/infrastructure.js';
import { createResource, type Resource } from '../../types/resource.js';
import {
  PROD_ACCOUNT_CONTEXT,
  PROD_ACCOUNT_ID,
  PROD_REGION,
  STAGING_ACCOUNT_ID,
  STAGING_REGION,
  iamRootArn,
  prodArn,
  route53Arn,
} from './constants.js';

export interface FixtureEdge {
  readonly source: string;
  readonly target: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

const PROD_VPC_ARN = prodArn('ec2', 'vpc', 'prod-vpc');
const PROD_PUBLIC_SUBNET_ARN = prodArn('ec2', 'subnet', 'prod-subnet-public');
const PROD_PRIVATE_SUBNET_ARN = prodArn('ec2', 'subnet', 'prod-subnet-private');
const PROD_APP_SG_ARN = prodArn('ec2', 'security-group', 'prod-app-sg');
const PROD_DB_SG_ARN = prodArn('ec2', 'security-group', 'prod-db-sg');
const PROD_APP_INSTANCE_ARN = prodArn('ec2', 'instance', 'prod-app-server');
const PROD_RDS_ARN = prodArn('rds', 'db', 'prod-database');
const PROD_BUCKET_ARN = prodArn('s3', null, 'prod-data-bucket', null);
const PROD_LAMBDA_ARN = prodArn('lambda', 'function', 'prod-hello-function');
const PROD_KMS_ARN = prodArn('kms', 'key', 'prod-kms-key');
const PROD_SCANNER_ROLE_ARN = prodArn('iam', 'role', 'StrongholdTestScannerRole', null);
const PROD_APP_ROLE_ARN = prodArn(
  'iam',
  'role',
  'aws-service-role/ec2.amazonaws.com/StrongholdTestAppRole',
  null,
);
const PROD_HOSTED_ZONE_ARN = route53Arn('hostedzone', 'ZPRODSTRONGHOLD');
const PROD_RECORD_ARN = route53Arn(
  'recordset',
  'ZPRODSTRONGHOLD/db.internal.stronghold-test.local/A/primary',
);
const PROD_PEERING_ARN = prodArn('ec2', 'vpc-peering-connection', 'pcx-prod-staging');
const PROD_TGW_ARN = prodArn('ec2', 'transit-gateway', 'tgw-prod');

export function buildProdAccountResources(): Resource[] {
  return [
    createResource({
      arn: PROD_VPC_ARN,
      source: 'aws',
      type: 'VPC',
      name: 'prod-vpc',
      tags: {
        Name: 'prod-vpc',
        environment: 'production',
      },
      metadata: {
        region: PROD_REGION,
        vpcId: 'prod-vpc',
        cidrBlock: '10.0.0.0/16',
      },
    }),
    createResource({
      arn: PROD_PUBLIC_SUBNET_ARN,
      source: 'aws',
      type: 'SUBNET',
      name: 'prod-subnet-public',
      tags: {
        Name: 'prod-subnet-public',
        tier: 'public',
      },
      metadata: {
        region: PROD_REGION,
        subnetId: 'prod-subnet-public',
        vpcId: 'prod-vpc',
        cidrBlock: '10.0.1.0/24',
        availabilityZone: 'eu-west-3a',
      },
    }),
    createResource({
      arn: PROD_PRIVATE_SUBNET_ARN,
      source: 'aws',
      type: 'SUBNET',
      name: 'prod-subnet-private',
      tags: {
        Name: 'prod-subnet-private',
        tier: 'private',
      },
      metadata: {
        region: PROD_REGION,
        subnetId: 'prod-subnet-private',
        vpcId: 'prod-vpc',
        cidrBlock: '10.0.2.0/24',
        availabilityZone: 'eu-west-3b',
      },
    }),
    createResource({
      arn: PROD_APP_SG_ARN,
      source: 'aws',
      type: 'SECURITY_GROUP',
      name: 'prod-app-sg',
      metadata: {
        region: PROD_REGION,
        securityGroupId: 'prod-app-sg',
        vpcId: 'prod-vpc',
      },
    }),
    createResource({
      arn: PROD_DB_SG_ARN,
      source: 'aws',
      type: 'SECURITY_GROUP',
      name: 'prod-db-sg',
      metadata: {
        region: PROD_REGION,
        securityGroupId: 'prod-db-sg',
        vpcId: 'prod-vpc',
      },
    }),
    createResource({
      arn: PROD_APP_INSTANCE_ARN,
      source: 'aws',
      type: 'EC2',
      name: 'prod-app-server',
      tags: {
        Name: 'prod-app-server',
        service: 'orders',
        environment: 'production',
      },
      metadata: {
        region: PROD_REGION,
        instanceType: 't3.micro',
        subnetId: 'prod-subnet-private',
        vpcId: 'prod-vpc',
        securityGroups: ['prod-app-sg'],
      },
    }),
    createResource({
      arn: PROD_RDS_ARN,
      source: 'aws',
      type: 'RDS',
      name: 'prod-database',
      tags: {
        Name: 'prod-database',
        service: 'orders',
      },
      metadata: {
        region: PROD_REGION,
        dbIdentifier: 'prod-database',
        engine: 'mysql',
        dbInstanceArn: PROD_RDS_ARN,
        kmsKeyArn: PROD_KMS_ARN,
        subnetId: 'prod-subnet-private',
        vpcId: 'prod-vpc',
        securityGroups: ['prod-db-sg'],
      },
    }),
    createResource({
      arn: PROD_BUCKET_ARN,
      source: 'aws',
      type: 'S3_BUCKET',
      name: 'prod-data-bucket',
      account: PROD_ACCOUNT_CONTEXT,
      tags: {
        Name: 'prod-data-bucket',
        environment: 'production',
      },
      metadata: {
        region: PROD_REGION,
        bucketName: 'prod-data-bucket',
        bucketArn: PROD_BUCKET_ARN,
        encryption: {
          sseAlgorithm: 'aws:kms',
          kmsMasterKeyId: PROD_KMS_ARN,
        },
        kmsKeyArn: PROD_KMS_ARN,
      },
    }),
    createResource({
      arn: PROD_LAMBDA_ARN,
      source: 'aws',
      type: 'LAMBDA',
      name: 'prod-hello-function',
      metadata: {
        region: PROD_REGION,
        functionArn: PROD_LAMBDA_ARN,
        functionName: 'prod-hello-function',
        subnetId: 'prod-subnet-private',
        vpcId: 'prod-vpc',
        securityGroups: ['prod-app-sg'],
      },
    }),
    createResource({
      arn: PROD_KMS_ARN,
      source: 'aws',
      type: 'KMS_KEY',
      name: 'prod-kms-key',
      metadata: {
        region: PROD_REGION,
        keyId: 'prod-kms-key',
        keyRotationEnabled: true,
        keyPolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'AllowStagingDecrypt',
              Effect: 'Allow',
              Action: ['kms:Decrypt', 'kms:GenerateDataKey*'],
              Principal: {
                AWS: iamRootArn(STAGING_ACCOUNT_ID),
              },
            },
          ],
        }),
        grants: [
          {
            GrantId: 'grant-staging-root',
            GranteePrincipal: iamRootArn(STAGING_ACCOUNT_ID),
            Operations: ['Decrypt', 'GenerateDataKey'],
          },
        ],
      },
    }),
    createResource({
      arn: PROD_SCANNER_ROLE_ARN,
      source: 'aws',
      type: 'IAM_ROLE',
      name: 'StrongholdTestScannerRole',
      metadata: {
        roleName: 'StrongholdTestScannerRole',
        path: '/service-role/',
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'sts:AssumeRole',
              Principal: {
                AWS: iamRootArn(STAGING_ACCOUNT_ID),
              },
            },
          ],
        }),
        managedPolicies: ['arn:aws:iam::aws:policy/ReadOnlyAccess'],
      },
    }),
    createResource({
      arn: PROD_APP_ROLE_ARN,
      source: 'aws',
      type: 'IAM_ROLE',
      name: 'StrongholdTestAppRole',
      metadata: {
        roleName: 'StrongholdTestAppRole',
        path: '/aws-service-role/ec2.amazonaws.com/',
        description: 'Service-linked style application role used as a negative control.',
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: 'sts:AssumeRole',
              Principal: {
                Service: 'ec2.amazonaws.com',
              },
            },
          ],
        }),
      },
    }),
    createResource({
      arn: PROD_HOSTED_ZONE_ARN,
      source: 'aws',
      type: 'ROUTE53_HOSTED_ZONE',
      name: 'internal.stronghold-test.local',
      account: PROD_ACCOUNT_CONTEXT,
      metadata: {
        region: 'global',
        hostedZoneId: 'ZPRODSTRONGHOLD',
        name: 'internal.stronghold-test.local',
        isPrivate: true,
        recordCount: 2,
        recordNames: ['app.internal.stronghold-test.local'],
        vpcAssociations: [
          {
            vpcId: 'prod-vpc',
            vpcRegion: PROD_REGION,
            vpcOwnerId: PROD_ACCOUNT_ID,
            accountId: PROD_ACCOUNT_ID,
            vpcAssociationId: 'ZPRODSTRONGHOLD:prod-vpc',
          },
          {
            vpcId: 'staging-vpc',
            vpcRegion: STAGING_REGION,
            vpcOwnerId: STAGING_ACCOUNT_ID,
            accountId: STAGING_ACCOUNT_ID,
            vpcAssociationId: 'ZPRODSTRONGHOLD:staging-vpc',
          },
        ],
      },
    }),
    createResource({
      arn: PROD_RECORD_ARN,
      source: 'aws',
      type: 'ROUTE53_RECORD',
      name: 'db.internal.stronghold-test.local',
      account: PROD_ACCOUNT_CONTEXT,
      metadata: {
        region: 'global',
        hostedZoneId: 'ZPRODSTRONGHOLD',
        recordName: 'db.internal.stronghold-test.local',
        recordType: 'A',
        aliasTargetDnsName: 'prod-database.cluster-abcdefgh.eu-west-3.rds.amazonaws.com.',
      },
    }),
    createResource({
      arn: PROD_PEERING_ARN,
      source: 'aws',
      type: 'VPC_PEERING_CONNECTION',
      name: 'pcx-prod-staging',
      metadata: {
        region: PROD_REGION,
        peeringConnectionId: 'pcx-prod-staging',
        requesterOwnerId: PROD_ACCOUNT_ID,
        accepterOwnerId: STAGING_ACCOUNT_ID,
        requesterVpcId: 'prod-vpc',
        accepterVpcId: 'staging-vpc',
        requesterRegion: PROD_REGION,
        accepterRegion: STAGING_REGION,
        status: 'active',
        routeTableIds: ['rtb-prod-core'],
      },
    }),
    createResource({
      arn: PROD_TGW_ARN,
      source: 'aws',
      type: 'TRANSIT_GATEWAY',
      name: 'core-transit',
      metadata: {
        region: PROD_REGION,
        tgwId: 'tgw-prod',
        transitGatewayId: 'tgw-prod',
      },
    }),
  ];
}

export function buildProdAccountEdges(): readonly FixtureEdge[] {
  return [
    createFixtureEdge(PROD_VPC_ARN, PROD_PUBLIC_SUBNET_ARN, EdgeType.CONTAINS, {
      relation: 'vpc_contains_subnet',
    }),
    createFixtureEdge(PROD_VPC_ARN, PROD_PRIVATE_SUBNET_ARN, EdgeType.CONTAINS, {
      relation: 'vpc_contains_subnet',
    }),
    createFixtureEdge(PROD_VPC_ARN, PROD_APP_SG_ARN, EdgeType.CONTAINS, {
      relation: 'vpc_contains_security_group',
    }),
    createFixtureEdge(PROD_VPC_ARN, PROD_DB_SG_ARN, EdgeType.CONTAINS, {
      relation: 'vpc_contains_security_group',
    }),
    createFixtureEdge(PROD_APP_INSTANCE_ARN, PROD_RDS_ARN, EdgeType.DEPENDS_ON, {
      relation: 'app_reads_database',
    }),
    createFixtureEdge(PROD_APP_INSTANCE_ARN, PROD_BUCKET_ARN, EdgeType.DEPENDS_ON, {
      relation: 'app_reads_bucket',
    }),
    createFixtureEdge(PROD_RDS_ARN, PROD_KMS_ARN, EdgeType.DEPENDS_ON, {
      relation: 'database_encrypted_by_kms',
    }),
    createFixtureEdge(PROD_BUCKET_ARN, PROD_KMS_ARN, EdgeType.DEPENDS_ON, {
      relation: 'bucket_encrypted_by_kms',
    }),
    createFixtureEdge(PROD_LAMBDA_ARN, PROD_VPC_ARN, EdgeType.PLACED_IN, {
      relation: 'lambda_deployed_in_vpc',
    }),
    createFixtureEdge(PROD_SCANNER_ROLE_ARN, PROD_APP_INSTANCE_ARN, EdgeType.IAM_ACCESS, {
      relation: 'scanner_reads_instance',
    }),
    createFixtureEdge(PROD_HOSTED_ZONE_ARN, PROD_RECORD_ARN, EdgeType.CONTAINS, {
      relation: 'zone_contains_record',
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
