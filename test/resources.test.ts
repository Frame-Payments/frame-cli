import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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
  idempotencyKey: string | undefined;
  body: string;
  receivedAt: number;
}

interface StubResponse {
  status: number;
  body: string;
  headers?: Record<string, string>;
  delayMs?: number;
}

let server: Server;
let baseUrl: string;
let requests: RecordedRequest[];
let nextResponse: StubResponse;
let queuedResponses: StubResponse[];

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
      idempotencyKey: req.headers["idempotency-key"] as string | undefined,
      body: await readBody(req),
      receivedAt: performance.now(),
    });
    const response = queuedResponses.shift() ?? nextResponse;
    if (response.delayMs !== undefined) await sleep(response.delayMs);
    res.writeHead(response.status, {
      "Content-Type": "application/json",
      ...response.headers,
    });
    res.end(response.body);
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
  queuedResponses = [];
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
      body: JSON.stringify({
        code: "resource_missing",
        error_details: { message: "No such transfer" },
      }),
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
        {
          flag: "amount.value",
          location: "body",
          path: ["amount", "value"],
          type: "integer",
          description: "Amount in cents",
        },
        {
          flag: "amount.currency",
          location: "body",
          path: ["amount", "currency"],
          type: "string",
          description: "Currency",
        },
        {
          flag: "confirm",
          location: "body",
          path: ["confirm"],
          type: "boolean",
          description: "Confirm now",
        },
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
      [createTransfer]
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
      [
        "transfers",
        "create",
        "--body",
        '{"amount":{"value":1,"currency":"usd"},"metadata":{"a":"b"}}',
        "--amount.value",
        "99",
      ],
      [createTransfer]
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

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("idempotency keys", () => {
  beforeEach(() => {
    nextResponse = { status: 201, body: JSON.stringify({ id: "tr_new" }) };
  });

  it("sends a fresh UUID v4 Idempotency-Key on every create", async () => {
    await frame(["transfers", "create", "--amount.value", "1"], [createTransfer]);
    await frame(["transfers", "create", "--amount.value", "1"], [createTransfer]);

    const [first, second] = requests.map((request) => request.idempotencyKey);
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });

  it("sends --idempotency-key verbatim instead of a generated key", async () => {
    await frame(
      ["transfers", "create", "--amount.value", "1", "--idempotency-key", "replay-me"],
      [createTransfer]
    );

    expect(requests[0]!.idempotencyKey).toBe("replay-me");
  });

  it("prints the key used on stderr with the banner and never on stdout", async () => {
    await frame(["transfers", "create", "--amount.value", "1", "--json"], [createTransfer]);

    const key = requests[0]!.idempotencyKey!;
    expect(stderr).toContain("mode: sandbox");
    expect(stderr).toContain(`idempotency-key: ${key}`);
    expect(stdout).toBe(JSON.stringify({ id: "tr_new" }));
  });

  it("shows the Idempotent-Replay header when the API replays the original response", async () => {
    nextResponse = {
      status: 201,
      body: JSON.stringify({ id: "tr_original" }),
      headers: { "Idempotent-Replay": "true" },
    };

    await frame(["transfers", "create", "--idempotency-key", "k1"], [createTransfer]);

    expect(stdout).toContain("tr_original");
    expect(stderr).toContain("Idempotent-Replay: true");
  });

  it("does not mention a replay on a first request", async () => {
    await frame(["transfers", "create", "--idempotency-key", "k1"], [createTransfer]);

    expect(stderr).not.toContain("Idempotent-Replay");
  });

  it("renders a reused key as the API's code and message with exit 1", async () => {
    nextResponse = {
      status: 400,
      body: JSON.stringify({
        code: "idempotency_key_reused",
        error_details: { message: "Keys can only be reused with the same request body" },
      }),
    };

    const code = await frame(
      ["transfers", "create", "--amount.value", "2", "--idempotency-key", "k1"],
      [createTransfer]
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "idempotency_key_reused: Keys can only be reused with the same request body (HTTP 400)"
    );
  });

  it("sends no key and offers no --idempotency-key on reads", async () => {
    nextResponse = { status: 200, body: JSON.stringify(transfer) };

    await frame(["transfers", "retrieve", "tr_123"]);

    expect(requests[0]!.idempotencyKey).toBeUndefined();
    expect(stderr).not.toContain("idempotency-key");
    expect(await frame(["transfers", "retrieve", "tr_123", "--idempotency-key", "k"])).toBe(2);
  });
});

