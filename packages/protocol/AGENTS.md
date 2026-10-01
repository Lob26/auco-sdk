# packages/protocol

`PROTOCOL.md` and `fixtures/*.json` record the wire behavior of `auco-sdk-integration@1.0.9` at commit `bd27a8b`, as seen from the host. They are evidence, not a design. The characterization suite in `packages/legacy` replays these fixtures against the 1.x code, so editing one changes what "1.x behaves like this" means.

## Rules

- **Describe 1.0.9, not the code you want.** When new code (v2, `packages/legacy` refactors) disagrees with a fixture, the new code is what changed. Never edit a fixture or a section to make a new test pass. A deliberate protocol change in v2 gets its own spec; it does not rewrite this one.
- **Source of truth is `git show bd27a8b:src/index.ts` and `git show bd27a8b:src/types.ts`.** Not the working tree: `src/` moves, and line numbers in `source` refer to `bd27a8b`.
- **Ids are stable.** `frame.*` is frame→host, `host.*` is host→frame. Never rename one. A test parses headings of the exact form `` ### `<id>` `` and cross-checks them against every fixture's `"id"` in both directions; do not use that heading form for anything that is not a message.
- **One change carries all four:** adding or changing a message means, in the same diff, the heading section, at least one fixture, a `source` (`src/index.ts#Lnn` at `bd27a8b`) and a confidence label. One fixture per payload variant: `<id>.<variant>.json`, with `"variant"` matching the file name (`null` when there is no variant).
- **Do not invent fields.** Every field in `data` and in the field tables must come from the code or from docs.auco.ai, labeled `código`/`code` or `docs`. Anything else is `inferido`/`inferred` and says what it is inferred from. If the frame's real payload is unknown, it goes to "Preguntas abiertas", not into a fixture.
- **Never upgrade a confidence label without citing the new source** (a code line, a doc URL, or a written answer from Auco). Downgrading when evidence turns out wrong is fine.
- **Confidence qualifies shape, not values.** It covers the host predicate, field names/types and the host reaction. Literal values in `data` are fake representatives; never present one as what the frame really sends.
- **Fake values only.** Keys are `puk_` + 32 zeros (exactly 36 chars: 1.0.9 throws at startup for any other non-empty length); documents look like `DOC0000000AA`; emails and URLs use `example.com`; phones are zeros after the country prefix (`+570000000000`). No real keys, people, companies or Auco document codes. Never put a `prk_` key in a fixture.
- `PROTOCOL.md` is Spanish (es-CO, no voseo); this file is English.

## Check

```bash
jq empty packages/protocol/fixtures/*.json                    # gate "fixtures": every fixture parses
pnpm exec biome ci packages/protocol                          # fixture formatting
pnpm -r --if-present test                                     # heading ⇄ fixture coverage + 1.x characterization
```
