import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const pullScript = new URL("./pull-sources.mjs", import.meta.url).pathname;
const assembleScript = new URL("./assemble-content.mjs", import.meta.url).pathname;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.MUSIKI_INSTANCE;
  delete env.CONTENT_SOURCE_TARGET_REPO;
  return env;
}

test("pull-sources: an optional source that cannot be pulled is skipped, required sources still sync", () => {
  const dir = tempDir("pull-optional-");
  const course = path.join(dir, "course-src");
  fs.mkdirSync(path.join(course, "cursos", "c1"), { recursive: true });
  fs.writeFileSync(path.join(course, "cursos", "c1", "a.md"), "# a\n");
  fs.mkdirSync(path.join(course, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    sources: [
      { id: "c1", enabled: true, localPath: course },
      { id: "data", enabled: true, localPath: path.join(dir, "missing"), optional: true, assemble: false },
    ],
  }));
  const r = spawnSync(process.execPath, [pullScript, "--manifest", "manifest.json", "--sources-dir", "src"], {
    cwd: dir, env: cleanEnv({ CONTENT_SOURCE_STRATEGY: "prefer-local" }), encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /optional source "data" skipped/);
  assert.ok(fs.existsSync(path.join(dir, "src", "c1", "cursos", "c1", "a.md")));
  assert.ok(!fs.existsSync(path.join(dir, "src", "c1", "node_modules")), "node_modules is not copied");
});

test("pull-sources: a required source that cannot be pulled still fails", () => {
  const dir = tempDir("pull-required-");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    sources: [{ id: "req", enabled: true, localPath: path.join(dir, "missing") }],
  }));
  const r = spawnSync(process.execPath, [pullScript, "--manifest", "manifest.json", "--sources-dir", "src"], {
    cwd: dir, env: cleanEnv({ CONTENT_SOURCE_STRATEGY: "prefer-local" }), encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
});

test("assemble-content: sources with assemble:false are skipped (even without a checkout)", () => {
  const dir = tempDir("assemble-data-");
  fs.mkdirSync(path.join(dir, "src", "c1", "cursos", "c1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "c1", "cursos", "c1", "a.md"), "---\ntitle: A\n---\n# a\n");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    sources: [
      { id: "c1", enabled: true },
      { id: "data", enabled: true, assemble: false },
    ],
  }));
  const r = spawnSync(process.execPath, [
    assembleScript, "--manifest", "manifest.json", "--sources-dir", "src",
    "--staging", "staging", "--report", "report.json", "--target", "content",
  ], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "staging", "cursos", "c1", "a.md")));
});

test("pull-sources: CONTENT_SOURCE_LOCAL_<ID> overrides/provides a source's localPath", () => {
  const dir = tempDir("pull-local-env-");
  const cat = path.join(dir, "vault folder", "case instruments");
  fs.mkdirSync(cat, { recursive: true });
  fs.writeFileSync(path.join(cat, "x.md"), "---\ntype: instrument\n---\n");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    sources: [{ id: "soog-instruments", enabled: true, optional: true, assemble: false }],
  }));
  const r = spawnSync(process.execPath, [pullScript, "--manifest", "manifest.json", "--sources-dir", "src"], {
    cwd: dir,
    env: cleanEnv({ CONTENT_SOURCE_STRATEGY: "prefer-local", CONTENT_SOURCE_LOCAL_SOOG_INSTRUMENTS: cat }),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "src", "soog-instruments", "x.md")));

  // Without the env var and without a repo, the optional source only warns.
  const r2 = spawnSync(process.execPath, [pullScript, "--manifest", "manifest.json", "--sources-dir", "src2"], {
    cwd: dir, env: cleanEnv({ CONTENT_SOURCE_STRATEGY: "prefer-local" }), encoding: "utf8",
  });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.match(r2.stderr, /optional source "soog-instruments" skipped/);
});

test("pull-sources: a failed local copy leaves the previous checkout intact and no temp dir", { skip: process.getuid?.() === 0 }, () => {
  const dir = tempDir("pull-atomic-");
  const local = path.join(dir, "local");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "ok.md"), "ok\n");
  const unreadable = path.join(local, "locked.md");
  fs.writeFileSync(unreadable, "secret\n");
  fs.chmodSync(unreadable, 0o000);
  const previous = path.join(dir, "src", "data");
  fs.mkdirSync(previous, { recursive: true });
  fs.writeFileSync(path.join(previous, "old.md"), "old\n");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    sources: [{ id: "data", enabled: true, localPath: local, optional: true, assemble: false }],
  }));
  try {
    const r = spawnSync(process.execPath, [pullScript, "--manifest", "manifest.json", "--sources-dir", "src"], {
      cwd: dir, env: cleanEnv({ CONTENT_SOURCE_STRATEGY: "prefer-local" }), encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, /optional source "data" skipped/);
    assert.deepEqual(fs.readdirSync(previous), ["old.md"]);
    assert.deepEqual(fs.readdirSync(path.join(dir, "src")), ["data"]);
  } finally {
    fs.chmodSync(unreadable, 0o644);
  }
});

test("musiki manifest carries soog-instruments as an optional data source; hem manifest does not", () => {
  const read = (name) => JSON.parse(fs.readFileSync(new URL(`../config/${name}`, import.meta.url), "utf8"));
  const musiki = read("sources.manifest.json").sources.find((s) => s.id === "soog-instruments");
  assert.ok(musiki);
  assert.equal(musiki.repo, "zzigo/soog-instruments");
  assert.equal(musiki.assemble, false);
  assert.equal(musiki.optional, true);
  assert.equal(musiki.enabled, true);
  assert.equal(musiki.localPath, undefined, "no machine-specific path in the public manifest");
  assert.ok(!read("sources.hem.json").sources.some((s) => s.id === "soog-instruments" || /soog/i.test(s.repo || "")));
});
