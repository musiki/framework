import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./pull-sources.mjs", import.meta.url).pathname;

// Fake `git` on PATH: logs every call, fails calls whose args match
// FAKE_GIT_FAIL (regex), and fakes clone / rev-parse / config --get.
const FAKE_GIT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GIT_LOG, JSON.stringify({ args, ssh: process.env.GIT_SSH_COMMAND || null, prompt: process.env.GIT_TERMINAL_PROMPT || null }) + "\\n");
const joined = args.join(" ");
if (process.env.FAKE_GIT_FAIL && new RegExp(process.env.FAKE_GIT_FAIL).test(joined)) {
  console.error("fatal: fake failure");
  process.exit(1);
}
if (args[0] === "clone") {
  const dir = args[args.length - 1];
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, "FRESH"), "fresh");
} else if (args.includes("rev-parse")) {
  console.log("abc1234");
} else if (args.includes("config")) {
  if (process.env.FAKE_ORIGIN) console.log(process.env.FAKE_ORIGIN); else process.exit(1);
}
`;

const TOKEN = "tok_secret_123";

const setup = ({ optional = false, repo = "zzigo/soog-instruments", existing = null } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-ssh-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "git"), FAKE_GIT, { mode: 0o755 });
  const manifest = path.join(dir, "manifest.json");
  fs.writeFileSync(manifest, JSON.stringify({ sources: [{ id: "si", repo, optional }] }));
  const sources = path.join(dir, "sources");
  if (existing) {
    const target = path.join(sources, "si");
    fs.mkdirSync(target, { recursive: true });
    if (existing === "git") fs.mkdirSync(path.join(target, ".git"));
    fs.writeFileSync(path.join(target, "OLD"), "old");
  }
  const log = path.join(dir, "git.log");
  fs.writeFileSync(log, "");
  const run = (env = {}, extraArgs = []) => {
    const e = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GIT_LOG: log, CONTENT_SOURCE_READ_TOKEN: TOKEN, ...env };
    delete e.GIT_SSH_COMMAND;
    delete e.MUSIKI_INSTANCE;
    if (env.GIT_SSH_COMMAND) e.GIT_SSH_COMMAND = env.GIT_SSH_COMMAND;
    const r = spawnSync(process.execPath, [script, "--manifest", manifest, "--sources-dir", sources, ...extraArgs], { cwd: dir, env: e, encoding: "utf8" });
    const calls = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    return { ...r, out: r.stdout + r.stderr, calls };
  };
  return { dir, sources, run, target: path.join(sources, "si") };
};

test("HTTPS clone fails -> retried over SSH, token never logged", () => {
  const t = setup();
  const r = t.run({ FAKE_GIT_FAIL: "clone .*https://" });
  assert.equal(r.status, 0, r.out);
  const clones = r.calls.filter((c) => c.args[0] === "clone");
  assert.equal(clones.length, 2);
  assert.ok(clones[0].args.some((a) => a.startsWith(`https://${TOKEN}@github.com/zzigo/soog-instruments.git`)));
  assert.ok(clones[1].args.includes("git@github.com:zzigo/soog-instruments.git"));
  assert.equal(clones[1].ssh, "ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new");
  assert.equal(clones[1].prompt, "0");
  assert.ok(fs.existsSync(path.join(t.target, "FRESH")));
  assert.ok(!fs.readdirSync(t.sources).some((n) => n.includes(".tmp-")));
  assert.ok(!r.out.includes(TOKEN), "token leaked into logs");
  assert.match(r.out, /over ssh/);
});

test("an existing GIT_SSH_COMMAND is respected", () => {
  const t = setup();
  const r = t.run({ FAKE_GIT_FAIL: "clone .*https://", GIT_SSH_COMMAND: "ssh -i /k" });
  assert.equal(r.status, 0, r.out);
  assert.equal(r.calls.filter((c) => c.args[0] === "clone")[1].ssh, "ssh -i /k");
});

test("both transports fail: required source fails, optional warns and keeps previous checkout", () => {
  const req = setup({ existing: "git" });
  const r1 = req.run({ FAKE_GIT_FAIL: "fetch|clone" });
  assert.notEqual(r1.status, 0);
  assert.ok(!r1.out.includes(TOKEN));
  assert.ok(fs.existsSync(path.join(req.target, "OLD")), "required: old checkout must survive too");

  const opt = setup({ optional: true, existing: "git" });
  const r2 = opt.run({ FAKE_GIT_FAIL: "fetch|clone" });
  assert.equal(r2.status, 0, r2.out);
  assert.match(r2.out, /optional source "si" skipped/);
  assert.ok(fs.existsSync(path.join(opt.target, "OLD")));
  assert.ok(!r2.out.includes(TOKEN));
});

test("--clean keeps the old checkout when the refresh fails (even without .git)", () => {
  const t = setup({ optional: true, existing: "plain" });
  const r = t.run({ FAKE_GIT_FAIL: "clone" }, ["--clean"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(fs.existsSync(path.join(t.target, "OLD")));
  assert.ok(!fs.readdirSync(t.sources).some((n) => n.includes(".tmp-")));
});

test("--clean swaps in the fresh clone on success", () => {
  const t = setup({ existing: "plain" });
  const r = t.run({}, ["--clean"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(fs.existsSync(path.join(t.target, "FRESH")));
  assert.ok(!fs.existsSync(path.join(t.target, "OLD")));
});

test("existing SSH-cloned checkout updates over SSH first, falls back to HTTPS", () => {
  const t = setup({ existing: "git" });
  const r = t.run({ FAKE_ORIGIN: "git@github.com:zzigo/soog-instruments.git" });
  assert.equal(r.status, 0, r.out);
  const setUrls = r.calls.filter((c) => c.args.includes("set-url"));
  assert.equal(setUrls.length, 1);
  assert.ok(setUrls[0].args.includes("git@github.com:zzigo/soog-instruments.git"));
  assert.ok(fs.existsSync(path.join(t.target, "OLD")));

  const t2 = setup({ existing: "git" });
  const r2 = t2.run({ FAKE_ORIGIN: "git@github.com:zzigo/soog-instruments.git", FAKE_GIT_FAIL: "fetch .*--depth 1 origin main" , });
  // both in-place fetches fail (ssh, then https); the fresh clone (ssh first, as the origin is ssh) replaces the checkout
  assert.equal(r2.status, 0, r2.out);
  const urls = r2.calls.filter((c) => c.args.includes("set-url")).map((c) => c.args[c.args.length - 1]);
  assert.equal(urls[0], "git@github.com:zzigo/soog-instruments.git");
  assert.ok(urls[1].startsWith("https://"));
  assert.ok(fs.existsSync(path.join(t2.target, "FRESH")));
});

test("non-GitHub https repos have no SSH fallback", () => {
  const t = setup({ repo: "https://example.org/x/y.git" });
  const r = t.run({ FAKE_GIT_FAIL: "clone" });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.filter((c) => c.args[0] === "clone").length, 1);
});
