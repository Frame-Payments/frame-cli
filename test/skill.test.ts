/**
 * Validates skills/frame-cli/SKILL.md frontmatter against the agentskills.io spec.
 * Catches regressions before they silently break agent skill discovery.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(__dirname, "..", "skills", "frame-cli", "SKILL.md");

function parseSkillFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("No YAML frontmatter found in SKILL.md");
  return parse(match[1]) as Record<string, unknown>;
}

describe("skills/frame-cli/SKILL.md", () => {
  const raw = readFileSync(SKILL_PATH, "utf-8");
  const fm = parseSkillFrontmatter(raw);
  const body = raw.replace(/^---[\s\S]*?---/, "");

  it("has a name field equal to 'frame-cli'", () => {
    expect(fm.name).toBe("frame-cli");
  });

  it("has a non-empty description", () => {
    expect(typeof fm.description).toBe("string");
    expect((fm.description as string).length).toBeGreaterThan(0);
  });

  it("description is at most 1024 characters (agentskills.io hard limit)", () => {
    expect((fm.description as string).length).toBeLessThanOrEqual(1024);
  });

  it("has a compatibility field", () => {
    expect(fm.compatibility).toBeDefined();
    expect(typeof fm.compatibility).toBe("string");
  });

  it("has an allowed-tools field", () => {
    expect(fm["allowed-tools"]).toBeDefined();
  });

  it("body contains all 7 documented commands (omits placeholder)", () => {
    const commands = [
      "frame login",
      "frame logout",
      "frame whoami",
      "frame listen",
      "frame events resend",
      "frame open",
    ];
    for (const cmd of commands) {
      expect(body, `body should mention "${cmd}"`).toContain(cmd);
    }
    expect(body, "body should NOT mention 'placeholder'").not.toContain(
      "placeholder"
    );
    expect(body, "body should NOT mention 'frame trigger' (removed in v1)").not.toContain(
      "frame trigger"
    );
  });



  it("body contains a Gotchas section", () => {
    expect(body).toContain("Gotchas");
  });
});
