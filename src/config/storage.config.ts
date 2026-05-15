import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET_NAME,
  publicUrl: process.env.R2_PUBLIC_URL,
  // UF-016 — when true (default), an R2 upload failure aborts the import and the
  // ImportBatch row is rolled back. Operators can flip this to "false" during a
  // regional outage to keep imports flowing in degraded mode (no retained file;
  // confirm() will then refuse the orphan via the storageKey-null guard).
  strictR2Retention: process.env.STRICT_R2_RETENTION !== 'false',
}));
