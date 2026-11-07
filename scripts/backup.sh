#!/bin/sh
set -eu
umask 077
# Run on the authorized Linux host. Never run against production as part of CI/tests.
test "${BACKUP_CONFIRM:-}" = authorized || { echo 'Set BACKUP_CONFIRM=authorized after reviewing the backup procedure.'; exit 1; }
: "${BACKUP_DIRECTORY:?Set a private absolute backup parent directory}"
: "${MONGO_BACKUP_CONFIG:?Set the private mongodump YAML config path}"
: "${RESTIC_REPOSITORY:?Set an encrypted off-host restic repository}"
: "${RESTIC_PASSWORD_FILE:?Set the private restic password-file path}"
for command in docker mongodump restic node; do command -v "$command" >/dev/null; done
case "$BACKUP_DIRECTORY" in /*) ;; *) echo 'Use an absolute backup path.'; exit 1;; esac
run="$BACKUP_DIRECTORY/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$run"
for name in photos documents; do docker volume inspect "nestly_$name" >/dev/null; done
docker compose stop app
trap 'docker compose start app' EXIT HUP INT TERM
# The Mongo config explicitly selects the nestly application database; keep credentials out of arguments/logs.
mongodump --config "$MONGO_BACKUP_CONFIG" --db nestly --archive="$run/database.archive.gz" --gzip --quiet
for name in photos documents; do
  docker run --rm --network none -v "nestly_$name:/source:ro" -v "$run:/backup" alpine:3.23 tar -czf "/backup/$name.tar.gz" -C /source .
done
node - "$run" <<'NODE'
const fs=require('fs'),path=require('path'),root=process.argv[2],{fileHash}=require('./scripts/verify-backup');
(async()=>{const files=await Promise.all(['database.archive.gz','photos.tar.gz','documents.tar.gz'].map(async name=>({name,sha256:await fileHash(path.join(root,name))})));fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),files},null,2),{mode:0o600});})().catch(()=>{console.error('Backup manifest failed.');process.exitCode=1;});
NODE
node scripts/verify-backup.js "$run"
restic backup "$run" --tag nestly --quiet
echo 'Encrypted backup stored. Verify it with the documented isolated restore drill.'
