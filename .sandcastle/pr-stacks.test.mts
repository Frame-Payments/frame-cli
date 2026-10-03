import { test } from "node:test";
import assert from "node:assert/strict";

import { sandcastleStack, type PrRecord } from "./pr-stacks.mts";

const pr = (overrides: Partial<PrRecord>): PrRecord => ({
  number: 1,
  headRefName: "sandcastle/fra-1000",
  baseRefName: "main",
  title: "FRA-1000: Example",
  ...overrides,
});

test("filters to sandcastle/* branches only", () => {
  const { branches } = sandcastleStack(
    [
      pr({ headRefName: "sandcastle/fra-1000" }),
      pr({ headRefName: "feature/human-branch", number: 2 }),
      pr({ headRefName: "main", number: 3 }),
    ],
    "(none)",
  );
  assert.deepEqual([...branches], ["sandcastle/fra-1000"]);
});

test("sorts display lines by branch name and formats like the planner expects", () => {
  const { display } = sandcastleStack(
    [
      pr({
        headRefName: "sandcastle/fra-2000",
        baseRefName: "main",
        number: 42,
        title: "FRA-2000: Second",
      }),
      pr({
        headRefName: "sandcastle/fra-1000",
        baseRefName: "sandcastle/fra-0999",
        number: 41,
        title: "FRA-1000: First",
      }),
    ],
    "(none)",
  );
  assert.equal(
    display,
    "- sandcastle/fra-1000 (base: sandcastle/fra-0999) — PR #41: FRA-1000: First\n" +
      "- sandcastle/fra-2000 (base: main) — PR #42: FRA-2000: Second",
  );
});

test("returns the caller's empty note when no sandcastle PRs exist", () => {
  const { display, branches } = sandcastleStack(
    [pr({ headRefName: "feature/x" })],
    "(none — no open sandcastle PRs on origin)",
  );
  assert.equal(display, "(none — no open sandcastle PRs on origin)");
  assert.equal(branches.size, 0);
});
