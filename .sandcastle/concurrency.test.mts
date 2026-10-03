import { test } from "node:test";
import assert from "node:assert/strict";

import { settleWithLimit } from "./concurrency.mts";

test("settleWithLimit never runs more than the limit at once", async () => {
  let running = 0;
  let peak = 0;
  await settleWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
  });
  assert.equal(peak, 3);
});

test("settleWithLimit keeps results in input order and isolates rejections", async () => {
  const results = await settleWithLimit([30, 1, 20], 2, async (ms) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (ms === 1) throw new Error("boom");
    return ms * 2;
  });
  assert.deepEqual(results[0], { status: "fulfilled", value: 60 });
  assert.equal(results[1]!.status, "rejected");
  assert.deepEqual(results[2], { status: "fulfilled", value: 40 });
});

test("settleWithLimit returns an empty list for no items", async () => {
  assert.deepEqual(await settleWithLimit([], 4, async () => 1), []);
});
