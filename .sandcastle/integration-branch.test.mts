import { test } from "node:test";
import assert from "node:assert/strict";

import {
  integrationBranchFor,
  issueIdFor,
  parseMergedSliceBranches,
  renderSlices,
} from "./integration-branch.mts";

test("integrationBranchFor lowercases the issue id under the sandcastle prefix", () => {
  assert.equal(integrationBranchFor("FRA-6393"), "sandcastle/fra-6393");
});

test("issueIdFor inverts integrationBranchFor", () => {
  assert.equal(issueIdFor("sandcastle/fra-6394"), "FRA-6394");
  assert.equal(issueIdFor(integrationBranchFor("FRA-6393")), "FRA-6393");
});

test("parseMergedSliceBranches reads slice branches from git's default merge subjects", () => {
  const subjects = [
    "Merge branch 'sandcastle/fra-7137' into sandcastle/fra-7128",
    "Merge branch 'sandcastle/fra-7129' into sandcastle/fra-7128",
    "fix(geo-gate): reconcile fra-7136 with fra-7130",
    "Merge branch 'sandcastle/fra-7129' into sandcastle/fra-7128",
    "",
  ].join("\n");

  assert.deepEqual(parseMergedSliceBranches(subjects, "sandcastle/fra-7128"), [
    "sandcastle/fra-7129",
    "sandcastle/fra-7137",
  ]);
});

test("parseMergedSliceBranches ignores nested sandcastle branches and non-sandcastle merges", () => {
  const subjects = [
    "Merge branch 'sandcastle/batch/fra-6393' into sandcastle/fra-7128",
    "Merge branch 'main' into sandcastle/fra-7128",
    "Merge branch 'sean/some-branch' into sandcastle/fra-7128",
  ].join("\n");

  assert.deepEqual(parseMergedSliceBranches(subjects, "sandcastle/fra-7128"), []);
});

test("parseMergedSliceBranches never reports the integration branch as its own slice", () => {
  assert.deepEqual(
    parseMergedSliceBranches("Merge branch 'sandcastle/fra-7128' into sandcastle/fra-7128", "sandcastle/fra-7128"),
    [],
  );
});

test("renderSlices formats one line per slice and falls back to the empty note", () => {
  assert.equal(
    renderSlices(
      [
        { id: "FRA-6394", title: "Add the model", branch: "sandcastle/fra-6394" },
        { id: "FRA-6395", title: "Wire the job", branch: "sandcastle/fra-6395" },
      ],
      "(none)",
    ),
    "- FRA-6394: Add the model (`sandcastle/fra-6394`)\n- FRA-6395: Wire the job (`sandcastle/fra-6395`)",
  );
  assert.equal(renderSlices([], "(none)"), "(none)");
});
