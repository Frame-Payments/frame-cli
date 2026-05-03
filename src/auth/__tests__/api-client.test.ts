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
    headers: new Headers({ "content-type": "application/json" }),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Mimics a real fetch Response whose body is not JSON (e.g. an HTML error
 * page from a misrouted request). `.json()` rejects the same way undici does.
 */
function makeNonJsonResponse(
  body: string,
  status: number,
  contentType = "text/html; charset=utf-8",
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    text: () => Promise.resolve(body),
    json: () =>
      Promise.reject(
        new SyntaxError(`Unexpected token '<', "${body.slice(0, 10)}"... is not valid JSON`),
      ),
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

// ---------------------------------------------------------------------------
// Non-JSON responses (e.g. misconfigured base URL hits a Rails HTML error page)
// ---------------------------------------------------------------------------

describe("non-JSON responses", () => {
  it("throws ApiError (not SyntaxError) when server returns an HTML error page", async () => {
    fetchMock.mockResolvedValueOnce(
      makeNonJsonResponse(
        "<!DOCTYPE html><html><body>Routing Error</body></html>",
        404,
      ),
    );
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    await expect(client.get("/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("includes the request URL in the ApiError message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeNonJsonResponse(
        "<!DOCTYPE html><html><body>Routing Error</body></html>",
        404,
      ),
    );
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    let caught: ApiError | undefined;
    try {
      await client.get("/me");
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught?.message).toContain("https://api.frame.dev/me");
  });

  it("includes a snippet of the response body in the ApiError message", async () => {
    fetchMock.mockResolvedValueOnce(
      makeNonJsonResponse(
        "<!DOCTYPE html><html><body>Routing Error: action_controller</body></html>",
        404,
      ),
    );
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    let caught: ApiError | undefined;
    try {
      await client.get("/me");
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught?.message).toContain("Routing Error");
  });

  it("truncates large response bodies in the ApiError message", async () => {
    const huge = "x".repeat(5000);
    fetchMock.mockResolvedValueOnce(makeNonJsonResponse(huge, 500));
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    let caught: ApiError | undefined;
    try {
      await client.get("/me");
    } catch (e) {
      caught = e as ApiError;
    }
    // Whole message stays bounded — body snippet must not exceed ~200 chars.
    expect(caught?.message.length).toBeLessThan(400);
  });

  it("throws ApiError on a 2xx response with a non-JSON body (e.g. proxy/captive portal)", async () => {
    fetchMock.mockResolvedValueOnce(
      makeNonJsonResponse(
        "<html><body>Please sign in to your network</body></html>",
        200,
      ),
    );
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    await expect(client.get("/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("returns undefined for a 2xx response with an empty body (204-style)", async () => {
    fetchMock.mockResolvedValueOnce(makeNonJsonResponse("", 204));
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    const result = await client.delete("/widgets/abc");
    expect(result).toBeUndefined();
  });

  it("surfaces the HTTP status on the ApiError", async () => {
    fetchMock.mockResolvedValueOnce(
      makeNonJsonResponse(
        "<!DOCTYPE html><html><body>Routing Error</body></html>",
        404,
      ),
    );
    const client = createApiClient({
      apiKey: "sk_test_xyz",
      baseUrl: "https://api.frame.dev",
    });
    let caught: ApiError | undefined;
    try {
      await client.get("/me");
    } catch (e) {
      caught = e as ApiError;
    }
    expect(caught?.status).toBe(404);
    expect(caught?.message).toContain("404");
  });
});
