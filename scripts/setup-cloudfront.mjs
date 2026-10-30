// Creates (once) a CloudFront distribution serving only the bucket's tukabel/
// prefix over HTTP/2+3 with CORS for the release HD assets, then waits until it
// is deployed and prints the --remote URL. Re-running finds the existing one.
// Objects are public-read, so no origin access control or bucket policy change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CloudFrontClient,
  CreateDistributionCommand,
  GetDistributionCommand,
  ListDistributionsCommand,
} from '@aws-sdk/client-cloudfront';
import { GetBucketLocationCommand, S3Client } from '@aws-sdk/client-s3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile))
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
const bucket = process.env.AWS_BUCKET;
if (!bucket) throw new Error('Chybí AWS_BUCKET (.env.local).');

const COMMENT = `tukabel release HD assets (${bucket}/tukabel)`;
// AWS managed policies: CachingOptimized and SimpleCORS (Allow-Origin: *).
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const SIMPLE_CORS = '60669652-455b-4ae9-85a4-c4c02393f86c';

const location = await new S3Client({
  region: 'us-east-1',
  followRegionRedirects: true,
}).send(new GetBucketLocationCommand({ Bucket: bucket }));
const origin = `${bucket}.s3.${location.LocationConstraint || 'us-east-1'}.amazonaws.com`;
const cf = new CloudFrontClient({ region: 'us-east-1' });

async function existing() {
  let Marker;
  do {
    const page = await cf.send(new ListDistributionsCommand({ Marker }));
    const found = page.DistributionList?.Items?.find(
      (d) => d.Comment === COMMENT,
    );
    if (found) return found;
    Marker = page.DistributionList?.NextMarker;
  } while (Marker);
}

let distribution = await existing();
if (!distribution) {
  const created = await cf.send(
    new CreateDistributionCommand({
      DistributionConfig: {
        CallerReference: `tukabel-${Date.now()}`,
        Comment: COMMENT,
        Enabled: true,
        HttpVersion: 'http2and3',
        PriceClass: 'PriceClass_100',
        IsIPV6Enabled: true,
        Origins: {
          Quantity: 1,
          Items: [
            {
              Id: 's3-tukabel',
              DomainName: origin,
              // Only keys under tukabel/ are reachable through this domain.
              OriginPath: '/tukabel',
              S3OriginConfig: { OriginAccessIdentity: '' },
            },
          ],
        },
        DefaultCacheBehavior: {
          TargetOriginId: 's3-tukabel',
          ViewerProtocolPolicy: 'redirect-to-https',
          AllowedMethods: {
            Quantity: 2,
            Items: ['GET', 'HEAD'],
            CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] },
          },
          Compress: true,
          CachePolicyId: CACHING_OPTIMIZED,
          ResponseHeadersPolicyId: SIMPLE_CORS,
        },
      },
    }),
  );
  distribution = created.Distribution;
  console.log(`Vytvořena distribuce ${distribution.Id}.`);
}
const id = distribution.Id;
for (;;) {
  const { Distribution } = await cf.send(
    new GetDistributionCommand({ Id: id }),
  );
  if (Distribution.Status === 'Deployed') break;
  console.log(`${id}: ${Distribution.Status}…`);
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}
console.log(
  `Hotovo. Build: node scripts/build-release.mjs --budget 5 --remote https://${distribution.DomainName}/`,
);
