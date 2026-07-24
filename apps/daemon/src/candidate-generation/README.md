# Candidate generation

This module is the explicit OL-018 network boundary.

It accepts only a verified OL-017 semantic-analysis input and an in-memory provider secret, builds a deterministic public request identity, performs a bounded Responses-compatible HTTPS call, strictly parses an OL-016 Candidate batch, and persists only canonical Candidate bytes plus content-free generation provenance.

It must not read repository files, raw Events, transcripts, commands, artifact paths, or provider-side state. It must not repair model output, schedule background work, persist secrets/raw envelopes, or decide whether a Candidate is factually supported. Those support and ranking checks belong to OL-019.
