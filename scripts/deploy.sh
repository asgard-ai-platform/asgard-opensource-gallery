#!/usr/bin/env bash
set -euo pipefail

# Build
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist \
  --project-name="${CLOUDFLARE_PROJECT_NAME:-asgard-opensource-gallery}"

echo "Deploy complete."