describe("mutating commands", () => {
  beforeEach(() => {
    nextResponse = { status: 200, body: JSON.stringify({ id: "obj_1", status: "ok" }) };
  });

  it("creates a Core Transfer from dotted flags with an idempotency key", async () => {
    const code = await frame([
      "transfers",
      "create",
      "--amount.value",
      "2500",
      "--amount.currency",
      "usd",
      "--source.payment_method_id",
      "pm_ach",
      "--confirm",
    ]);

    expect(code).toBe(0);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe("/v2/transfers");
    expect(requests[0]!.idempotencyKey).toMatch(UUID_V4);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      amount: { value: 2500, currency: "usd" },
      source: { payment_method_id: "pm_ach" },
      confirm: true,
    });
  });

  it.each([
    [["transfers", "confirm", "tr_1"], "/v2/transfers/tr_1/confirm"],
    [["transfers", "refund", "tr_1"], "/v2/transfers/tr_1/refund"],
    [["transfers", "capture", "tr_1"], "/v2/transfers/tr_1/capture"],
    [["transfers", "void", "tr_1"], "/v2/transfers/tr_1/void"],
    [["payment-methods", "block", "pm_1"], "/v1/payment_methods/pm_1/block"],
    [["payment-methods", "unblock", "pm_1"], "/v1/payment_methods/pm_1/unblock"],
    [["payment-methods", "detach", "pm_1"], "/v1/payment_methods/pm_1/detach"],
  ])("frame %j POSTs to %s with an idempotency key", async (args, path) => {
    expect(await frame(args)).toBe(0);

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe(path);
    expect(requests[0]!.idempotencyKey).toMatch(UUID_V4);
  });

  it("attaches a payment method to an account", async () => {
    await frame(["payment-methods", "attach", "pm_1", "--account", "acct_1"]);

    expect(requests[0]!.url).toBe("/v1/payment_methods/pm_1/attach");
    expect(JSON.parse(requests[0]!.body)).toEqual({ account: "acct_1" });
  });

  it("creates an ACH payment method from flags", async () => {
    await frame([
      "payment-methods",
      "create",
      "--type",
      "ach",
      "--account",
      "acct_1",
      "--account_number",
      "1234567890",
      "--routing_number",
      "011000015",
      "--account_type",
      "checking",
    ]);

    expect(requests[0]!.url).toBe("/v1/payment_methods");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      type: "ach",
      account: "acct_1",
      account_number: "1234567890",
      routing_number: "011000015",
      account_type: "checking",
    });
  });

  it("creates an account from deeply dotted profile flags", async () => {
    await frame([
      "accounts",
      "create",
      "--type",
      "individual",
      "--profile.individual.name.first_name",
      "Ada",
      "--profile.individual.email",
      "ada@example.com",
    ]);

    expect(requests[0]!.url).toBe("/v1/accounts");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      type: "individual",
      profile: { individual: { name: { first_name: "Ada" }, email: "ada@example.com" } },
    });
  });

  it("requests capabilities named as positional arguments", async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({ data: [{ name: "bank_account_receive", status: "pending" }] }),
    };

    const code = await frame(["capabilities", "request", "acct_1", "bank_account_receive", "kyc"]);

    expect(code).toBe(0);
    expect(requests[0]!.url).toBe("/v1/accounts/acct_1/capabilities");
    expect(requests[0]!.idempotencyKey).toMatch(UUID_V4);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      capabilities: ["bank_account_receive", "kyc"],
    });
    expect(stdout).toMatch(/bank_account_receive\s+pending/);
  });

  it("exits 2 on an unknown capability without calling the API", async () => {
    expect(await frame(["capabilities", "request", "acct_1", "teleport"])).toBe(2);
    expect(requests).toHaveLength(0);
  });

  it("renders a 422 ACH refusal as the API's code and message with exit 1", async () => {
    nextResponse = {
      status: 422,
      body: JSON.stringify({
        code: "merchant_blocklist",
        error_details: { message: "This payment method is blocked" },
      }),
    };

    const code = await frame(["transfers", "confirm", "tr_1"]);

    expect(code).toBe(1);
    expect(stderr).toContain("merchant_blocklist: This payment method is blocked (HTTP 422)");
  });
});

function transferIn(status: string, fields: Record<string, unknown> = {}): StubResponse {
  return { status: 200, body: JSON.stringify({ id: "tr_1", status, ...fields }) };
}

