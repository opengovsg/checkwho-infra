import {
  Bastion,
  Ecs,
  loadAwsProviderDefaultTags,
  Rds,
  SecurityGroupConnection,
  SHORT_ENV_MAP,
  Vpc,
} from '@opengovsg/pulumi-components'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

export const { env, project, team } = loadAwsProviderDefaultTags()
export const shortEnv = SHORT_ENV_MAP[env]

// Having env in every name makes multiple env (e.g. prod + stg) in one AWS account possible
const name = `checkwho-${shortEnv}`
const isProd = shortEnv === 'prod'

// ======================================== VPC =========================================
const vpc = {
  /** The CIDR Block of the VPC */
  cidrBlock: '172.31.0.0/16',
  /** Compute layer subnet IDs */
  computeSubnetIds: [
    'subnet-0570917734a5fffdd',
    'subnet-040916f0f97a438b9',
    'subnet-08ace7a856cdc3376',
  ],
  /** Edge layer subnet IDs */
  edgeSubnetIds: [
    'subnet-03d5251088f8ec500',
    'subnet-0b4a7ae647a4ed176',
    'subnet-0f8597adc7ac3b96e',
  ],
  /** The ID of the VPC */
  id: 'vpc-01f8c700692ab5d7f',
  /** Storage layer subnet IDs */
  storageSubnetIds: ['subnet-0cebeee035decc118'],
} as unknown as Vpc

// ========================== ECS (including LB) + CF/ACM cert ==========================
const ecr = new aws.ecr.Repository(
  name,
  {
    name,
    // TODO: (temporary) enable forceDelete to make teardown easier
    forceDelete: true,
  },
  {
    // must delete before replace, otherwise the specified ECR name above will cause conflict
    deleteBeforeReplace: true,
  },
)
export const ecrUri = ecr.repositoryUrl

const ecs = new Ecs(name, {
  loadBalancingArgs: {
    allowCloudFlareOriginatedTraffic: true,
  },
  vpc,
})
export const lbUrl = pulumi.interpolate`${ecs.loadBalancer.dnsName}`

// ======================================== RDS =========================================
// temporarily doesn't work, but bring up ECS first
// const allowEcsTaskToRds = new SecurityGroupConnection(
//   `${name}-ecs-task-to-rds`,
//   {
//     description: 'Allow traffic from ECS Task to RDS',
//     fromSg: ecs.taskSecurityGroup,
//     toSg: rds.securityGroup,
//     port: 5432,
//   },
// )
