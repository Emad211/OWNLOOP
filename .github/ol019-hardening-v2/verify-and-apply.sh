#!/usr/bin/env bash
set -euo pipefail

sha256sum --check --strict .github/ol019-hardening-v2/chunks.sha256
for chunk in .github/ol019-hardening-v2/chunk-{00..02}; do
  test "$(wc -c < "$chunk")" -eq 2000
done
test "$(wc -c < .github/ol019-hardening-v2/chunk-03)" -eq 1372

cat .github/ol019-hardening-v2/chunk-* > /tmp/ol019-hardening-v2.b64
test "$(wc -c < /tmp/ol019-hardening-v2.b64)" -eq 7372
echo '1669655de5d7deb6c646c24dcf23c75713199a910e11683b3ee5ea937c786363  /tmp/ol019-hardening-v2.b64' | sha256sum --check

base64 --decode /tmp/ol019-hardening-v2.b64 > /tmp/ol019-hardening-v2.patch.gz
test "$(wc -c < /tmp/ol019-hardening-v2.patch.gz)" -eq 5527
echo '37093c1c76bf85c6dc8afa3bee6de685d009e7c7849d469bd5eae4ed9b306295  /tmp/ol019-hardening-v2.patch.gz' | sha256sum --check
gzip --test /tmp/ol019-hardening-v2.patch.gz

gzip --decompress --stdout /tmp/ol019-hardening-v2.patch.gz > /tmp/ol019-hardening-v2.patch
test "$(wc -c < /tmp/ol019-hardening-v2.patch)" -eq 21401
echo '7f71a94da332be2024f929e56a6a9cfe948b9ae9b9235916e17fe053be11a091  /tmp/ol019-hardening-v2.patch' | sha256sum --check

git apply --check /tmp/ol019-hardening-v2.patch
git apply /tmp/ol019-hardening-v2.patch

type_fix=.github/ol019-hardening-v2/type-fix.patch
test "$(wc -c < "$type_fix")" -eq 6685
echo '8aa81e0d202658ed3972bfa1f215140e7b784a4f0b0b0d288655b78ef481ed71  .github/ol019-hardening-v2/type-fix.patch' | sha256sum --check
git apply --check "$type_fix"
git apply "$type_fix"
