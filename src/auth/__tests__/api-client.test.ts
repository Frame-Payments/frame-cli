/**
 * Tests for auth/api-client.
 *
 * fetch is mocked via vi.stubGlobal so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiClient, ApiError, type ApiClient } from "../api-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  body: unknown,
  status = 200,
  ok = true,
): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// createApiClient
// ---------------------------------------------------------------------------

describe("createApiClient", () => {
  it("injects Authorization header", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ id: "acct_1", name: "Test" }));
    const client: ApiClient = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    await client.get("/me");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk_test_xyz",
    );
  });

  it("injects X-Frame-API-Version header", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ id: "acct_1", name: "Test" }));
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    await client.get("/me");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>)["X-Frame-API-Version"],
    ).toBeDefined();
  });

  it("prepends baseUrl to path", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ id: "acct_1" }));
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    await client.get("/me");
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.frame.dev/me");
  });

  it("returns parsed JSON on success", async () => {
    const body = { id: "acct_1", name: "Merchant One" };
    fetchMock.mockResolvedValueOnce(makeResponse(body));
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    const result = await client.get("/me");
    expect(result).toEqual(body);
  });
});

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

describe("ApiError", () => {
  it("throws ApiError on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: { message: "Unauthorized" } }, 401, false),
    );
    const client = createApiClient({
      apiKey: "sk_test_bad",
      baseUrl: "https://api.frame.dev",
    });
    await expect(client.get("/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("ApiError exposes status and message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ error: { message: "Unauthorized" } }, 401, false),
    );
    const client = createApiClient({
      apiKey: "sk_test_bad",
      baseUrl: "https://api.frame.dev",
    });
    let caught: ApiError | undefined;
    try {
      await client.get("/me");
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught?.status).toBe(401);
    expect(caught?.message).toContain("Unauthorized");
  });

  it("ApiError falls back to HTTP status text when body has no error field", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ something: "else" }, 500, false),
    );
    const client = createApiClient({
      apiKey: "sk_test_bad",
      baseUrl: "https://api.frame.dev",
    });
    await expect(client.get("/me")).rejects.toBeInstanceOf(ApiError);
  });
});
