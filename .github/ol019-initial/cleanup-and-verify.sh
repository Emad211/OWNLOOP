#!/usr/bin/env bash
set -euo pipefail

cp .github/ol019-initial/expected-files /tmp/ol019-expected-files

git rm .github/ol019-initial/chunk-*
git rm .github/ol019-initial/chunks.sha256
git rm .github/ol019-initial/cleanup-and-verify.sh
git rm .github/ol019-initial/expected-files
git rm .github/ol019-initial/type-fix.patch
git rm .github/ol019-initial/verify-and-apply.sh
git rm .github/workflows/finalize-ol019-initial.yml

{
  git diff --name-only
  git diff --cached --name-only
  git ls-files --others --exclude-standard
} | sort -u > /tmp/ol019-actual-files

diff -u /tmp/ol019-expected-files /tmp/ol019-actual-files
git diff --check
