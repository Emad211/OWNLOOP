#!/usr/bin/env bash
set -euo pipefail

cp .github/ol018-hardening-v3/expected-files /tmp/expected-files

git rm .github/ol018-hardening-v2/part-*
git rm .github/ol018-hardening-v3/chunk-*
git rm .github/ol018-hardening-v3/chunks.sha256
git rm .github/ol018-hardening-v3/cleanup-and-verify.sh
git rm .github/ol018-hardening-v3/expected-files
git rm .github/ol018-hardening-v3/verify-and-apply.sh
git rm .github/workflows/finalize-ol018-hardening-v3.yml

{
  git diff --name-only
  git diff --cached --name-only
  git ls-files --others --exclude-standard
} | sort -u > /tmp/actual-files

diff -u /tmp/expected-files /tmp/actual-files
git diff --check
