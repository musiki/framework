#!/usr/bin/env node
// Usage: node scripts/vps/env-keys-check.mjs <reference.env> <target.env>
// Prints the key NAMES defined in the reference env file and missing from the
// target, one per line. Values are never read into output: only the `KEY=`
// prefix of each line is parsed. Exit 0 when nothing is missing, 1 when keys
// are missing, 2 on usage or read errors.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEY_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export function envKeyNames(text) {
  const names = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const match = KEY_RE.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

export function missingKeys(referenceText, targetText) {
  const target = envKeyNames(targetText);
  return [...envKeyNames(referenceText)].filter((name) => !target.has(name));
}

function main(argv) {
  const [referencePath, targetPath] = argv;
  if (!referencePath || !targetPath) {
    console.error('Usage: node scripts/vps/env-keys-check.mjs <reference.env> <target.env>');
    return 2;
  }
  let referenceText;
  let targetText;
  try {
    referenceText = fs.readFileSync(referencePath, 'utf8');
    targetText = fs.readFileSync(targetPath, 'utf8');
  } catch (error) {
    console.error(`[env-keys-check] Cannot read ${error.path || 'file'}: ${error.code || error.message}`);
    return 2;
  }
  const missing = missingKeys(referenceText, targetText);
  for (const name of missing) console.log(name);
  if (missing.length) {
    console.error(`[env-keys-check] ${missing.length} key(s) from ${referencePath} missing in ${targetPath}`);
    return 1;
  }
  console.error(`[env-keys-check] ${targetPath} has every key in ${referencePath}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
