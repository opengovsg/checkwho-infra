import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import { GithubOidc, PulumiS3States } from "@opengovsg/pulumi-helpers";

const github = new GithubOidc("sk-infra", {
  repo: "opengovsg/starter-kit-infra",
});

export const githubOidcRoleArn = github.role.arn;

const pulumiS3States = new PulumiS3States("sk-infra", {});

export const s3Uri = pulumiS3States.s3Uri;
export const keyUri = pulumiS3States.keyUri;
