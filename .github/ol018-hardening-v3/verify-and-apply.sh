#!/usr/bin/env bash
set -euo pipefail

sha256sum --check --strict .github/ol018-hardening-v3/chunks.sha256
for chunk in .github/ol018-hardening-v3/chunk-{00..12}; do
  test "$(wc -c < "$chunk")" -eq 1000
done
test "$(wc -c < .github/ol018-hardening-v3/chunk-13)" -eq 168

cat .github/ol018-hardening-v3/chunk-* > /tmp/ol018-hardening-v3.b64
test "$(wc -c < /tmp/ol018-hardening-v3.b64)" -eq 13168
echo 'e6f83f2c95cb2b62750596ea993b8b844979eaf054000a92f5642264c8756e1c  /tmp/ol018-hardening-v3.b64' | sha256sum --check

base64 --decode /tmp/ol018-hardening-v3.b64 > /tmp/ol018-hardening-v3.patch.gz
test "$(wc -c < /tmp/ol018-hardening-v3.patch.gz)" -eq 9874
echo 'a237fe719417e349614218252f8eb29706bcecce0c1be9076638f787f28ab76d  /tmp/ol018-hardening-v3.patch.gz' | sha256sum --check
gzip --test /tmp/ol018-hardening-v3.patch.gz

gzip --decompress --stdout /tmp/ol018-hardening-v3.patch.gz > /tmp/ol018-hardening-v3.patch
test "$(wc -c < /tmp/ol018-hardening-v3.patch)" -eq 42046
echo 'd71a1d5d7722ae4cc1237d796cfb589676056d76c0c59264ad745138291af982  /tmp/ol018-hardening-v3.patch' | sha256sum --check
git apply --check /tmp/ol018-hardening-v3.patch
git apply /tmp/ol018-hardening-v3.patch
