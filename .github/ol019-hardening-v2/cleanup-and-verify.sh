#!/usr/bin/env bash
set -euo pipefail

cp .github/ol019-hardening-v2/expected-files /tmp/ol019-hardening-v2-expected

git rm .github/ol019-hardening-v2/chunk-*
git rm .github/ol019-hardening-v2/chunks.sha256
git rm .github/ol019-hardening-v2/cleanup-and-verify.sh
git rm .github/ol019-hardening-v2/expected-files
git rm .github/ol019-hardening-v2/type-fix.patch
git rm .github/ol019-hardening-v2/verify-and-apply.sh
git rm .github/workflows/finalize-ol019-hardening-v2.yml

{
  git diff --name-only
  git diff --cached --name-only
  git ls-files --others --exclude-standard
} | sort -u > /tmp/ol019-hardening-v2-actual

diff -u /tmp/ol019-hardening-v2-expected /tmp/ol019-hardening-v2-actual
git diff --check
