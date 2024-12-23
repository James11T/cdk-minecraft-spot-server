import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import * as fs from "fs";
import PQueue from "p-queue";
import * as path from "path";
import { assertEnvs } from "../utils/assertive-env";
import { sendRconMessage } from "./rcon";

const s3 = new S3Client();

const { BACKUP_BUCKET_NAME, EFS_MOUNT_PATH, BACKUP_FILES } = assertEnvs(
  "BACKUP_BUCKET_NAME",
  "EFS_MOUNT_PATH",
  "BACKUP_FILES"
);

/**
 * Upload a file to S3
 *
 * @param key - S3 file key
 * @param filePath Path of file on disk
 * @returns PutObjectCommandOutput
 */
const uploadFile = async (
  key: string,
  filePath: string
): Promise<PutObjectCommandOutput> => {
  const fileStream = fs.createReadStream(filePath);

  return await s3.send(
    new PutObjectCommand({
      Bucket: BACKUP_BUCKET_NAME,
      Key: key,
      Body: fileStream,
      ContentType: "application/octet-stream",
      StorageClass: "GLACIER",
    })
  );
};

/**
 * Recursively walk directory and return full paths of files
 *
 * @param dirPath - Directory to walk
 * @param prefixPath - Prefix to add to filenames
 *
 * @returns List of files in directory
 */
const walkDirectory = (dirPath: string, prefixPath: string): string[] => {
  const paths: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(prefixPath, entry.name);

    if (entry.isDirectory()) {
      const subdirectorContents = walkDirectory(
        path.join(EFS_MOUNT_PATH, fullPath),
        fullPath
      );
      paths.push(...subdirectorContents);
    } else {
      paths.push(fullPath);
    }
  }

  return paths;
};

/**
 * AWS Lambda handler function to upload contents of EFS subdirectories to S3
 */
const handler = async () => {
  const directories = BACKUP_FILES.split(",");

  await sendRconMessage("Creating S3 backup...");

  const queue = new PQueue({ concurrency: 6 });
  const now = new Date().toISOString().split(".")[0].replace(/[T:]/g, "-");

  const files = directories
    .map((dir) => {
      const stat = fs.statSync(path.join(EFS_MOUNT_PATH, dir));
      if (stat.isDirectory())
        return walkDirectory(path.join(EFS_MOUNT_PATH, dir), dir);
      return [dir];
    })
    .flat();

  await queue.addAll(
    files.map(
      (file) => () =>
        uploadFile(path.join(now, file), path.join(EFS_MOUNT_PATH, file))
    )
  );

  await sendRconMessage(`S3 Backup '${now}' complete`);

  return {
    statusCode: 200,
    body: JSON.stringify("Backup success"),
  };
};

export { handler };
