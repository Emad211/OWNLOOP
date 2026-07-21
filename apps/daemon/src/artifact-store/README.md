# Local artifact store

OL-010 stores only caller-declared prepared bytes. Content is streamed into a private temporary file,
hashed with SHA-256, materialized once under the deterministic digest layout, and verified before
metadata is resolved in SQLite.

The store never accepts caller-selected object paths and never writes inside an analyzed repository.
Version-1 reads verify path derivation, containment, regular-file type, exact size, and digest before
returning bytes.

Run references are idempotent and many-to-many. Garbage collection is explicit, bounded, and deletes
metadata only while the artifact remains unreferenced. Orphan sweeping is restricted to the exact
digest directory layout and never follows symlinks.
