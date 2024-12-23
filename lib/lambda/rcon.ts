import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import {
  AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
} from "@aws-sdk/client-auto-scaling";
import { notEmpty } from "../utils/arrays";
import { Rcon } from "rcon-client";
import { assertEnvs } from "../utils/assertive-env";

const env = assertEnvs("ASG_NAME", "RCON_PORT", "RCON_PASSWORD");

const ec2Client = new EC2Client({});
const asgClient = new AutoScalingClient({});

/**
 * Fetch the private IP addresses of EC2 instances in a specified Auto Scaling Group.
 *
 * @param asgName The name of the Auto Scaling Group.
 *
 * @returns A promise resolving to an array of private IPs.
 */
const getAsgPrivateIPs = async (asgName: string): Promise<string[]> => {
  // Fetch Auto Scaling Group details
  const asgResponse = await asgClient.send(
    new DescribeAutoScalingGroupsCommand({ AutoScalingGroupNames: [asgName] })
  );

  const instanceIds = asgResponse.AutoScalingGroups?.[0]?.Instances?.map(
    (instance) => instance.InstanceId
  ).filter(notEmpty);

  if (!instanceIds || instanceIds.length === 0) {
    throw new Error(`No instances found in Auto Scaling Group: ${asgName}`);
  }

  // Fetch EC2 instance details
  const ec2Response = await ec2Client.send(
    new DescribeInstancesCommand({ InstanceIds: instanceIds })
  );

  const privateIPs = ec2Response.Reservations?.flatMap((reservation) =>
    reservation.Instances?.map((instance) => instance.PrivateIpAddress || "")
  ).filter(notEmpty);

  if (!privateIPs || privateIPs.length === 0) {
    throw new Error("No private IP addresses found for instances.");
  }

  return privateIPs;
};

/**
 * Run a game command via the rcon protocol
 *
 * @param command - Command to run
 *
 * @returns Response from server
 */
const sendRconCommand = async (command: string): Promise<string> => {
  const ips = await getAsgPrivateIPs(env.ASG_NAME);

  const rcon = new Rcon({
    host: ips[0],
    port: Number(env.RCON_PORT),
    password: env.RCON_PASSWORD,
  });

  try {
    // Connect to the RCON server
    await rcon.connect();
    console.log("Connected to RCON server.");

    // Send the command and get the response
    const response = await rcon.send(command);
    console.log("RCON Response:", response);

    return response;
  } catch (error) {
    console.error("Failed to send RCON command:", error);
    throw error;
  } finally {
    // Ensure the connection is closed
    rcon.end();
    console.log("Disconnected from RCON server.");
  }
};

/**
 * A wrapper around sendRconCommand to run a tellraw command with a given message
 * Does no validation on the message so don't include any double quotes
 *
 * @param message - Message to send
 */
const sendRconMessage = async (message: string) => {
  await sendRconCommand(`tellraw @a "${message}"`);
};

export { sendRconCommand, sendRconMessage };
