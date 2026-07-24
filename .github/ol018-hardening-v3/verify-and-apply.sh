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

type_fix=.github/ol018-hardening-v3/type-fix.patch
test "$(wc -c < "$type_fix")" -eq 889
echo '26b7f1186bbbf447838a45364974121029f17a4647ccf89e40555f9349290408  .github/ol018-hardening-v3/type-fix.patch' | sha256sum --check
git apply --check "$type_fix"
git apply "$type_fix"

printf '%s\n' \
  '1d3845a14c067cc3605da7975da00aa6ae958370bfb6bd1604ecf405168fd5b7  .github/ol018-hardening-v3/test-fix-00' \
  '925040f9491acc0f192dd6c83839c749e25aec1427c32d19acc8c3358fd601c0  .github/ol018-hardening-v3/test-fix-01' \
  'ad5a728d93ea4bbcb2b3f7ecf6e7ab49101342f33889e811160cfcc424b3475b  .github/ol018-hardening-v3/test-fix-02' \
  '83a560e6d6f06c99c4668e22505c2afd3e9dea986baf31cf7611133c7da65f34  .github/ol018-hardening-v3/test-fix-03' \
  | sha256sum --check --strict
for part in .github/ol018-hardening-v3/test-fix-{00..02}; do
  test "$(wc -c < "$part")" -eq 1000
done
test "$(wc -c < .github/ol018-hardening-v3/test-fix-03)" -eq 58
cat .github/ol018-hardening-v3/test-fix-* > /tmp/ol018-hardening-test-fix.patch
test "$(wc -c < /tmp/ol018-hardening-test-fix.patch)" -eq 3058
echo '38cb2e9fe9b2bc2a6a25eb0e8982f682f9678a219e86ff75d2e3bca86381ea4d  /tmp/ol018-hardening-test-fix.patch' | sha256sum --check
git apply --check /tmp/ol018-hardening-test-fix.patch
git apply /tmp/ol018-hardening-test-fix.patch
