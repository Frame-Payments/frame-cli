/**
 * Tests for README.md — asserts it satisfies the acceptance criteria for FRA-3486.
 *
 * Strategy: read the rendered Markdown source and assert presence of key strings.
 * We are testing the *shape of the artifact*, not the implementation that produced it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(__dirname, "..", "README.md"), "utf8");

describe("README.md", () => {
  it("mentions the package name and sandbox-only status in the header", () => {
    expect(readme).toMatch(/Frame CLI/);
    expect(readme).toMatch(/sandbox/i);
    expect(readme).toMatch(/0\.0\.0/);
  });

  describe("Install section", () => {
    it("includes npm global install command", () => {
      expect(readme).toContain("npm i -g @framepayments/cli");
    });

    it("includes npx escape hatch", () => {
      expect(readme).toContain("npx @framepayments/cli");
    });

    it("mentions Node.js >= 20 requirement", () => {
      expect(readme).toMatch(/[Nn]ode\.?[Jj]s?\s*[≥>=]+\s*20/);
    });
  });

  describe("Quickstart section", () => {
    it("includes frame login as the first step", () => {
      expect(readme).toContain("frame login");
    });

    it("includes frame listen --forward-to with backgrounding pattern", () => {
      expect(readme).toMatch(/frame listen --forward-to/);
      expect(readme).toContain("&");
    });

    it("uses frame trigger transfer.completed", () => {
      expect(readme).toContain("frame trigger transfer.completed");
    });
  });

  describe("Command table", () => {
    const commands = [
      "frame login",
      "frame logout",
      "frame whoami",
      "frame logs tail",
      "frame listen",
      "frame trigger",
      "frame events resend",
      "frame open",
    ];

    for (const cmd of commands) {
      it(`includes '${cmd}' in the command table`, () => {
        expect(readme).toContain(cmd);
      });
    }

    it("omits the placeholder command", () => {
      expect(readme).not.toContain("placeholder");
    });
  });

  describe("For AI agents section", () => {
    it("includes npx skills add with canonical case-sensitive org name", () => {
      expect(readme).toContain("npx skills add Frame-Payments/frame-cli");
    });

    it("includes the skills.sh URL with canonical case-sensitive org name", () => {
      expect(readme).toContain(
        "skills.sh/Frame-Payments/frame-cli/frame-cli",
      );
    });
  });

  describe("Sandbox-only notice", () => {
    it("explicitly states live keys are rejected", () => {
      expect(readme).toMatch(/[Ll]ive.*key.*rejected|key.*rejected.*live/is);
    });
  });

  describe("Contributing section", () => {
    it("links to CONTEXT.md", () => {
      expect(readme).toContain("CONTEXT.md");
    });

    it("links to docs/adr/", () => {
      expect(readme).toContain("docs/adr/");
    });

    it("includes the three-surface checklist (implementation, --help example, SKILL.md entry)", () => {
      expect(readme).toMatch(/[Ii]mplementation/);
      expect(readme).toMatch(/--help/);
      expect(readme).toMatch(/SKILL\.md/);
    });
  });

  describe("Deliberately excluded content", () => {
    it("has no badges (shields.io or similar)", () => {
      expect(readme).not.toContain("shields.io");
      expect(readme).not.toContain("badge");
    });

    it("has no roadmap section", () => {
      expect(readme).not.toMatch(/##\s*[Rr]oadmap/);
    });

    it("has no logo image", () => {
      expect(readme).not.toMatch(/!\[.*logo.*\]/i);
    });
  });

  it("includes MIT license note", () => {
    expect(readme).toMatch(/MIT/);
  });
});
