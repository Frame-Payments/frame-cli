import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

vi.mock("../src/auth/keyring.js", () => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));

import * as keyring from "../src/auth/keyring.js";
import { registerResources } from "../src/resources/register.js";
import { runProgram } from "../src/run-program.js";
import { resources, deprecatedResources } from "../src/commands/resources/index.js";
import type { ResourceDefinition } from "../src/resources/definition.js";

const mockGet = vi.mocked(keyring.get);

interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

interface StubResponse {
  status: number;
  body: string;
}

let server: Server;
let baseUrl: string;
let requests: RecordedRequest[];
let nextResponse: StubResponse;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    requests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: req.headers.authorization,
      body: await readBody(req),
    });
    res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
    res.end(nextResponse.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

let stdout: string;
let stderr: string;

beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  mockGet.mockResolvedValue({
    apiKey: "sk_sandbox_xyz",
    merchant: "acct_001",
    devMode: true,
    baseUrl: `${baseUrl}/v1`,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FRAME_API_BASE_URL;
});

function frame(args: string[], defs: ResourceDefinition[] = resources): Promise<number> {
  const program = new Command().name("frame");
  registerResources(program, defs, deprecatedResources);
  return runProgram(program, ["node", "frame", ...args]);
}

const transfer = {
  id: "tr_123",
  object: "transfer",
  status: "succeeded",
  payment_status: "captured",
  failure_code: null,
  amount: { value: 2500, currency: "usd" },
  amount_refunded: { value: 0, currency: "usd" },
};

describe("frame transfers list", () => {
  it("sends the query flags to GET /v2/transfers on the API root", async () => {
    nextResponse = { status: 200, body: JSON.stringify({ data: [transfer] }) };

    const code = await frame(["transfers", "list", "--limit", "10", "--type", "payment"]);

    expect(code).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url).toBe("/v2/transfers?limit=10&type=payment");
    expect(requests[0]!.authorization).toBe("Bearer sk_sandbox_xyz");
  });

  it("writes the API body verbatim to stdout with --json and the banner to stderr", async () => {
    const body = `{"data": [ ${JSON.stringify(transfer)} ], "meta": {"page": 1}}`;
    nextResponse = { status: 200, body };

    const code = await frame(["transfers", "list", "--json"]);

    expect(code).toBe(0);
    expect(stdout).toBe(body);
    expect(stderr).toContain("mode: sandbox");
  });

  it("renders the transfer columns as a table by default", async () => {
    nextResponse = { status: 200, body: JSON.stringify({ data: [transfer] }) };

    await frame(["transfers", "list"]);

    const [header, row] = stdout.trimEnd().split("\n");
    expect(header).toMatch(/^ID\s+STATUS\s+PAYMENT STATUS\s+FAILURE CODE\s+AMOUNT VALUE/);
    expect(row).toMatch(/^tr_123\s+succeeded\s+captured\s+-\s+2500\s+usd\s+0$/);
  });

  it("exits 2 on a usage error without calling the API", async () => {
    const code = await frame(["transfers", "list", "--type", "bogus"]);

    expect(code).toBe(2);
    expect(requests).toHaveLength(0);
    expect(stderr).toMatch(/payment, payout/);
  });

  it("exits 2 when an integer flag is not a number", async () => {
    expect(await frame(["transfers", "list", "--limit", "ten"])).toBe(2);
    expect(requests).toHaveLength(0);
  });
});

