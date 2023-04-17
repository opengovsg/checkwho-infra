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
import * as random from '@pulumi/random'

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
// const oidc = new GithubOidc(name, {
//   repos: ['CheckWho', 'checkwho-infra'],
//   organization: 'opengovsg',
//   roleArgs: {
//     name: `${name}-github-oidc-role`,
//   },
// })
// export const githubOidcRoleArn = oidc.role.arn

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

new aws.cloudwatch.LogGroup(`${name}-logs`, {
  name: `${name}/ecs/application`, // Matched by log group specified in task definition
  retentionInDays: 0, // infinity
})

const sessionSecret = new random.RandomPassword(`${name}-session`, {
  length: 32,
  special: true,
})

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
  configKeyPrefix: `/${shortEnv}/checkwho/`,
  ssmKeyPrefix: `/${shortEnv}/checkwho/`,
  plaintextSpecs: [
    // DB
    { key: 'DB_HOST', value: rds.secrets.endpoint },
    { key: 'DB_HOST_REPLICA', value: rds.secrets.readerEndpoint },
    { key: 'DB_NAME', value: rds.secrets.database },
    { key: 'DB_PORT', value: rds.secrets.port },
    { key: 'DB_USERNAME', value: rds.secrets.username },
    {
      key: 'POSTMAN_API_URL',
      value: 'https://api.postman.gov.sg/v1/transactional/email/send',
    },
    {
      key: 'SGNOTIFY_URL',
      valueByEnv: {
        prod: 'https://ntf.singpass.gov.sg',
        [SsmParams.DEFAULT]: 'https://stg-ntf.singpass.gov.sg',
      },
    },
    {
      key: 'SGNOTIFY_E_SERVICE_ID',
      value: 'govtech-checkwho-ntf',
    },
    {
      key: 'SGNOTIFY_CLIENT_ID',
      valueByEnv: {
        prod: 'rg0DD2xOUhjDau3HQIDRvQGYtMGx3S5t',
        stg: 'jvQ98D57rodGeL1zT8C5M7ALdDdiLHeb',
      },
    },
    {
      key: 'GO_API_URL',
      valueByEnv: {
        stg: 'https://staging.go.gov.sg/api/v1/urls',
        prod: 'https://go.gov.sg/api/v1/urls',
      },
    },
  ],
  secretSpecs: [
    {
      key: 'DB_PASSWORD',
      value: rds.secrets.password,
    },
    {
      key: 'SESSION_SECRET',
      value: sessionSecret.result,
    },
    { key: 'POSTMAN_API_KEY', value: SsmParams.FROM_CONFIG },
    { key: 'ADMIN_KEY_HASH', value: SsmParams.FROM_CONFIG },
    {
      key: 'SGNOTIFY_CLIENT_SECRET',
      valueByEnv: {
        prod: SsmParams.FROM_CONFIG,
        stg: SsmParams.FROM_CONFIG,
      },
    },
    {
      key: 'SGNOTIFY_EC_PRIVATE_KEY',
      valueByEnv: {
        prod: SsmParams.FROM_CONFIG,
        stg: SsmParams.FROM_CONFIG,
      },
    },
    {
      key: 'GO_API_KEY',
      valueByEnv: {
        stg: SsmParams.FROM_CONFIG,
        prod: SsmParams.FROM_CONFIG,
      },
    },
    {
      key: 'DEFAULT_TWILIO_ACCOUNT_SID',
      value: SsmParams.FROM_CONFIG,
    },
    { key: 'DEFAULT_TWILIO_API_KEY_SID', value: SsmParams.FROM_CONFIG },
    { key: 'DEFAULT_TWILIO_API_KEY_SECRET', value: SsmParams.FROM_CONFIG },
    {
      key: 'DEFAULT_TWILIO_SENDER_ID',
      value: SsmParams.FROM_CONFIG,
    },
    {
      key: 'OGP_TWILIO_ACCOUNT_SID',
      value: SsmParams.FROM_CONFIG,
    },
    { key: 'OGP_TWILIO_API_KEY_SID', value: SsmParams.FROM_CONFIG },
    { key: 'OGP_TWILIO_API_KEY_SECRET', value: SsmParams.FROM_CONFIG },
    {
      key: 'OGP_TWILIO_SENDER_ID',
      value: SsmParams.FROM_CONFIG,
    },
    {
      key: 'MOH_TWILIO_ACCOUNT_SID',
      value: SsmParams.FROM_CONFIG,
    },
    { key: 'MOH_TWILIO_API_KEY_SID', value: SsmParams.FROM_CONFIG },
    { key: 'MOH_TWILIO_API_KEY_SECRET', value: SsmParams.FROM_CONFIG },
    {
      key: 'MOH_TWILIO_SENDER_ID',
      value: SsmParams.FROM_CONFIG,
    },
    // {
    //   key: 'MOM_TWILIO_ACCOUNT_SID',
    //   value: SsmParams.FROM_CONFIG,
    // },
    // { key: 'MOM_TWILIO_API_KEY_SID', value: SsmParams.FROM_CONFIG },
    // { key: 'MOM_TWILIO_API_KEY_SECRET', value: SsmParams.FROM_CONFIG },
    // {
    //   key: 'MOM_TWILIO_SENDER_ID',
    //   value: SsmParams.FROM_CONFIG,
    // },
  ],
})
