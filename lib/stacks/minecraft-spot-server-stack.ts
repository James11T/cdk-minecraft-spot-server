import "dotenv/config";
import * as cdk from "aws-cdk-lib/core";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import MinecraftSpotServer from "../constructs/minecraft-spot-server";
import * as dotenv from "dotenv";
import * as fs from "fs";
import { Construct } from "constructs";
import { assertEnvs } from "../utils/assertive-env";

const CONTAINER_ENV_FILE = ".env.container";

if (!fs.existsSync(CONTAINER_ENV_FILE))
  throw new Error(".env.container not found");

const containerEnvironment = dotenv.parse(fs.readFileSync(".env.container"));

const env = assertEnvs(
  "SPOT_PRICE",
  "EFS_BACKUPS",
  "S3_BACKUPS",
  "IMAGE_TAG",
  "EC2_KEY_NAME",
  "SSH_SOURCE_CIDR",
  "INSTANCE_TYPE",
  "SERVER_PORT",
  "RCON_PORT",
  "RCON_PASSWORD",
  "HOSTED_ZONE_ID",
  "DNS_RECORD_NAME"
);

const { SERVER_PORT } = process.env;

class MinecraftSpotServerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new MinecraftSpotServer(this, "mc-server", {
      instanceType: new ec2.InstanceType(env.INSTANCE_TYPE),
      imageTag: env.IMAGE_TAG,
      spotPrice: env.SPOT_PRICE,
      ec2KeyName: env.EC2_KEY_NAME,
      sshCIDR: env.SSH_SOURCE_CIDR,
      efsBackup: env.EFS_BACKUPS.toUpperCase() === "TRUE",
      s3Backup: env.S3_BACKUPS.toUpperCase() === "TRUE",
      serverPort: Number(SERVER_PORT),
      containerEnvironment,
      rconPort: Number(env.RCON_PORT),
      rconPassword: env.RCON_PASSWORD,
      hostedZoneId: env.HOSTED_ZONE_ID,
      dnsRecordName: env.DNS_RECORD_NAME,
    });
  }
}

export default MinecraftSpotServerStack;
