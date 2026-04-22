#!/bin/sh
set -eu

: "${S3_ENDPOINT:=http://minio:9000}"
: "${S3_BUCKET:=inkflow-local}"
: "${S3_ACCESS_KEY:=minioadmin}"
: "${S3_SECRET_KEY:=minioadmin}"

# Wait for MinIO to be ready
until mc alias set local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null; do
  echo "Waiting for MinIO..."
  sleep 1
done

mc mb -p "local/$S3_BUCKET" || true
echo "Bucket ready: $S3_BUCKET"
