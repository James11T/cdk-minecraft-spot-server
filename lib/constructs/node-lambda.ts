import * as nodejsLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Construct } from "constructs";

const cwd = process.cwd();

type NodeLambdaProps = Omit<nodejsLambda.NodejsFunctionProps, "entry"> & {
  entry: string;
};

class NodeLambda extends nodejsLambda.NodejsFunction {
  constructor(scope: Construct, id: string, props: NodeLambdaProps) {
    const entry = path.join(cwd, "lib", "lambda", props.entry);

    super(scope, id, {
      ...props,
      entry,
      runtime: lambda.Runtime.NODEJS_20_X,
      bundling: {
        minify: true,
        format: nodejsLambda.OutputFormat.ESM,
        target: "es2022",
        externalModules: [
          "@aws-sdk/*",
          ...(props.bundling?.externalModules ?? []),
        ],
        forceDockerBundling: false,
        mainFields: ["module", "main"],
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        ...props.bundling,
      },
    });
  }
}

export default NodeLambda;
