import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { generateResourceCommands } from "../src/codegen/generate.js";

function readYaml(relativePath: string): unknown {
  return parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

const fixtureSpec = readYaml("./fixtures/openapi/spec.yaml");
const fixtureAllowList = readYaml("./fixtures/openapi/allowlist.yaml");

function generatedSource(spec: unknown, allowList: unknown): string {
  return generateResourceCommands(spec, allowList)
    .map((file) => `// ${file.path}\n${file.contents}`)
    .join("\n");
}

describe("generateResourceCommands", () => {
  it("emits the command tree for the allow-listed operations", () => {
    expect(generatedSource(fixtureSpec, fixtureAllowList)).toMatchSnapshot();
  });

  it("ignores operations that are not on the allow-list", () => {
    const source = generatedSource(fixtureSpec, fixtureAllowList);
    expect(source).not.toContain("/v1/transfers");
    expect(source).not.toContain("/v1/customers");
  });

  it("turns nested request fields into dotted flags described by the spec", () => {
    const source = generatedSource(fixtureSpec, fixtureAllowList);
    expect(source).toContain('"flag": "amount.value"');
    expect(source).toContain('"flag": "source.payment_method_id"');
    expect(source).toContain("Payment method the funds are pulled from");
  });

  it("fails when an allow-listed operation is missing from the spec", () => {
    const allowList = {
      resources: {
        transfers: {
          description: "Core Transfers",
          columns: ["id"],
          operations: { cancel: "POST /v2/transfers/{id}/cancel" },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers cancel.*POST \/v2\/transfers\/\{id\}\/cancel.*missing/,
    );
  });

  it("describes a path argument from its referenced schema", () => {
    const spec = structuredClone(fixtureSpec) as {
      paths: Record<string, { parameters: unknown[] }>;
      components: { schemas: Record<string, unknown> };
    };
    spec.components.schemas.TransferId = { type: "string", description: "Id of the Core Transfer" };
    spec.paths["/v2/transfers/{id}"]!.parameters = [
      { name: "id", in: "path", required: true, schema: { $ref: "#/components/schemas/TransferId" } },
    ];
    expect(generatedSource(spec, fixtureAllowList)).toContain('"description": "Id of the Core Transfer"');
  });

  it("fails when a request field would shadow a built-in flag", () => {
    const spec = structuredClone(fixtureSpec) as {
      components: { schemas: { TransferCreate: { properties: Record<string, unknown> } } };
    };
    spec.components.schemas.TransferCreate.properties.json = { type: "string" };
    expect(() => generateResourceCommands(spec, fixtureAllowList)).toThrow(/--json/);
  });
});
