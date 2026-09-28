#!/usr/bin/env node
// Vendors the <soog-dashboard> element into public/vendor/soog-dashboard/.
// The engine is built on a CI runner without /opt/packages, so the copy is
// committed. Re-run after updating the package, then commit the result.
//
// Source: $PLUGINS_DIR/soog-dashboard/soog-dashboard.js. Without PLUGINS_DIR
// the first of /opt/packages, ../packages, ../../packages (relative to the
// repo root) that contains soog-dashboard/ is used; locally the engine lives
// at ~/projects/26-musiki/framework and the package at ~/projects/packages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = ['/opt/packages', path.resolve(repoRoot, '..', 'packages'), path.resolve(repoRoot, '..', '..', 'packages')];
const pluginsDir = process.env.PLUGINS_DIR
  || candidates.find((dir) => fs.existsSync(path.join(dir, 'soog-dashboard', 'soog-dashboard.js')))
  || candidates[0];
const source = path.join(pluginsDir, 'soog-dashboard', 'soog-dashboard.js');
const targetDir = path.join(repoRoot, 'public', 'vendor', 'soog-dashboard');
const target = path.join(targetDir, 'soog-dashboard.js');

if (!fs.existsSync(source)) {
  console.error(`soog-dashboard source not found: ${source} (set PLUGINS_DIR)`);
  process.exit(1);
}
const code = fs.readFileSync(source, 'utf8');
const header = code.match(/SOOG_DASHBOARD_VERSION = '(\d+\.\d+\.\d+)'/);
const exported = code.match(/export const SOOG_DASHBOARD_VERSION = '([^']+)'/);
if (!header || !exported || header[1] !== exported[1]) {
  console.error('soog-dashboard.js: missing or inconsistent SOOG_DASHBOARD_VERSION header/export');
  process.exit(1);
}
fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(target, code);
console.log(`vendored soog-dashboard ${exported[1]} from ${source} -> ${path.relative(repoRoot, target)}`);