describe("frame transfers retrieve", () => {
  it("fetches the transfer by id", async () => {
    nextResponse = { status: 200, body: JSON.stringify(transfer) };

    const code = await frame(["transfers", "retrieve", "tr_123"]);

    expect(code).toBe(0);
    expect(requests[0]!.url).toBe("/v2/transfers/tr_123");
    expect(stdout).toMatch(/tr_123\s+succeeded/);
  });

  it("renders the API's code and message with exit 1 on a 4xx", async () => {
    nextResponse = {
      status: 404,
      body: JSON.stringify({ code: "resource_missing", error_details: { message: "No such transfer" } }),
    };

    const code = await frame(["transfers", "retrieve", "tr_missing"]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("resource_missing: No such transfer (HTTP 404)");
  });

  it("exits 2 when the id is missing", async () => {
    expect(await frame(["transfers", "retrieve"])).toBe(2);
  });

  it("targets --base-url over the stored credential", async () => {
    nextResponse = { status: 200, body: JSON.stringify(transfer) };
    mockGet.mockResolvedValue({ apiKey: "sk_sandbox_xyz", merchant: "acct_001", devMode: true });

    await frame(["transfers", "retrieve", "tr_123", "--base-url", baseUrl]);

    expect(requests[0]!.url).toBe("/v2/transfers/tr_123");
  });

  it("targets FRAME_API_BASE_URL when set", async () => {
    nextResponse = { status: 200, body: JSON.stringify(transfer) };
    mockGet.mockResolvedValue({ apiKey: "sk_sandbox_xyz", merchant: "acct_001", devMode: true });
    process.env.FRAME_API_BASE_URL = `${baseUrl}/v1`;

    await frame(["transfers", "retrieve", "tr_123"]);

    expect(requests[0]!.url).toBe("/v2/transfers/tr_123");
  });

  it("fails with exit 1 when not logged in", async () => {
    mockGet.mockResolvedValue(null);

    expect(await frame(["transfers", "retrieve", "tr_123"])).toBe(1);
    expect(stderr).toMatch(/frame login/);
  });
});

describe("generated --help", () => {
  it("lists every flag with the spec's description", async () => {
    const code = await frame(["transfers", "list", "--help"]);

    expect(code).toBe(0);
    expect(stdout).toContain("--limit <integer>");
    expect(stdout).toContain("Maximum number of transfers to return");
    expect(stdout).toContain("--type <string>");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--base-url <url>");
  });
});

const createTransfer: ResourceDefinition = {
  command: "transfers",
  description: "Core Transfers",
  columns: ["id"],
  operations: [
    {
      verb: "create",
      method: "POST",
      path: "/v2/transfers",
      summary: "Create a Core Transfer",
      pathParams: [],
      acceptsBody: true,
      flags: [
        { flag: "amount.value", location: "body", path: ["amount", "value"], type: "integer", description: "Amount in cents" },
        { flag: "amount.currency", location: "body", path: ["amount", "currency"], type: "string", description: "Currency" },
        { flag: "confirm", location: "body", path: ["confirm"], type: "boolean", description: "Confirm now" },
      ],
    },
  ],
};

describe("request bodies", () => {
  beforeEach(() => {
    nextResponse = { status: 201, body: JSON.stringify({ id: "tr_new" }) };
  });

  it("builds the body from dotted flags", async () => {
    const code = await frame(
      ["transfers", "create", "--amount.value", "2500", "--amount.currency", "usd", "--confirm"],
      [createTransfer],
    );

    expect(code).toBe(0);
    expect(requests[0]!.method).toBe("POST");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      amount: { value: 2500, currency: "usd" },
      confirm: true,
    });
  });

  it("merges dotted flags over a raw --body", async () => {
    await frame(
      ["transfers", "create", "--body", '{"amount":{"value":1,"currency":"usd"},"metadata":{"a":"b"}}', "--amount.value", "99"],
      [createTransfer],
    );

    expect(JSON.parse(requests[0]!.body)).toEqual({
      amount: { value: 99, currency: "usd" },
      metadata: { a: "b" },
    });
  });

  it("reads --body from a file with @path", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "frame-body-")), "body.json");
    writeFileSync(path, '{"amount":{"value":7}}');

    await frame(["transfers", "create", "--body", `@${path}`], [createTransfer]);

    expect(JSON.parse(requests[0]!.body)).toEqual({ amount: { value: 7 } });
  });

  it("exits 2 when --body is not JSON", async () => {
    expect(await frame(["transfers", "create", "--body", "{nope"], [createTransfer])).toBe(2);
    expect(requests).toHaveLength(0);
  });
});

describe("deprecated resources", () => {
  it.each([
    ["customers", "frame accounts"],
    ["charge-intents", "frame transfers"],
    ["payouts", "frame transfers"],
  ])("frame %s redirects to %s and exits non-zero", async (command, canonical) => {
    const code = await frame([command, "list", "--limit", "1"]);

    expect(code).not.toBe(0);
    expect(stderr).toContain(canonical);
    expect(requests).toHaveLength(0);
  });
});
