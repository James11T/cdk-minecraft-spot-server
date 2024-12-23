#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import MinecraftSpotServerStack from "../lib/stacks/minecraft-spot-server-stack";

const app = new cdk.App();

new MinecraftSpotServerStack(app, "mc-server-stack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
