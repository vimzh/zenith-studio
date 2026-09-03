# Agent I/O verification artifacts

Files retrieved through Zenith's native WebMCP export/read tools on 2026-09-03:

- `fixture-8x.png`: 64×64 fixture exported at 8× (512×512).
- `fixture.gif`: four frames at 250 ms each (4 fps), exported at 4×.
- `agent-i-o-fixture.png` / `.json`: spritesheet and atlas metadata.
- `phaser-agent-i-o-fixture.*`: complete Phaser export bundle.
- `project.zenith.json`: final source backup, project 003.
- `restored-project.zenith.json`: final restored backup, project 005.
- `roundtrip.json`: fresh ID mappings and exact document comparison result.
- `job-validation.json`: invalid-source failure and idempotent retry evidence.

`pre-fix-project.zenith.json` belongs to an interrupted development/HMR attempt
that exposed incorrect active-project restoration. It is retained as historical
evidence, **not** the successful final round-trip backup. The corresponding browser
project is labeled “Agent I/O restore QA (pre-fix)”. Original user assets were not
overwritten. The final QA projects remain available for inspection.

See [the verification record](../../docs/verification/agent-io-2026-09-03.md)
for checks and limitations. These simple geometric fixtures test transport and
timing; they are not examples of generated-art quality.