describe("--wait", () => {
  it("creates, then retrieves until the transfer reaches a terminal status", async () => {
    const settled = transferIn("completed", { payment: { status: "succeeded" } });
    queuedResponses = [transferIn("pending"), transferIn("pending"), settled];

    const code = await frame([
      "transfers",
      "create",
      "--amount.value",
      "2500",
      "--wait",
      "--interval",
      "10ms",
      "--json",
    ]);

    expect(code).toBe(0);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST /v2/transfers",
      "GET /v2/transfers/tr_1",
      "GET /v2/transfers/tr_1",
    ]);
    expect(stdout).toBe(settled.body);
  });

  it("returns a failed transfer with its failure code", async () => {
    queuedResponses = [transferIn("pending"), transferIn("failed", { failure_code: "R01" })];

    const code = await frame(["transfers", "create", "--wait", "--interval", "10ms"]);

    expect(code).toBe(0);
    expect(stdout).toMatch(/tr_1\s+failed\s+-\s+R01/);
  });

  it("reports polling progress on stderr only", async () => {
    queuedResponses = [transferIn("pending"), transferIn("processing"), transferIn("completed")];

    await frame(["transfers", "create", "--wait", "--interval", "10ms", "--json"]);

    expect(stderr).toContain("tr_1: pending");
    expect(stderr).toContain("tr_1: processing");
    expect(stderr).toContain("tr_1: completed");
    expect(stdout).not.toContain("pending");
  });

  it("exits 3 naming the last observed status when the timeout elapses", async () => {
    nextResponse = transferIn("processing");

    const code = await frame([
      "transfers",
      "create",
      "--wait",
      "--interval",
      "10ms",
      "--timeout",
      "50ms",
      "--json",
    ]);

    expect(code).toBe(3);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/Timed out.*tr_1.*last status: processing/);
  });

  it("exits 3 at the timeout while a retrieve is still in flight", async () => {
    queuedResponses = [transferIn("processing"), { ...transferIn("completed"), delayMs: 2000 }];
    const startedAt = performance.now();

    const code = await frame([
      "transfers",
      "create",
      "--wait",
      "--interval",
      "10ms",
      "--timeout",
      "200ms",
    ]);

    expect(code).toBe(3);
    expect(performance.now() - startedAt).toBeLessThan(1000);
    expect(stderr).toMatch(/last status: processing/);
  });

  it("spaces retrieves by --interval", async () => {
    queuedResponses = [transferIn("pending"), transferIn("pending"), transferIn("completed")];

    await frame(["transfers", "create", "--wait", "--interval", "100ms"]);

    const gaps = requests
      .slice(1)
      .map((request, index) => request.receivedAt - requests[index]!.receivedAt);
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(95);
  });

  it("defaults to a one second interval and a sixty second timeout", async () => {
    await frame(["transfers", "create", "--help"]);

    expect(stdout).toMatch(/--interval <duration>.*\(default: 1s\)/s);
    expect(stdout).toMatch(/--timeout <duration>.*\(default: 60s\)/s);
    expect(stdout).toMatch(/completed, failed, reversed, canceled/);
  });

  it("returns as soon as the create response is already terminal", async () => {
    nextResponse = transferIn("completed");

    expect(await frame(["transfers", "create", "--wait"])).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("does not poll without --wait", async () => {
    nextResponse = transferIn("pending");

    expect(await frame(["transfers", "create"])).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it("polls after a confirm", async () => {
    queuedResponses = [transferIn("processing"), transferIn("completed")];

    expect(await frame(["transfers", "confirm", "tr_1", "--wait", "--interval", "10ms"])).toBe(0);
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "POST /v2/transfers/tr_1/confirm",
      "GET /v2/transfers/tr_1",
    ]);
  });

  it("is not offered on operations that do not declare it", async () => {
    expect(await frame(["transfers", "refund", "tr_1", "--wait"])).toBe(2);
    expect(await frame(["accounts", "create", "--wait"])).toBe(2);
    expect(requests).toHaveLength(0);
  });

  it.each(["soon", "5", "1h", "-1s"])("exits 2 on the malformed duration %s", async (duration) => {
    expect(await frame(["transfers", "create", "--wait", "--timeout", duration])).toBe(2);
    expect(requests).toHaveLength(0);
  });
});

