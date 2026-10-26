#!/usr/bin/env node
/**
 * collect-npm.js — gather upgrade data for every dependency of a Node.js project.
 *
 * Usage: node collect-npm.js [projectDir] [--output <file>]
 *
 * For each entry in dependencies/devDependencies it collects:
 *   - declared range (package.json) and installed version (node_modules or lockfile)
 *   - latest version on the npm registry
 *   - semver bump class (major/minor/patch/none)
 *   - the LATEST version's peerDependencies, peerDependenciesMeta, engines, deprecation notice
 *
 * Output: a single JSON document on stdout (or --output file). No files in the
 * project are modified. Requires network access to registry.npmjs.org.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let projectDir = '.';
let outputFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output') outputFile = args[++i];
  else projectDir = args[i];
}
projectDir = path.resolve(projectDir);

const pkgPath = path.join(projectDir, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error(`No package.json found in ${projectDir}`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// ---- helpers ---------------------------------------------------------------

// package.json may come from an untrusted repo: only let real package names reach
// npm (a key like "--registry=..." would be parsed as an option) or the filesystem.
const VALID_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

function npmView(spec, fields) {
  return new Promise((resolve) => {
    execFile(
      'npm',
      ['view', '--json', '--', spec, ...fields],
      { timeout: 30000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function installedVersion(name) {
  // Prefer node_modules (what actually runs), fall back to package-lock.json.
  const nmPkg = path.join(projectDir, 'node_modules', ...name.split('/'), 'package.json');
  try {
    return JSON.parse(fs.readFileSync(nmPkg, 'utf8')).version;
  } catch { /* not installed */ }
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(projectDir, 'package-lock.json'), 'utf8'));
    const entry = lock.packages && lock.packages[`node_modules/${name}`];
    if (entry && entry.version) return entry.version;
    if (lock.dependencies && lock.dependencies[name]) return lock.dependencies[name].version;
  } catch { /* no lockfile */ }
  return null;
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

function bumpClass(from, to) {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return 'unknown';
  if (b.major > a.major) return 'major';
  if (b.major === a.major && b.minor > a.minor) return 'minor';
  if (b.major === a.major && b.minor === a.minor && b.patch > a.patch) return 'patch';
  if (b.major === a.major && b.minor === a.minor && b.patch === a.patch) return 'none';
  return 'behind-latest'; // installed is ahead of latest tag (rare: prerelease use)
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- main ------------------------------------------------------------------

(async () => {
  const groups = { dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} };
  const entries = [];
  for (const [type, deps] of Object.entries(groups)) {
    for (const [name, declared] of Object.entries(deps)) entries.push({ name, declared, type });
  }

  console.error(`Querying npm registry for ${entries.length} packages...`);
  let done = 0;

  const packages = await mapLimit(entries, 8, async ({ name, declared, type }) => {
    if (!VALID_NAME.test(name)) {
      done++;
      return { name, type, declared, installed: null, latest: null, bump: 'unknown', bumpBasis: null, registryError: 'invalid package name — skipped' };
    }
    const installed = installedVersion(name);
    const meta = await npmView(name, [
      'version', // latest tag
      'deprecated',
      'peerDependencies',
      'peerDependenciesMeta',
      'engines',
      'time.modified',
    ]);
    done++;
    if (done % 10 === 0 || done === entries.length) console.error(`  ${done}/${entries.length}`);

    const latest = meta ? meta.version : null;
    // Peer deps / engines of the *latest* version (what we'd be upgrading to).
    // name + version are always present, which forces `npm view` to return an object:
    // with a single matching field it returns the bare value instead.
    const latestDetail = latest
      ? await npmView(`${name}@${latest}`, ['name', 'version', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'deprecated'])
      : null;

    // Without node_modules or a lockfile, fall back to the lower bound of the declared range.
    const declaredFloor = parseSemver(declared) ? null : (/(\d+\.\d+\.\d+)/.exec(declared || '') || [])[1] || null;
    const baseline = installed || (parseSemver(declared) ? declared : declaredFloor);

    return {
      name,
      type,
      declared,
      installed,
      latest,
      bump: baseline && latest ? bumpClass(baseline, latest) : 'unknown',
      bumpBasis: installed ? 'installed' : baseline ? 'declared-range' : null,
      deprecated: (latestDetail && latestDetail.deprecated) || (meta && meta.deprecated) || null,
      lastPublishActivity: meta ? meta['time.modified'] || null : null,
      latestPeerDependencies: (latestDetail && latestDetail.peerDependencies) || null,
      latestPeerDependenciesMeta: (latestDetail && latestDetail.peerDependenciesMeta) || null,
      latestEngines: (latestDetail && latestDetail.engines) || null,
      registryError: meta ? null : 'npm view failed (network? package unpublished?)',
    };
  });

  const result = {
    project: pkg.name || path.basename(projectDir),
    projectDir,
    collectedWithNode: process.version,
    requiredEngines: pkg.engines || null,
    counts: {
      total: packages.length,
      major: packages.filter((p) => p.bump === 'major').length,
      minor: packages.filter((p) => p.bump === 'minor').length,
      patch: packages.filter((p) => p.bump === 'patch').length,
      current: packages.filter((p) => p.bump === 'none').length,
      unknown: packages.filter((p) => p.bump === 'unknown' || p.bump === 'behind-latest').length,
      deprecated: packages.filter((p) => p.deprecated).length,
    },
    packages: packages.sort((a, b) => a.name.localeCompare(b.name)),
  };

  const json = JSON.stringify(result, null, 2);
  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.error(`Wrote ${outputFile}`);
  } else {
    console.log(json);
  }
})();
