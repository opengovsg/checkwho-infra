# First time setup

For now, there are some manual steps involved to get this repository up and running. They will be moved into scripts eventually.

## Prepare names

Please prepare the names of your project and team. For this guide, they will be referred to:

- `your-project-name`
- `your-project-short-name` (a shorter version (less than 10 characters) of your project name. If the project name is short enough, this can be the same as the project name)
- `your-team-name`

**To speed up the process, copy this page to your editor, and replace all the `your-project-name`, `your-project-short-name` and `your-team-name` to the real values you have, so that subsequently the commands can be copied and executed directly.**

## Check AWS access

For the first time setup, you will need programmatic access to your AWS account.

```bash
aws sts get-caller-identify
# check if it is the correct account
```

## Install dependencies

```bash
brew install pulumi

git clone git@github.com:opengovsg/starter-kit-infra your-project-name
cd your-project-name

git grep -l 'starter-kit-infra' | grep -v '.github' | xargs sed -i '' -e 's/starter-kit-infra/your-project-name/g'
git grep -l 'sk-infra' | grep -v '.github' | xargs sed -i '' -e 's/sk-infra/your-project-short-name/g'
git grep -l 'starter-kit-team' | grep -v '.github' | xargs sed -i '' -e 's/starter-kit-team/your-team-name/g'
npm i

export PULUMI_CONFIG_PASSPHRASE=''
pulumi login file://~
mv Pulumi.sk-infra.staging.yaml Pulumi.your-project-short-name.staging.yaml
pulumi stack init your-project-short-name.staging

pulumi up
# select `yes` if all the resources seem reasonable

githubOidcRoleArn=$(pulumi stack output githubOidcRoleArn)
s3Uri=$(pulumi stack output s3Uri)
git grep -l 'arn:aws:iam::075109709139:role/sk-infra-github-oidc-role-e6eab36' | xargs sed -i '' -e 's,arn:aws:iam::075109709139:role/sk-infra-github-oidc-role-e6eab36,'"$githubOidcRoleArn"',g'
git grep -l 's3://sk-infra-pulumi-s3-states-bucket-0f5edcd' | xargs sed -i '' -e 's,s3://sk-infra-pulumi-s3-states-bucket-0f5edcd,'"$s3Uri"',g'
git grep -l 'sk-infra.staging' | xargs sed -i '' -e 's/sk-infra.staging/your-project-short-name.staging/g'


pulumi stack export --show-secrets --file stack.json
# make sure `stack.json` gets created which means the export above has been successful!
pulumi stack rm your-project-short-name.staging -f --preserve-config -y
pulumi logout
pulumi login $s3Uri
pulumi stack init your-project-short-name.staging
pulumi stack import --file stack.json
# make sure the import above has been successful!
rm stack.json

pulumi stack change-secrets-provider "$(pulumi stack output keyUri)"
```

Verify things have been migrated correctly!

```bash
pulumi up
```

You should see "x unchanged".

You can push the code to Github now and continuous deployment has already been set up! If the changes are made against `develop` or `staging` branch, you should see something similar to https://github.com/opengovsg/starter-kit-infra/pull/3.

```bash
rm -rf .git # clean up carried over git history
git init
git checkout -b develop
git add .
git commit -m "chore: initial commit"
git remote add origin git@github.com:opengovsg/your-project-name.git
git push -u origin develop
```