describe("refunds, webhooks, products and invoices", () => {
  beforeEach(() => {
    nextResponse = { status: 200, body: JSON.stringify({ id: "obj_1" }) };
  });

  it.each([
    [["refunds", "create", "--transfer", "tr_1"], "/v1/refunds"],
    [
      ["webhooks", "create", "transfer.completed", "--url", "https://x.test"],
      "/v1/webhook_endpoints",
    ],
    [["webhooks", "rotate-secret", "we_1"], "/v1/webhook_endpoints/we_1/rotate_secret"],
    [["products", "create", "--name", "Mug"], "/v1/products"],
    [["invoices", "create", "--account", "acct_1"], "/v1/invoices"],
    [["invoices", "issue", "inv_1"], "/v1/invoices/inv_1/issue"],
    [
      ["invoices", "create-line-item", "inv_1", "--product", "prod_1"],
      "/v1/invoices/inv_1/line_items",
    ],
  ])("frame %j POSTs to %s with an idempotency key", async (args, path) => {
    expect(await frame(args)).toBe(0);

    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.url).toBe(path);
    expect(requests[0]!.idempotencyKey).toMatch(UUID_V4);
  });

  it.each([
    [["refunds", "list", "--transfer", "tr_1"], "GET", "/v1/refunds?transfer=tr_1"],
    [["refunds", "retrieve", "re_1"], "GET", "/v1/refunds/re_1"],
    [["webhooks", "list"], "GET", "/v1/webhook_endpoints"],
    [["webhooks", "retrieve", "we_1"], "GET", "/v1/webhook_endpoints/we_1"],
    [["webhooks", "update", "we_1", "--status", "disabled"], "PATCH", "/v1/webhook_endpoints/we_1"],
    [["webhooks", "delete", "we_1"], "DELETE", "/v1/webhook_endpoints/we_1"],
    [["products", "list", "--active"], "GET", "/v1/products?active=true"],
    [["products", "retrieve", "prod_1"], "GET", "/v1/products/prod_1"],
    [["products", "update", "prod_1", "--default_price", "900"], "PATCH", "/v1/products/prod_1"],
    [["products", "delete", "prod_1"], "DELETE", "/v1/products/prod_1"],
    [["products", "search", "--name", "mug"], "GET", "/v1/products/search?name=mug"],
    [["invoices", "list", "--status", "draft"], "GET", "/v1/invoices?status=draft"],
    [["invoices", "retrieve", "inv_1"], "GET", "/v1/invoices/inv_1"],
    [["invoices", "update", "inv_1", "--memo", "Thanks"], "PATCH", "/v1/invoices/inv_1"],
    [["invoices", "list-line-items", "inv_1"], "GET", "/v1/invoices/inv_1/line_items"],
    [
      ["invoices", "retrieve-line-item", "inv_1", "li_1"],
      "GET",
      "/v1/invoices/inv_1/line_items/li_1",
    ],
    [
      ["invoices", "update-line-item", "inv_1", "li_1", "--quantity", "3"],
      "PATCH",
      "/v1/invoices/inv_1/line_items/li_1",
    ],
    [
      ["invoices", "delete-line-item", "inv_1", "li_1"],
      "DELETE",
      "/v1/invoices/inv_1/line_items/li_1",
    ],
  ])("frame %j sends %s %s", async (args, method, url) => {
    expect(await frame(args)).toBe(0);

    expect(requests[0]!.method).toBe(method);
    expect(requests[0]!.url).toBe(url);
  });

  it("creates a refund of part of a transfer", async () => {
    await frame([
      "refunds",
      "create",
      "--transfer",
      "tr_1",
      "--amount",
      "500",
      "--reason",
      "duplicate",
    ]);

    expect(JSON.parse(requests[0]!.body)).toEqual({
      transfer: "tr_1",
      amount: 500,
      reason: "duplicate",
    });
  });

  it("creates a webhook endpoint for the event codes named as arguments", async () => {
    await frame([
      "webhooks",
      "create",
      "transfer.completed",
      "refund.created",
      "--url",
      "https://example.com/hooks",
    ]);

    expect(JSON.parse(requests[0]!.body)).toEqual({
      url: "https://example.com/hooks",
      events: ["transfer.completed", "refund.created"],
    });
  });

  it("shows the new signing secret after rotate-secret", async () => {
    nextResponse = {
      status: 200,
      body: JSON.stringify({
        id: "we_1",
        url: "https://x.test",
        status: "enabled",
        secret: "whsec_new",
      }),
    };

    await frame(["webhooks", "rotate-secret", "we_1"]);

    expect(stdout).toMatch(/^ID\s+URL\s+STATUS\s+EVENTS\s+SECRET\n/);
    expect(stdout).toMatch(/we_1\s+https:\/\/x\.test\s+enabled\s+-\s+whsec_new/);
  });

  it("renders refunds with the refund columns", async () => {
    const refund = {
      id: "re_1",
      status: "pending",
      amount: 500,
      currency: "usd",
      transfer_id: "tr_1",
    };
    nextResponse = { status: 200, body: JSON.stringify({ data: [refund] }) };

    await frame(["refunds", "list"]);

    const [header, row] = stdout.trimEnd().split("\n");
    expect(header).toMatch(/^ID\s+STATUS\s+AMOUNT\s+CURRENCY\s+TRANSFER ID\s+REASON$/);
    expect(row).toMatch(/^re_1\s+pending\s+500\s+usd\s+tr_1\s+-$/);
  });

  it("renders products with the product columns", async () => {
    const product = {
      id: "prod_1",
      name: "Mug",
      active: true,
      default_price: 900,
      purchase_type: "one_time",
    };
    nextResponse = { status: 200, body: JSON.stringify({ data: [product] }) };

    await frame(["products", "search", "--name", "mug"]);

    expect(stdout).toMatch(
      /^ID\s+NAME\s+ACTIVE\s+DEFAULT PRICE\s+PURCHASE TYPE\s+RECURRING INTERVAL\n/
    );
    expect(stdout).toMatch(/prod_1\s+Mug\s+true\s+900\s+one_time\s+-/);
  });

  it("renders invoices with the invoice columns and line items with the line item columns", async () => {
    const invoice = {
      id: "inv_1",
      number: "INV-1",
      status: "draft",
      account_id: "acct_1",
      total: 900,
    };
    nextResponse = { status: 200, body: JSON.stringify(invoice) };
    await frame(["invoices", "retrieve", "inv_1"]);
    expect(stdout).toMatch(/^ID\s+NUMBER\s+STATUS\s+ACCOUNT ID\s+TOTAL\s+CURRENCY\s+DUE DATE\n/);
    expect(stdout).toMatch(/inv_1\s+INV-1\s+draft\s+acct_1\s+900/);

    stdout = "";
    const lineItem = {
      id: "li_1",
      product_id: "prod_1",
      description: "Mug",
      quantity: 2,
      unit_amount: 900,
      amount: 1800,
    };
    nextResponse = { status: 200, body: JSON.stringify({ data: [lineItem] }) };
    await frame(["invoices", "list-line-items", "inv_1"]);
    expect(stdout).toMatch(/^ID\s+PRODUCT ID\s+DESCRIPTION\s+QUANTITY\s+UNIT AMOUNT\s+AMOUNT\n/);
    expect(stdout).toMatch(/li_1\s+prod_1\s+Mug\s+2\s+900\s+1800/);
  });

  it("writes the raw body with --json", async () => {
    const body = '{"id": "inv_1",  "status": "outstanding"}';
    nextResponse = { status: 200, body };

    await frame(["invoices", "issue", "inv_1", "--json"]);

    expect(stdout).toBe(body);
  });

  it("sends no idempotency key on updates and deletes", async () => {
    await frame(["products", "update", "prod_1", "--name", "Cup"]);
    await frame(["webhooks", "delete", "we_1"]);

    expect(requests.map((request) => request.idempotencyKey)).toEqual([undefined, undefined]);
  });
});

describe("frame --help", () => {
  it("lists every canonical resource with its description from the spec", async () => {
    const code = await frame(["--help"]);

    expect(code).toBe(0);
    for (const [command, description] of [
      ["transfers", "Core Transfers — money movement in either direction"],
      ["payment-methods", "PaymentMethods — cards and bank accounts"],
      ["accounts", "Accounts — the parties a merchant transacts with"],
      ["capabilities", "Capabilities — permissions an Account requests"],
      ["refunds", "Refunds — reversals of completed inbound Core Transfers"],
      ["webhooks", "Webhooks — endpoints that receive your events"],
      ["products", "Products — goods and services you bill for"],
      ["invoices", "Invoices — bills sent to an Account, with their line items"],
    ]) {
      expect(stdout).toMatch(new RegExp(`^\\s+${command}\\s+.*${description}`, "m"));
    }
    expect(stdout).not.toMatch(/^\s+customers/m);
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
