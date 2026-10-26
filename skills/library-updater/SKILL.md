---
name: library-updater
description: Audit a project's third-party dependencies for available upgrades, in any language/stack (npm, pip/poetry/uv, composer, cargo, go modules, Maven/Gradle, NuGet, RubyGems, pub). Discovers the stack from manifest files first, collects current vs latest versions from the registry, verifies cross-compatibility between the latest versions (peer dependencies, runtime/engine constraints), researches breaking changes, scans the codebase for impacted usage, and writes LIBRARY-UPDATE-REPORT.md. Use when the user asks to upgrade/update dependencies or libraries, check outdated packages, review dependency versions, or assess upgrade impact/breaking changes. Report-only — never modifies manifests or lockfiles.
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Library Updater

Audits a project's dependencies and produces `LIBRARY-UPDATE-REPORT.md`: every possible update, whether the latest versions are compatible **with each other**, the breaking changes involved, and the concrete impact on this codebase.

**This skill is report-only.** Never edit manifests (`package.json`, `pyproject.toml`, …), lockfiles, or source code during the audit. Applying upgrades is a separate task the user starts from the report.

## Core principles

1. **Discover, don't assume.** Detect the stack from manifest files before doing anything. A repo may contain several projects/stacks (monorepo) — enumerate all, then audit the one the user pointed at (ask only if genuinely ambiguous).
2. **Registry truth, not memory.** Latest versions, peer constraints, and deprecations MUST come from the package registry at audit time (helper script, native tooling, or registry API). Never state a "latest version" from training data.
3. **Compatibility is a set property.** Check that the latest versions are compatible *with each other* and with the runtime — not just each package against today's installed set. Example: `A@latest` may declare a peer range that excludes `B@latest`; then A or B must be held back, and the report must say which and why.
4. **Impact means files.** A breaking change only matters if the project uses the affected API. Every reported breaking change must be paired with a codebase scan result: impacted files (or "no usage found — no impact").

## Workflow

### Phase 0 — Stack discovery

Search the target directory (excluding vendor dirs: `node_modules`, `vendor`, `.venv`, `target`, `dist`, `build`) for dependency manifests:

| Manifest found | Ecosystem |
|---|---|
| `package.json` | npm/pnpm/yarn (Node.js) |
| `pyproject.toml`, `requirements*.txt`, `Pipfile`, `setup.py` | Python (pip/poetry/uv) |
| `composer.json` | PHP (Composer) |
| `Cargo.toml` | Rust (cargo) |
| `go.mod` | Go modules |
| `pom.xml`, `build.gradle(.kts)` | Java/Kotlin (Maven/Gradle) |
| `*.csproj`, `packages.config`, `Directory.Packages.props` | .NET (NuGet) |
| `Gemfile` | Ruby (Bundler) |
| `pubspec.yaml` | Dart/Flutter (pub) |
| `mix.exs` | Elixir (hex) |

Also record the **runtime constraint**: `engines` field, `.nvmrc`, `requires-python`, `go` directive in `go.mod`, `rust-toolchain.toml`, `.ruby-version`, `<TargetFramework>`, etc., plus the runtime version actually available (`node -v`, `python --version`, …). Note which lockfile exists and the package manager it implies.

Announce what was detected before continuing.

### Phase 1 — Inventory: current vs latest

Collect, for every direct dependency (prod and dev): declared range, installed version, latest version, semver bump class, deprecation status.

- **npm**: run the bundled collector — `node <skill-dir>/scripts/collect-npm.js <projectDir> --output <scratchpad>/versions.json`. It also captures each latest version's `peerDependencies` and `engines` (needed in Phase 2). Check `bumpBasis`: `declared-range` means nothing is installed and no lockfile exists, so the bump is measured from the range's lower bound — say so in the report.
- **Other ecosystems**: use the native "outdated" tooling and registry APIs listed in [references/ecosystems.md](references/ecosystems.md).

If registry access fails (offline/sandboxed), say so and stop — do not fabricate versions.

### Phase 2 — Cross-compatibility matrix

