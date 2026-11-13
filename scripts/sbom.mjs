#!/usr/bin/env node
/**
 * SBOM em formato CycloneDX 1.5 (mínimo viável) a partir de `npm ls --json`.
 *
 *   node scripts/sbom.mjs [saida.json]
 *   npm run sbom
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = resolve(process.argv[2] ?? join(root, 'sbom.json'));

function npmLs() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const text = execFileSync(npm, ['ls', '--all', '--json', '--omit=dev'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(text);
}

const tree = npmLs();
const components = [];
const seen = new Set();

function add(name, version) {
  const key = `${name}@${version ?? 'unknown'}`;
  if (seen.has(key)) return;
  seen.add(key);
  components.push({
    type: 'library',
    name,
    version: version ?? 'unknown',
    purl: `pkg:npm/${name.replace('@', '%40')}@${version ?? 'unknown'}`,
  });
}

function walk(node) {
  for (const [name, dependency] of Object.entries(node.dependencies ?? {})) {
    add(name, dependency.version);
    walk(dependency);
  }
}
walk(tree);
add(tree.name ?? 'c4arch', tree.version);

let lockHash = null;
try {
  lockHash = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex');
} catch {
  // sem lockfile
}

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'C4Arch', name: 'scripts/sbom.mjs', version: '0.1.0' }],
    component: {
      type: 'application',
      name: tree.name ?? 'c4arch',
      version: tree.version ?? '0.1.0',
    },
    properties: lockHash
      ? [{ name: 'c4arch:package-lock:sha256', value: lockHash }]
      : [],
  },
  components: components.sort((a, b) => a.name.localeCompare(b.name)),
};

writeFileSync(output, JSON.stringify(bom, null, 2) + '\n', 'utf8');
console.log(`SBOM gerado em ${output} (${components.length} componentes).`);
