import {
  Bastion,
  CfValidatedCert,
  Ecs,
  loadAwsProviderDefaultTags,
  Rds,
  SecurityGroupConnection,
  SHORT_ENV_MAP,
  Vpc,
} from '@opengovsg/pulumi-components'
import * as aws from '@pulumi/aws'
import * as cf from '@pulumi/cloudflare'
import * as pulumi from '@pulumi/pulumi'
import * as random from '@pulumi/random'

// Cloudflare Zone ID for beta.gov.sg
const CF_BETA_GOV_SG_ZONE_ID = '44d3a0d87e778b6d1a53cb8ef882bd32'

export const { env, project, team } = loadAwsProviderDefaultTags()
export const shortEnv = SHORT_ENV_MAP[env]

// Having env in every name makes multiple env (e.g. prod + stg) in one AWS account possible
const name = `sk-infra-${shortEnv}`
const isProd = shortEnv === 'prod'

const domainName = `${name}.beta.gov.sg`
export const dnsClickMe = domainName

// ======================================== VPC =========================================
const vpc = new Vpc(name, {
  isProd,
  secondOctet: 16,
  // enableS3GatewayVpcEndpoint: true,
})

// ========================== ECS (including LB) + CF/ACM cert ==========================
const cfValidatedCert = new CfValidatedCert(name, {
  cfZoneId: CF_BETA_GOV_SG_ZONE_ID,
  domainName,
})

const ecr = new aws.ecr.Repository(
  name,
  { name },
  {
    // must delete before replace, otherwise the specified ECR name above will cause conflict
    deleteBeforeReplace: true,
  },
)
export const ecrUri = ecr.repositoryUrl

const ecs = new Ecs(
  name,
  {
    loadBalancingArgs: {
      allowCloudFlareOriginatedTraffic: true,
      httpsCertificateArn: cfValidatedCert.certificate.arn,
    },
    vpc,
  },
  {
    // Unfortunately dependency in Pulumi doesn't work at the ComponentResource level.
    // We have to manually state child resource dependency when needed.
    // This particular dependency makes sure that our ALB will only be created after the HTTPS cert
    // has been validated, otherwise the cert cannot be issued thus cannot be attached to the ALB.
    dependsOn: cfValidatedCert.validation,
  },
)
export const lbUrl = pulumi.interpolate`${ecs.loadBalancer.dnsName}`

const cfMainRecord = new cf.Record(
  `${name}-dns-record`,
  {
    zoneId: CF_BETA_GOV_SG_ZONE_ID,
    name: domainName,
    type: 'CNAME',
    value: ecs.loadBalancer.dnsName,
    proxied: true,
  },
  { deleteBeforeReplace: true },
)

// ======================================== RDS =========================================
const rds = new Rds(name, { isProd, vpc })
export const psqlCommand = rds.psqlCommand

const allowEcsTaskToRds = new SecurityGroupConnection(
  `${name}-ecs-task-to-rds`,
  {
    description: 'Allow traffic from ECS Task to RDS',
    fromSg: ecs.taskSecurityGroup,
    toSg: rds.securityGroup,
    fromPort: 5432,
    toPort: 5432,
    vpc,
  },
)

// ======================================= Bastion ======================================
const publicKey =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDXcnNolVyTz1qniprzPy8WHYg/ChE6ow6ZADCi5DVds blake@open.gov.sg'
const bastion = new Bastion(name, { vpc, publicKey })
export const bastionSshCommand = bastion.sshCommand

const allowBastionToRds = new SecurityGroupConnection(
  `${name}-bastion-to-rds`,
  {
    description: 'Allow traffic from Bastion EC2 to RDS',
    fromSg: bastion.securityGroup,
    toSg: rds.securityGroup,
    fromPort: 5432,
    toPort: 5432,
    vpc,
  },
)

// ================================= Application Secrets ================================
const appRandomSessionSecret = new random.RandomPassword(
  `${name}-random-session-secret`,
  {
    length: 32,
    special: true,
  },
)
const appSessionSecret = new aws.ssm.Parameter(
  `${name}-session-secret`,
  {
    name: `${name}-session-secret`,
    type: 'SecureString',
    value: appRandomSessionSecret.result,
  },
  {
    // must delete before replace, otherwise the specified session secret name above will cause conflict
    deleteBeforeReplace: true,
  },
)
