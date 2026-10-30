// Uploads the HD asset set staged by `build-release.mjs --remote <url>` to S3.
// Writes only under the tukabel/ prefix, never deletes, skips objects that are
// already there and uploads manifest.json last, so a half-finished upload is
// never picked by the game. Credentials: AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY and AWS_BUCKET from the environment or .env.local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GetBucketLocationCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }

const bucket = process.env.AWS_BUCKET;
if (!bucket || !process.env.AWS_ACCESS_KEY_ID)
  throw new Error('Chybí AWS_BUCKET / AWS_ACCESS_KEY_ID (.env.local).');
const staged = JSON.parse(
  fs.readFileSync(path.join(root, '.release/remote.json'), 'utf8'),
);
// The --remote URL may be the bucket itself (…/tukabel/) or a CloudFront
// domain whose origin path is /tukabel; the key layout is the same.
const prefix = `tukabel/${staged.build}/`;
if (!/^tukabel\/[0-9a-f]{12}\/$/.test(prefix))
  throw new Error(`Nahrávám jen do tukabel/<build>/, ne do ${prefix}`);

// The configured region may be wrong; the bucket knows its own.
const probe = new S3Client({
  region: 'us-east-1',
  followRegionRedirects: true,
});
const location = await probe.send(
  new GetBucketLocationCommand({ Bucket: bucket }),
);
const s3 = new S3Client({ region: location.LocationConstraint || 'us-east-1' });

const TYPES = {
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};
const dir = path.join(root, staged.dir);
const names = fs
  .readdirSync(dir)
  .filter((name) => name !== 'manifest.json')
  .concat('manifest.json');
let uploaded = 0;
let skipped = 0;
for (const name of names) {
  const body = fs.readFileSync(path.join(dir, name));
  const Key = prefix + name;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key }));
    if (head.ContentLength === body.length) {
      skipped++;
      continue;
    }
  } catch (error) {
    if (error.name !== 'NotFound') throw error;
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key,
      Body: body,
      ACL: 'public-read',
      ContentType:
        TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
      // Paths are content/build addressed, so they never change.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  uploaded++;
}
console.log(
  `S3 ${bucket}/${prefix}: nahráno ${uploaded}, přeskočeno ${skipped}. ${staged.url}`,
);
