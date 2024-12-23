import * as cdk from "aws-cdk-lib/core";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as efs from "aws-cdk-lib/aws-efs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";
import NodeLambda from "./node-lambda";
import { FckNatInstanceProvider } from "cdk-fck-nat";

export interface MinecraftSpotServerProps {
  imageTag: string;
  spotPrice: string;
  ec2KeyName: string;
  containerEnvironment: ecs.ContainerDefinitionOptions["environment"];
  sshCIDR: string;
  efsBackup: boolean;
  s3Backup: boolean;
  instanceType: ec2.InstanceType;
  serverPort: number;
  rconPort: number;
  rconPassword: string;
  hostedZoneId: string;
  dnsRecordName: string;
}

class MinecraftSpotServer extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly asg: autoscaling.AutoScalingGroup;
  public readonly taskLogGroup: logs.LogGroup;
  public readonly cluster: ecs.Cluster;
  public readonly gameFileSystem: efs.FileSystem;

  constructor(scope: Construct, id: string, props: MinecraftSpotServerProps) {
    super(scope, id);

    // Logs

    this.taskLogGroup = new logs.LogGroup(this, "mc-logs", {
      retention: logs.RetentionDays.ONE_DAY,
    });

    // VPC

    const natGatewayProvider = new FckNatInstanceProvider({
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.NANO
      ),
    });

    this.vpc = new ec2.Vpc(this, "mc-vpc", {
      natGatewayProvider,
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "mc-public-subnet",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "mc-private-subnet",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
    });

    natGatewayProvider.securityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.allTraffic()
    );

    // CLUSTER

    this.cluster = new ecs.Cluster(this, "mc-cluster", { vpc: this.vpc });

    // Allow game server connections
    this.cluster.connections.allowFromAnyIpv4(ec2.Port.tcp(props.serverPort));

    const instanceRole = new iam.Role(this, "mc-role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    const taskRole = new iam.Role(this, "mc-task-role", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    this.taskLogGroup.grantWrite(taskRole);

    // Allow ECS to use EC2 container
    instanceRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonEC2ContainerServiceforEC2Role"
      )
    );

    // Load key pair for SSH
    const keyPair = ec2.KeyPair.fromKeyPairName(
      this,
      "mc-keypair",
      props.ec2KeyName
    );

    const instanceSg = new ec2.SecurityGroup(this, "mc-sg", {
      vpc: this.vpc,
    });

    const lambdaSg = new ec2.SecurityGroup(this, "mc-lambda-sg", {
      vpc: this.vpc,
    });

    instanceSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(props.serverPort)
    );

    instanceSg.addIngressRule(
      ec2.Peer.securityGroupId(lambdaSg.securityGroupId),
      ec2.Port.tcp(props.rconPort)
    );

    // Launch template for EC2
    const ec2LaunchTemplate = new ec2.LaunchTemplate(this, "mc-lt", {
      instanceType: props.instanceType,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(
        ecs.AmiHardwareType.ARM
      ),
      keyPair,
      spotOptions: {
        maxPrice: props.spotPrice ? Number(props.spotPrice) : 0.05,
      },
      securityGroup: instanceSg,
      role: instanceRole,
    });

    this.asg = new autoscaling.AutoScalingGroup(this, "mc-asg", {
      minCapacity: 1,
      maxCapacity: 1,
      vpcSubnets: {
        subnets: this.vpc.publicSubnets,
      },
      launchTemplate: ec2LaunchTemplate,
      vpc: this.vpc,
    });

    this.asg.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const capacityProvider = new ecs.AsgCapacityProvider(
      this,
      "mc-asg-capacity-provider",
      {
        autoScalingGroup: this.asg,
        enableManagedTerminationProtection: false,
      }
    );

    // Assign autoscaling group to cluster
    this.cluster.addAsgCapacityProvider(capacityProvider);

    this.asg.connections.allowFrom(
      ec2.Peer.ipv4(props.sshCIDR),
      ec2.Port.tcp(22)
    );

    // File system

    this.gameFileSystem = new efs.FileSystem(this, "mc-efs", {
      vpc: this.vpc,
      encrypted: true,
      enableAutomaticBackups: props.efsBackup,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_7_DAYS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      fileSystemPolicy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: [new iam.ArnPrincipal("*")],
            actions: [
              "elasticfilesystem:ClientRootAccess",
              "elasticfilesystem:ClientWrite",
              "elasticfilesystem:ClientMount",
            ],
            resources: ["*"],
            conditions: {
              Bool: {
                "elasticfilesystem:AccessedViaMountTarget": "true",
              },
            },
          }),
        ],
      }),
    });

    this.gameFileSystem.connections.allowDefaultPortFrom(this.asg);
    this.gameFileSystem.connections.allowFrom(instanceSg, ec2.Port.tcp(2049));
    this.gameFileSystem.grant(
      ec2LaunchTemplate,
      "elasticfilesystem:ClientMount"
    );

    // Task definition

    const ec2Task = new ecs.Ec2TaskDefinition(this, "mc-task", { taskRole });

    const container = ec2Task.addContainer("mc-container", {
      image: ecs.ContainerImage.fromRegistry(
        `itzg/minecraft-server:${props.imageTag ?? "latest"}`
      ),
      memoryReservationMiB: 1024 * 3,
      environment: {
        RCON_PORT: String(props.rconPort),
        RCON_PASSWORD: props.rconPassword,
        ...props.containerEnvironment,
        EULA: "true",
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "minecraft-spot-server",
        logGroup: this.taskLogGroup,
      }),
    });

    container.addPortMappings({
      containerPort: props.serverPort,
      hostPort: props.serverPort,
      protocol: ecs.Protocol.TCP,
    });

    container.addPortMappings({
      containerPort: props.rconPort,
      hostPort: props.rconPort,
      protocol: ecs.Protocol.TCP,
    });

    ec2Task.addVolume({
      name: "mc-server-files",
      efsVolumeConfiguration: {
        fileSystemId: this.gameFileSystem.fileSystemId,
      },
    });

    container.addMountPoints({
      containerPath: "/data",
      sourceVolume: "mc-server-files",
      readOnly: false,
    });

    new ecs.Ec2Service(this, "mc-service", {
      cluster: this.cluster,
      taskDefinition: ec2Task,
      circuitBreaker: {
        enable: false,
      },
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

    // Must match the user defined in .env.container, defaults to 1000
    const efsUser = "1000";

    const lambdaAccessPoint = this.gameFileSystem.addAccessPoint(
      "mc-backup-lambda-ap",
      {
        createAcl: {
          ownerGid: efsUser,
          ownerUid: efsUser,
          permissions: "750",
        },
        path: "/",
        posixUser: {
          gid: efsUser,
          uid: efsUser,
        },
      }
    );

    const dnsLambdaRole = new iam.Role(this, "mc-dns-role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"
        ),
      ],
    });

    dnsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({ resources: ["*"], actions: ["route53:*"] })
    );

    dnsLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        resources: ["*"],
        actions: ["ec2:DescribeInstance*"],
      })
    );

    const dnsUpdateLambda = new NodeLambda(this, "mc-dns-lambda", {
      entry: "update-dns.lambda.ts",
      timeout: cdk.Duration.seconds(20),
      environment: {
        HOSTED_ZONE_ID: props.hostedZoneId,
        DNS_RECORD_NAME: props.dnsRecordName,
      },
      role: dnsLambdaRole,
      vpc: this.vpc,
    });

    new events.Rule(this, "mc-instance-launch-rule", {
      eventPattern: {
        source: ["aws.autoscaling"],
        detailType: ["EC2 Instance Launch Successful"],
        detail: {
          AutoScalingGroupName: [this.asg.autoScalingGroupName],
        },
      },
      targets: [new targets.LambdaFunction(dnsUpdateLambda)],
    });

    // S3 Backups

    if (props.s3Backup) {
      const lambdaRole = new iam.Role(this, "mc-backup-role", {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole"
          ),
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaVPCAccessExecutionRole"
          ),
        ],
      });

      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["autoscaling:DescribeAutoScalingGroups"],
          resources: ["*"],
        })
      );

      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["ec2:DescribeInstances"],
          resources: ["*"],
        })
      );

      const backupBucket = new s3.Bucket(this, "mc-backup-bucket", {
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        lifecycleRules: [
          {
            expiration: cdk.Duration.days(7),
            enabled: true,
          },
        ],
      });

      const mountPath = "/mnt/efs";

      const backupLambda = new NodeLambda(this, "mc-backup-function", {
        entry: "backup-files.lambda.ts",
        environment: {
          BACKUP_BUCKET_NAME: backupBucket.bucketName,
          EFS_MOUNT_PATH: mountPath,
          BACKUP_FILES: ["world", "world_nether", "world_the_end"].join(","),
          ASG_NAME: this.asg.autoScalingGroupName,
          RCON_PORT: String(props.rconPort),
          RCON_PASSWORD: props.rconPassword,
        },
        role: lambdaRole,
        filesystem: lambda.FileSystem.fromEfsAccessPoint(
          lambdaAccessPoint,
          mountPath
        ),
        vpc: this.vpc,
        timeout: cdk.Duration.minutes(1),
        securityGroups: [lambdaSg],
      });

      // Create CloudWatch Event Rule to trigger the Lambda every hour
      const rule = new events.Rule(this, "mc-backup-rule", {
        schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      });

      rule.addTarget(new targets.LambdaFunction(backupLambda));

      backupBucket.grantReadWrite(backupLambda);

      this.gameFileSystem.connections.allowFrom(
        backupLambda,
        ec2.Port.tcp(2049)
      );
      this.gameFileSystem.grant(
        backupLambda,
        "elasticfilesystem:ClientWrite",
        "elasticfilesystem:ClientRead",
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientRootAccess"
      );
    }
  }
}

export default MinecraftSpotServer;
