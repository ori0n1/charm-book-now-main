import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const active = "dist";
const rollback = "tmp/referral-premium-rollback-v2/dist";
const configName = "wrangler.referral.production.json";

function router(directory) {
  const assets = join(directory, "server", "assets");
  const name = readdirSync(assets).find((item) => /^router-.*\.js$/.test(item));
  assert.ok(name, `router bundle missing in ${directory}`);
  return readFileSync(join(assets, name), "utf8");
}

test("active and rollback Worker preserve the same complete production config", () => {
  const expected = readFileSync(join(active, "server", configName), "utf8");
  assert.equal(readFileSync(join(rollback, "server", configName), "utf8"), expected);
  const config = JSON.parse(expected);
  assert.equal(config.name, "tanstack-start-app");
  assert.equal(config.keep_vars, true);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(Object.keys(config.vars).length, 27);
  assert.equal(config.secrets.required.length, 24);
  assert.deepEqual(config.triggers.crons, ["*/10 * * * *"]);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
  for (const directory of [active, rollback]) {
    assert.ok(existsSync(join(directory, "server", "index.js")));
    assert.ok(existsSync(join(directory, "client", "assets")));
    const clientAssets = join(directory, "client", "assets");
    assert.ok(readdirSync(clientAssets).some((name) => name.endsWith(".js") &&
      readFileSync(join(clientAssets, name), "utf8").includes(
        "bellza-connect-financial-live.silas18-so.workers.dev/notifications/financial",
      )), `production public VITE values missing from ${directory}`);
  }
});

test("only the active Worker awards new Premium referrals", () => {
  assert.match(router(active), /function referralRewardAction[\s\S]*?return "premium_award"/);
  assert.match(router(rollback), /function referralRewardAction[\s\S]*?return "premium_pending"/);
  assert.match(router(active), /if \(rewardKind === "legacy_credit"\) return "legacy_credit"/);
  assert.match(router(rollback), /if \(rewardKind === "legacy_credit"\) return "legacy_credit"/);
});
