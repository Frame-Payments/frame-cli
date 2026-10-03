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

  it("turns an allow-listed body argument into a positional argument", () => {
    const source = generatedSource(fixtureSpec, fixtureAllowList);
    expect(source).toContain('"path": "/v1/accounts/{account_id}/capabilities"');
    expect(source).toMatch(
      /"bodyArgument": \{\s*"name": "capabilities",\s*"description": "Capabilities to request",\s*"choices": \[\s*"card_receive",\s*"bank_account_receive"\s*\]/
    );
  });

  it("gives an operation its own table columns when the allow-list names them", () => {
    const allowList = {
      resources: {
        transfers: {
          tag: "Transfers",
          columns: ["id"],
          operations: {
            list: "GET /v2/transfers",
            confirm: { operation: "POST /v2/transfers/{id}/confirm", columns: ["id", "status"] },
          },
        },
      },
    };
    const [transfers] = generateResourceCommands(fixtureSpec, allowList);
    expect(transfers!.contents).toMatch(
      /"verb": "confirm",[\s\S]*"columns": \[\s*"id",\s*"status"\s*\]/
    );
    expect(transfers!.contents).not.toMatch(
      /"verb": "list",[\s\S]*"columns"[\s\S]*"verb": "confirm"/
    );
  });

  it("fails when a body argument is not a field of the request body", () => {
    const allowList = {
      resources: {
        transfers: {
          tag: "Transfers",
          columns: ["id"],
          operations: { create: { operation: "POST /v2/transfers", argument: "nope" } },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers create.*argument nope/
    );
  });

  it("fails when a body argument is not a list of strings", () => {
    const allowList = {
      resources: {
        transfers: {
          tag: "Transfers",
          columns: ["id"],
          operations: { create: { operation: "POST /v2/transfers", argument: "confirm" } },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers create.*argument confirm/
    );
  });

  it.each(["customers", "coupons"])(
    "fails when the allow-list names %s, a resource outside the canonical set",
    (command) => {
      const allowList = {
        resources: {
          [command]: {
            tag: "Transfers",
            columns: ["id"],
            operations: { list: "GET /v2/transfers" },
          },
        },
      };
      expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
        new RegExp(`${command}.*canonical`)
      );
    }
  );

  it("describes each resource with its spec tag's description", () => {
    const source = generatedSource(fixtureSpec, fixtureAllowList);
    expect(source).toContain(
      '"description": "Core Transfers — money movement in either direction"'
    );
  });

  it("fails when a resource's tag has no description in the spec", () => {
    const allowList = {
      resources: {
        transfers: {
          tag: "Teleports",
          columns: ["id"],
          operations: { list: "GET /v2/transfers" },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers.*tag Teleports/
    );
  });

  it("fails when an allow-listed operation is missing from the spec", () => {
    const allowList = {
      resources: {
        transfers: {
          tag: "Transfers",
          columns: ["id"],
          operations: { cancel: "POST /v2/transfers/{id}/cancel" },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers cancel.*POST \/v2\/transfers\/\{id\}\/cancel.*missing/
    );
  });

  it("describes a path argument from its referenced schema", () => {
    const spec = structuredClone(fixtureSpec) as {
      paths: Record<string, { parameters: unknown[] }>;
      components: { schemas: Record<string, unknown> };
    };
    spec.components.schemas.TransferId = { type: "string", description: "Id of the Core Transfer" };
    spec.paths["/v2/transfers/{id}"]!.parameters = [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { $ref: "#/components/schemas/TransferId" },
      },
    ];
    expect(generatedSource(spec, fixtureAllowList)).toContain(
      '"description": "Id of the Core Transfer"'
    );
  });

  it("fails when --wait names an operation the resource does not have", () => {
    const allowList = {
      resources: {
        transfers: {
          description: "Core Transfers",
          columns: ["id"],
          wait: { terminal_statuses: ["completed"], operations: ["refund"] },
          operations: { retrieve: "GET /v2/transfers/{id}", create: "POST /v2/transfers" },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers\.wait.*refund/
    );
  });

  it("fails when a resource declares --wait without a retrieve to poll", () => {
    const allowList = {
      resources: {
        transfers: {
          description: "Core Transfers",
          columns: ["id"],
          wait: { terminal_statuses: ["completed"], operations: ["create"] },
          operations: { create: "POST /v2/transfers" },
        },
      },
    };
    expect(() => generateResourceCommands(fixtureSpec, allowList)).toThrow(
      /transfers\.wait.*retrieve/
    );
  });

  it("fails when a request field would shadow a built-in flag", () => {
    const spec = structuredClone(fixtureSpec) as {
      components: { schemas: { TransferCreate: { properties: Record<string, unknown> } } };
    };
    spec.components.schemas.TransferCreate.properties.json = { type: "string" };
    expect(() => generateResourceCommands(spec, fixtureAllowList)).toThrow(/--json/);
  });
});
