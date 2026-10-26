# Library Updater — per-ecosystem reference

Commands and registry APIs for Phase 1 (inventory) and Phase 2 (compatibility) per ecosystem.
All commands are read-only. Run them from the project directory unless noted.

## Node.js (npm / pnpm / yarn)

- **Preferred**: bundled collector (works even without `node_modules`, captures peer deps + engines of latest):
  ```bash
  node <skill-dir>/scripts/collect-npm.js <projectDir> --output versions.json
  ```
- Native alternatives: `npm outdated --json` · `pnpm outdated --format json` · `yarn outdated --json`
- Single-package metadata: `npm view <pkg>@latest version peerDependencies engines deprecated --json`
- Registry API: `https://registry.npmjs.org/<pkg>` (all versions), `https://registry.npmjs.org/<pkg>/latest`
- Security: `npm audit --json` (needs lockfile)
- Lockstep families: `@aws-sdk/*`, `@apollo/*` + integrations, `jest` + `@types/jest` + `babel-jest`/`ts-jest`, `eslint` + plugins, `@angular/*`, `react` + `react-dom` + `@types/react`.

## Python (pip / poetry / uv)

- `pip list --outdated --format=json` (reflects the active venv)
- `poetry show --outdated --no-ansi` · `uv pip list --outdated`
- Registry API: `https://pypi.org/pypi/<pkg>/json` → `info.requires_python`, `info.requires_dist` (peer-equivalent), `info.yanked`
- Security: `pip-audit --format json` (if installed)
- Runtime constraint: `requires-python` in `pyproject.toml`.

## PHP (Composer)

- `composer outdated --direct --format=json`
- Latest metadata: `composer show <pkg> --latest --all` or `https://repo.packagist.org/p2/<vendor>/<pkg>.json`
- `require` of the latest version = peer-equivalent (includes `php` version constraint)
- Security: `composer audit --format=json`

## Rust (cargo)

- `cargo update --dry-run` (prints available bumps) or `cargo outdated --format json` (if installed)
- Registry API: `https://crates.io/api/v1/crates/<crate>` → `max_stable_version`, per-version `rust_version` (MSRV)
- Security: `cargo audit --json` (if installed)

## Go (modules)

- `go list -m -u -json all` — current + available update per module (direct: filter `.Indirect == false`)
- `go` directive in `go.mod` of the latest module version = minimum Go version
- Security: `govulncheck -json ./...` (if installed)

## Java / Kotlin (Maven / Gradle)

- Maven: `mvn versions:display-dependency-updates -DprocessDependencyManagement=false`
- Gradle: `./gradlew dependencyUpdates` (ben-manes versions plugin, if configured)
- Registry API: `https://search.maven.org/solrsearch/select?q=g:<group>+AND+a:<artifact>&core=gav&rows=5&wt=json`
- Java version requirement: check the artifact's POM / release notes (bytecode target).

## .NET (NuGet)

- `dotnet list package --outdated --format json`
- Registry API: `https://api.nuget.org/v3-flatcontainer/<pkg-lower>/index.json` (versions list)
- `dotnet list package --vulnerable --format json`

## Ruby (Bundler)

- `bundle outdated --parseable`
- Registry API: `https://rubygems.org/api/v1/gems/<gem>.json` → `version`, `dependencies.runtime` (peer-equivalent)
- Security: `bundle audit check --format json` (if installed)

## Dart / Flutter (pub)

- `dart pub outdated --json` / `flutter pub outdated --json`
- Registry API: `https://pub.dev/api/packages/<pkg>` → latest `pubspec.environment.sdk` constraint

## Elixir (hex)

- `mix hex.outdated`
- Registry API: `https://hex.pm/api/packages/<pkg>` → `releases`, requirements per release

## Changelog sources (Phase 3), in preference order

1. context7 MCP: `resolve-library-id` then `query-docs` with "migration"/"breaking changes"/"upgrade from vX"
2. Repo files via WebFetch: `CHANGELOG.md`, `UPGRADING.md`, `MIGRATION.md` on the package's repo (raw.githubusercontent.com)
3. GitHub Releases: `https://api.github.com/repos/<owner>/<repo>/releases?per_page=50` (filter tags between installed and latest)
4. Official docs migration pages (e.g. expressjs.com/en/guide/migrating-5, docs.nestjs.com migration)
5. WebSearch: `"<pkg>" vN breaking changes migration` — verify against a primary source before reporting.

When a bump crosses several majors, walk every major boundary (7→13 means reading 8.0, 9.0, 10.0, 11.0, 12.0, 13.0 notes).
