#!/bin/sh
set -e

# Regenerate the frontend's runtime configuration on every container start,
# regardless of which role is about to run (specs/006-frontend-runtime-config
# research.md §5) — frontend/dist is present in every build of this image.
if [ -d /app/frontend/dist ]; then
  node /app/frontend/scripts/generate-runtime-config.mjs
fi

exec "$@"
