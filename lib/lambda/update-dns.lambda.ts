import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";
import { EventBridgeEvent } from "aws-lambda";
import { assertEnvs } from "../utils/assertive-env";

const ec2Client = new EC2Client();
const route53Client = new Route53Client();

const env = assertEnvs("HOSTED_ZONE_ID", "DNS_RECORD_NAME");

interface EC2InstanceLaunchDetail {
  AutoScalingGroupName: string;
  EC2InstanceId: string;
}

/**
 * AWS Lambda handler function to update a DNS record when a new EC2 instance is created
 *
 * @param event - Event Bridge event for an EC2 instance being started
 */
const handler = async (
  event: EventBridgeEvent<
    "EC2 Instance Launch Successful",
    EC2InstanceLaunchDetail
  >
) => {
  const instanceId = event.detail.EC2InstanceId;

  const describeInstancesCommand = new DescribeInstancesCommand({
    InstanceIds: [instanceId],
  });

  const ec2Response = await ec2Client.send(describeInstancesCommand);

  const reservations = ec2Response.Reservations;
  if (
    !reservations ||
    reservations.length === 0 ||
    !reservations[0].Instances ||
    reservations[0].Instances.length === 0
  ) {
    throw new Error("Instance not found or does not have valid data.");
  }

  const publicIp = reservations[0].Instances[0].PublicIpAddress;

  if (!publicIp) {
    throw new Error("Public IP address not found for the instance.");
  }

  const changeResourceRecordSetsCommand = new ChangeResourceRecordSetsCommand({
    HostedZoneId: env.HOSTED_ZONE_ID,
    ChangeBatch: {
      Comment: "updating",
      Changes: [
        {
          Action: "UPSERT",
          ResourceRecordSet: {
            Name: env.DNS_RECORD_NAME,
            Type: "A",
            TTL: 60,
            ResourceRecords: [
              {
                Value: publicIp,
              },
            ],
          },
        },
      ],
    },
  });

  await route53Client.send(changeResourceRecordSetsCommand);

  return {
    statusCode: 200,
    message: `Updated DNS Record for ${env.DNS_RECORD_NAME} in Hosted Zone with ID ${env.HOSTED_ZONE_ID} to ${publicIp}`,
  };
};

export { handler };
