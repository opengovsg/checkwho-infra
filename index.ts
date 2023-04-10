import {
  Bastion,
  CfValidatedCert,
  Ecs,
  GithubOidc,
  loadAwsProviderDefaultTags,
  Rds,
  SecurityGroupConnection,
  SHORT_ENV_MAP,
  SsmParams,
  Vpc,
} from '@opengovsg/pulumi-components'
import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'

export const { env, project, team } = loadAwsProviderDefaultTags()
export const shortEnv = SHORT_ENV_MAP[env]

// Having env in every name makes multiple env (e.g. prod + stg) in one AWS account possible
const name = `checkwho-${shortEnv}`
const isProd = shortEnv === 'prod'

const cfValidatedCert = new CfValidatedCert(name, {
  cfZoneId: '7f702ea2e13fb4f9cd204be342e080c0',
  domainName: isProd ? 'checkwho.gov.sg' : 'staging.checkwho.gov.sg',
})

// GitHub OIDC for GitHub repo to talk to AWS
const oidc = new GithubOidc(name, {
  repos: ['CheckWho', 'checkwho-infra'],
  organization: 'opengovsg',
  roleArgs: {
    name: `${name}-github-oidc-role`,
  },
})
export const githubOidcRoleArn = oidc.role.arn

// ======================================== VPC =========================================
const vpc = new Vpc(name, {
  isProd,
  secondOctet: 16,
  // enableS3GatewayVpcEndpoint: true,
})

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

const ecs = new Ecs(
  name,
  {
    loadBalancingArgs: {
      allowCloudFlareOriginatedTraffic: true,
      allowOgpVpnOriginatedTraffic: true,
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

// ======================================== RDS =========================================
const rds = new Rds(name, {
  // TODO: (temporary) use dangerouslyPrepareForDeletion to make teardown easier
  dangerouslyPrepareForDeletion: true,
  isProd,
  vpc,
})
const allowEcsTaskToRds = new SecurityGroupConnection(
  `${name}-ecs-task-to-rds`,
  {
    description: 'Allow traffic from ECS Task to RDS',
    fromSg: ecs.taskSecurityGroup,
    toSg: rds.securityGroup,
    port: 5432,
  },
)

// ======================================= Bastion ======================================
const publicKey =
  shortEnv === 'prod'
    ? 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINZiy7lp0dDuKE1o7I0mSbPMgMaBp5y2NZM7YObJGDC7'
    : 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMi6eFyN4+Hw3tQHSLjOxaijUQ6LbF2l+/4/8ir5LOgV'
const bastion = new Bastion(name, { vpc, publicKey })
export const bastionSshCommand = bastion.sshCommand

const allowBastionToRds = new SecurityGroupConnection(
  `${name}-bastion-to-rds`,
  {
    description: 'Allow traffic from Bastion EC2 to RDS',
    fromSg: bastion.securityGroup,
    toSg: rds.securityGroup,
    port: 5432,
  },
)

const params = new SsmParams(name, {
  env: shortEnv,
  prefix: `${shortEnv}/checkwho`,
  specs: [
    // DB
    { key: 'DB_HOST', value: rds.secrets.endpoint },
    { key: 'DB_HOST_REPLICA', value: rds.secrets.readerEndpoint },
    { key: 'DB_NAME', value: rds.secrets.database },
    {
      key: 'DB_PASSWORD',
      secure: true,
      value: rds.secrets.password,
    },
    { key: 'DB_PORT', value: rds.secrets.port },
    { key: 'DB_USERNAME', value: rds.secrets.username },
  ],
})
