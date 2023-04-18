# CheckWho Infra Repo

## Setup

When creating a new stack, it is helpful to comment out the GitHub OIDC provider in `index.ts`. Not sure whether this is a bug hmm.

Other issues encountered:

- NAT Gateway and Elastic IPs creation failed, because each account can only have 5 Elastic IPs. This is a limit imposed by AWS. To resolve, you could either delete the Elastic IPs in the account, or request for a limit increase.

## Branching

Follow the [OGP Branching practices](https://github.com/opengovsg/engineering-practices/blob/develop/source-control/branching.md).

- `staging`: the PR is checked against `staging` environment, **deploy to `staging` on merge**
- `production` (create when moving to production): the PR is checked against `production` environment, **deploy to `production` on merge**
