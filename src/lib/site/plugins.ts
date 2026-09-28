// Reads plugin manifests from `<dir>/*/manifest.json` for the studio
// Plugins page. Pure filesystem + validation module: no astro/db imports,
// so it is directly unit-testable against a fixture temp directory.
//
// A plugin package looks like `packages/<name>/{manifest.json, Component.astro}`.
// Only manifests whose `targets` include `'so'` are returned; anything
// invalid (bad JSON, wrong shape) is skipped with a `console.warn` — a
// broken or unrelated package must never crash the Plugins page.

import fs from 'node:fs/promises';
import path from 'node:path';

export type PluginOptionType = 'string' | 'number' | 'boolean';

export type PluginOption = {
  type: PluginOptionType;
  default?: unknown;
  example?: unknown;
  description?: string;
};

export type PluginManifest = {
  name: string;
  description: string;
  targets: string[];
  options: Record<string, PluginOption>;
};

const OPTION_TYPES: readonly PluginOptionType[] = ['string', 'number', 'boolean'];

function isPluginOption(value: unknown): value is PluginOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const opt = value as Record<string, unknown>;
  if (!OPTION_TYPES.includes(opt.type as PluginOptionType)) return false;
  if ('description' in opt && opt.description !== undefined && typeof opt.description !== 'string') return false;
  return true;
}

/**
 * Validates the parsed JSON of a `manifest.json` against the plugin
 * manifest shape (spec 3.3): `{ name, description, targets: string[],
 * options: Record<string, { type, default?, example?, description? }> }`.
 * Returns `null` (never throws) when the shape doesn't match.
 */
export function parsePluginManifest(json: unknown): PluginManifest | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const raw = json as Record<string, unknown>;

  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  if (typeof raw.description !== 'string') return null;
  if (!Array.isArray(raw.targets) || !raw.targets.every((t) => typeof t === 'string')) return null;

  const targets = raw.targets as string[];

  const optionsRaw = raw.options;
  if (optionsRaw === undefined) {
    // `options` may be omitted for a plugin with no configurable options.
    return { name: raw.name, description: raw.description, targets, options: {} };
  }
  if (!optionsRaw || typeof optionsRaw !== 'object' || Array.isArray(optionsRaw)) return null;

  const options: Record<string, PluginOption> = {};
  for (const [key, value] of Object.entries(optionsRaw as Record<string, unknown>)) {
    if (!isPluginOption(value)) return null;
    options[key] = value;
  }

  return { name: raw.name, description: raw.description, targets, options };
}

/**
 * Reads `<dir>/*\/manifest.json` for every immediate subdirectory of `dir`,
 * validates each manifest, and returns those whose `targets` include
 * `'so'`, sorted by name. Missing `dir`, unreadable entries, invalid JSON,
 * or a manifest with the wrong shape are skipped with a `console.warn` —
 * this never throws.
 */
export async function listPlugins(dir: string): Promise<PluginManifest[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[site/plugins] could not read plugins dir "${dir}":`, (err as Error)?.message ?? err);
    return [];
  }

  const manifests: PluginManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, 'manifest.json');
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      // No manifest.json in this subdirectory — not a plugin package, skip silently.
      continue;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      console.warn(`[site/plugins] invalid JSON in "${manifestPath}":`, (err as Error)?.message ?? err);
      continue;
    }
    const manifest = parsePluginManifest(parsedJson);
    if (!manifest) {
      console.warn(`[site/plugins] "${manifestPath}" does not match the plugin manifest shape, skipping.`);
      continue;
    }
    if (!manifest.targets.includes('so')) continue;
    manifests.push(manifest);
  }

  manifests.sort((a, b) => a.name.localeCompare(b.name));
  return manifests;
}

export function pluginsDir(): string {
  return process.env.PLUGINS_DIR || '/opt/packages';
}
