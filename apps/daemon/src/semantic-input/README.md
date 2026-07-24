# Reduced semantic-analysis input

OL-017 builds one deterministic, privacy-bounded, Evidence-ID-addressed input artifact for a finalized Run when processing is explicitly enabled.

The module reads only the persisted ingress-redacted Run goal, a validated OL-015 Evidence Graph, and its validated OL-014 verification artifact. It performs a second deterministic redaction pass, reduces graph-backed facts and relations under a fixed priority budget, and stores canonical bytes through OL-010.

It does not read a repository, transcript, raw Hook receipt, arbitrary Event payload, command, patch, source file, artifact path/digest, provider resource, or network endpoint. It does not construct provider-specific prompts, generate Candidate Moments, persist generation records, schedule background work, or use `analysis_jobs`.

`enabled: false` returns before any persistence, artifact, prompt, graph, verification, or filesystem read.
