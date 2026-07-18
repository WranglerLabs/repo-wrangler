import assert from "node:assert/strict";
import test from "node:test";
import { verifyPublicImage } from "./verify-public-image.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const image = `ghcr.io/wranglerlabs/repo-wrangler-server@${digest}`;

test("verifies the manifest with an anonymously acquired registry token", async () => {
  const requests = [];
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ token: "anonymous-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  };

  await verifyPublicImage(image, fakeFetch);

  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /scope=repository%3Awranglerlabs%2Frepo-wrangler-server%3Apull/);
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[1].options.headers.Authorization, "Bearer anonymous-token");
  assert.match(requests[1].url, new RegExp(`/manifests/${digest}$`));
});

test("rejects a private image when the anonymous manifest request is denied", async () => {
  let request = 0;
  const fakeFetch = async () => {
    request += 1;
    if (request === 1) {
      return new Response(JSON.stringify({ token: "anonymous-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("unauthorized", { status: 401 });
  };

  await assert.rejects(
    () => verifyPublicImage(image, fakeFetch),
    /not anonymously pullable.*HTTP 401/,
  );
});

test("rejects floating and non-GHCR image references", async () => {
  await assert.rejects(
    () => verifyPublicImage("ghcr.io/wranglerlabs/repo-wrangler-server:latest"),
    /digest-pinned ghcr.io reference/,
  );
});
