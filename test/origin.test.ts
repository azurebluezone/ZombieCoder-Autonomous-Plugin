import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { originHandshakeUrl, fetchOriginHandshake, normalizeBaseUrl } from "../src/zombie/origin.ts";

function startOrigin(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ base: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
    server.on("error", reject);
  });
}

test("originHandshakeUrl normalizes base, /v1 and explicit path", () => {
  assert.equal(originHandshakeUrl("https://gpu.example"), "https://gpu.example/gateway_url.json");
  assert.equal(originHandshakeUrl("https://gpu.example/v1"), "https://gpu.example/gateway_url.json");
  assert.equal(
    originHandshakeUrl("https://gpu.example/prefix/v1/"),
    "https://gpu.example/prefix/gateway_url.json",
  );
  assert.equal(
    originHandshakeUrl("https://gpu.example/gateway_url.json"),
    "https://gpu.example/gateway_url.json",
  );
  assert.equal(originHandshakeUrl("http://127.0.0.1:8000/v1"), "http://127.0.0.1:8000/gateway_url.json");
  assert.equal(originHandshakeUrl("http://gpu.example"), null);
  assert.equal(originHandshakeUrl("ftp://gpu.example"), null);
  assert.equal(originHandshakeUrl(""), null);
});

test("normalizeBaseUrl accepts only http(s) and strips the trailing slash", () => {
  assert.equal(normalizeBaseUrl("https://gpu.example/v1/"), "https://gpu.example/v1");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:8000/v1"), "http://127.0.0.1:8000/v1");
  assert.equal(normalizeBaseUrl("file:///etc/passwd"), null);
  assert.equal(normalizeBaseUrl("not a url"), null);
  assert.equal(normalizeBaseUrl(undefined), null);
});

test("fetchOriginHandshake reads base_url without sending the API key", async () => {
  let seenAuthorization: string | undefined;
  let seenCookie: string | undefined;
  const origin = await startOrigin((req, res) => {
    seenAuthorization = req.headers.authorization;
    seenCookie = req.headers.cookie;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        base_url: "https://gpu.example/v1",
        hostname: "gpu.example",
        auth_required: true,
      }),
    );
  });
  try {
    const result = await fetchOriginHandshake(`${origin.base}/v1`);
    assert.equal(result.ok, true);
    assert.equal(result.baseUrl, "https://gpu.example/v1");
    assert.equal(result.hostname, "gpu.example");
    assert.equal(result.authRequired, true);
    assert.equal(seenAuthorization, undefined, "handshake must not send Authorization");
    assert.equal(seenCookie, undefined, "handshake must not send cookies");
  } finally {
    await origin.close();
  }
});

test("fetchOriginHandshake refuses a redirect", async () => {
  const origin = await startOrigin((_req, res) => {
    res.writeHead(302, { location: "https://evil.example/gateway_url.json" });
    res.end();
  });
  try {
    const result = await fetchOriginHandshake(`${origin.base}/v1`);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /redirect refused/);
  } finally {
    await origin.close();
  }
});

test("fetchOriginHandshake reports a missing base_url", async () => {
  const origin = await startOrigin((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ hostname: "gpu.example" }));
  });
  try {
    const result = await fetchOriginHandshake(`${origin.base}/v1`);
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /base_url/);
  } finally {
    await origin.close();
  }
});
