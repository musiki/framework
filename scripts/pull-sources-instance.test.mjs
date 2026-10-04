import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("./pull-sources.mjs", import.meta.url).pathname;

test("pull-sources picks the manifest from MUSIKI_INSTANCE set only in .env", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-instance-"));
  fs.writeFileSync(path.join(dir, ".env"), "MUSIKI_INSTANCE=hem\n");
  const env = { ...process.env };
  delete env.MUSIKI_INSTANCE;
  const r = spawnSync(process.execPath, [script], { cwd: dir, env, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.match(out, /Manifest not found: .*sources\.hem\.json/);
});