Using the latest-version metadata, verify the **target set** (everything at latest):

1. **Peer/companion constraints**: for each package whose latest declares peers (npm `peerDependencies`, Composer `require`, Python `Requires-Dist`, …), check the peer's *latest* version satisfies the declared range. Flag violations with both package names and the exact ranges.
2. **Runtime constraints**: each latest version's engine/runtime requirement vs the project's runtime constraint from Phase 0.
3. **Known companion pairs**: packages that must move in lockstep even without formal peer declarations — e.g. `jest`/`@types/jest`/`jest-*` transforms, `@apollo/server`/its integrations, `@aws-sdk/*` family, framework + its typings, testing library + framework version.
4. **Deprecated/abandoned**: flag anything deprecated on the registry or with no publish activity for years, and suggest the registry-recommended replacement if one is named.

Classify every package: `SAFE` (patch/minor, no flags) · `MAJOR` (needs Phase 3 research) · `BLOCKED` (peer/runtime conflict — name the blocker) · `HOLD` (deprecated / needs replacement decision).

### Phase 3 — Breaking-change research

For every `MAJOR` bump (and any minor with known behavioral changes), gather the changelog between the installed and latest version:

- Prefer the context7 MCP tools (`resolve-library-id` → `query-docs`) for migration guides; fall back to WebFetch of the package's CHANGELOG/GitHub releases; WebSearch as last resort.
- When several majors are being crossed (e.g. v7 → v13), collect the breaking changes of **every** intermediate major, not just the last one.
- For 3+ packages needing research, fan out parallel research agents (one per package or per family) rather than researching serially.
- Record only breaking changes that could plausibly apply to this project's usage; note dropped runtime support explicitly.

### Phase 4 — Code impact scan

For each breaking change recorded in Phase 3, grep the project source (exclude vendor dirs and lockfiles) for the affected imports/APIs/options:

- Find every import/require of the package to bound the search surface.
- Search for the specific symbols/options/behaviors the changelog says changed.
- Output per package: impacted files with line references, what must change, and an effort estimate (`trivial` / `small` / `medium` / `large`). If nothing is impacted, record "no usage of changed APIs — safe despite major bump."

### Phase 5 — Report

Write `LIBRARY-UPDATE-REPORT.md` in the audited project's root, structured as:

1. **Header**: project, stack detected, runtime constraint, date, totals (X current / Y minor / Z major / N blocked / M deprecated).
2. **Summary table**: package · type (prod/dev) · installed → latest · bump · classification · one-line note.
3. **Compatibility findings**: the set-level conflicts and lockstep groups from Phase 2 (explicitly say "all latest versions are mutually compatible" if true).
4. **Upgrade waves**:
   - *Wave 1 — safe batch*: all patch/minor, one commit, run tests.
   - *Wave 2 — low-impact majors*: majors whose changed APIs the project doesn't use.
   - *Wave 3 — migrations*: majors with real code impact, one per PR, ordered by dependency.
   - *Blocked / Hold*: with the exact blocker and the condition that unblocks it.
5. **Per-package detail** (majors only): installed → latest, breaking changes crossed, impacted files with line refs, required code changes, effort estimate, links to migration guides.
6. **Verification plan**: which test suites/commands to run after each wave, plus any manual checks (e.g. auth flow if the JWT lib moved).

End by telling the user the report path and offering to apply Wave 1 as a follow-up task.

## Best practices

- Put intermediate artifacts (`versions.json`, changelog notes) in the scratchpad, never in the project.
- If the project has no lockfile, flag that in the report — reproducibility risk exists regardless of upgrades.
- Security advisories are a bonus, not the goal: if the ecosystem has a one-shot audit command (`npm audit`, `pip-audit`, `cargo audit`, `composer audit`), run it read-only and fold criticals into the report; skip if unavailable.
- Monorepos: audit each package/workspace separately but check cross-workspace version alignment (same lib pinned differently in two workspaces is a finding).
- Keep the report actionable: a teammate should be able to execute Wave 1 without re-doing any research.
