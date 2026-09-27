import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAuth } from "../apps/server/src/auth.ts";
import { type Config, parseUserKeys } from "../apps/server/src/config.ts";
import { createStore } from "../apps/server/src/db.ts";

const admin = "admin-key-aaaaaaaaaaaaaaaaaaaaaaaa";
const ali = "ali-key-bbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const sara = "sara-key-cccccccccccccccccccccccccccc";

test("parseUserKeys maps names to isolated owners and rejects weak or duplicate entries", () => {
  assert.deepEqual(parseUserKeys(` ali:${ali} , sara:${sara} `), [
    { owner: "user-ali", key: ali },
    { owner: "user-sara", key: sara },
  ]);
  assert.deepEqual(parseUserKeys(""), []);
  assert.throws(() => parseUserKeys("ali:short"), /24\+/);
  assert.throws(() => parseUserKeys(`Ali Reza:${ali}`), /name:key/);
  assert.throws(() => parseUserKeys(`ali:${ali},ali:${sara}`), /unique/);
  assert.throws(() => parseUserKeys(`ali:${ali},sara:${ali}`), /unique/);
});

test("each access key opens its own workspace owner; wrong keys are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "openmuse-keys-"));
  const db = await createStore();
  try {
    const config = {
      mode: "live",
      dataDir: directory,
      accessKey: admin,
      userKeys: parseUserKeys(`ali:${ali},sara:${sara}`),
    } as Config;
    const auth = await createAuth(db, config);
    const owners = await Promise.all(
      [admin, ali, sara].map(async (key) => {
        const { token, owner } = await auth.session(key);
        assert.equal(await auth.owner(`Bearer ${token}`), owner);
        return owner;
      }),
    );
    assert.deepEqual(owners, ["local-user", "user-ali", "user-sara"]);
    await assert.rejects(auth.session("not-a-valid-key-xxxxxxxxxxxxxxxx"), /نادرست/);
    await assert.rejects(auth.session(undefined), /نادرست/);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
