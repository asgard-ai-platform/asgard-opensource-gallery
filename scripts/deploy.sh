#!/usr/bin/env bash
set -euo pipefail

# Build
npm run build

# Sync to S3
aws s3 sync dist/ "s3://${S3_BUCKET}" --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id "${CF_DISTRIBUTION_ID}" \
  --paths "/*"

echo "Deploy complete."
