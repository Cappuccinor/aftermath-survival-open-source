# G1-004 fixed compatibility samples

Source commit: fb239862b7f52512a50ac0e573cc0f33dbb76ce7.

The original Core files were extracted with `git show <base>:src/core/<file>` into this task’s ignored baseline directory, without reading or modifying older scratch. Its real createInspectionPrototype/createEngine generated these literal JSON files through a temporary Vitest module (1 generator test passed). No new Core implementation generated the receipts.

The original prototype was enriched with two reciprocal static locations and a trusted known-route-v1 event/knowledge before dispatch. Those extensible records are accepted by the baseline engine; they introduce no movement or rewritten action history. Original engine dispatched legacy-observe (revision 0, empty targets), then legacy-inspect (revision 1, prototype-tin). Snapshots were captured after each success, with original observe-v1 and inspect-v1 payloads unchanged.

The tests accept the bytes as parsed, append new move events, rebuild, retry original observe with empty/explicit old location and inspect, return, and rebuild. Existing g0-empty/g1-observe-v1 samples remain unchanged and tested. These are internal fixtures, not a released save protocol.
