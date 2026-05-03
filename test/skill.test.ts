/**
 * Validates skills/frame-cli/SKILL.md frontmatter against the agentskills.io spec.
 * Catches regressions before they silently break agent-trigger behavior.
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

  it("body contains all 8 documented commands (omits placeholder)", () => {
    const body = raw.replace(/^---[\s\S]*?---/, "");
    const commands = [
      "frame login",
      "frame logout",
      "frame whoami",
      "frame listen",
      "frame logs tail",
      "frame trigger",
      "frame events resend",
      "frame open",
    ];
    for (const cmd of commands) {
      expect(body, `body should mention "${cmd}"`).toContain(cmd);
    }
    expect(body, "body should NOT mention 'placeholder'").not.toContain(
      "placeholder"
    );
  });

  it("body contains all 16 canonical trigger event codes", () => {
    const body = raw.replace(/^---[\s\S]*?---/, "");
    const codes = [
      "account.created",
      "account.updated",
      "account.restricted",
      "account.unrestricted",
      "capability.requested",
      "capability.approved",
      "capability.denied",
      "capability.disabled",
      "transfer.created",
      "transfer.completed",
      "transfer.cancelled",
      "transfer.updated",
      "refund.created",
      "refund.completed",
      "invoice.created",
      "invoice.paid",
    ];
    for (const code of codes) {
      expect(body, `body should contain event code "${code}"`).toContain(code);
    }
  });

  it("body contains the deprecated→canonical event map", () => {
    const body = raw.replace(/^---[\s\S]*?---/, "");
    const deprecated = [
      "customer.created",
      "customer.updated",
      "charge_intent.created",
      "payout.created",
    ];
    for (const code of deprecated) {
      expect(body, `body should mention deprecated code "${code}"`).toContain(
        code
      );
    }
  });

  it("body contains a Gotchas section", () => {
    const body = raw.replace(/^---[\s\S]*?---/, "");
    expect(body).toContain("Gotchas");
  });
});
