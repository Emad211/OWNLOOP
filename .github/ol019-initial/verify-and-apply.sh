#!/usr/bin/env bash
set -euo pipefail

sha256sum --check --strict .github/ol019-initial/chunks.sha256
for chunk in .github/ol019-initial/chunk-{00..48}; do
  test "$(wc -c < "$chunk")" -eq 1000
done
test "$(wc -c < .github/ol019-initial/chunk-49)" -eq 240

cat .github/ol019-initial/chunk-* > /tmp/ol019-initial.b64
test "$(wc -c < /tmp/ol019-initial.b64)" -eq 49240
echo 'fdabeb66f453ecfeea81a92dc3844d1f725bd046f8941c004d5ca9ffa36db90d  /tmp/ol019-initial.b64' | sha256sum --check

base64 --decode /tmp/ol019-initial.b64 > /tmp/ol019-initial.patch.gz
test "$(wc -c < /tmp/ol019-initial.patch.gz)" -eq 36928
echo '6b811e08ad771348a8014b32a6b097ab9bf65b612dc78088d3241ba129f3eaaa  /tmp/ol019-initial.patch.gz' | sha256sum --check
gzip --test /tmp/ol019-initial.patch.gz

gzip --decompress --stdout /tmp/ol019-initial.patch.gz > /tmp/ol019-initial.patch
test "$(wc -c < /tmp/ol019-initial.patch)" -eq 180604
echo 'bb8043c93ccb96b0aa32ff4c37b5001bfd8c9b55f2841b3c46bff2dc32d53a94  /tmp/ol019-initial.patch' | sha256sum --check

git apply --check /tmp/ol019-initial.patch
git apply /tmp/ol019-initial.patch
