import { pathToFileURL } from "node:url";

const IMAGE_PATTERN = /^(ghcr\.io)\/([^@]+)@(sha256:[a-f0-9]{64})$/;

export async function verifyPublicImage(image, fetchImpl = fetch) {
  const match = IMAGE_PATTERN.exec(image);
  if (!match) {
    throw new Error("image must be a digest-pinned ghcr.io reference");
  }

  const [, registry, repository, digest] = match;
  const tokenURL = new URL(`https://${registry}/token`);
  tokenURL.searchParams.set("service", registry);
  tokenURL.searchParams.set("scope", `repository:${repository}:pull`);

  // Deliberately omit GitHub credentials. This verifies the contract Ranch Hand
  // and other clone-free consumers rely on: a clean host can pull the image.
  const tokenResponse = await fetchImpl(tokenURL, {
    headers: { Accept: "application/json" },
  });
  if (!tokenResponse.ok) {
    throw new Error(`anonymous registry token request failed with HTTP ${tokenResponse.status}`);
  }

  const payload = await tokenResponse.json();
  const token = payload.token ?? payload.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("anonymous registry token response did not contain a token");
  }

  const manifestResponse = await fetchImpl(
    `https://${registry}/v2/${repository}/manifests/${digest}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          "application/vnd.oci.image.index.v1+json",
          "application/vnd.docker.distribution.manifest.list.v2+json",
          "application/vnd.oci.image.manifest.v1+json",
          "application/vnd.docker.distribution.manifest.v2+json",
        ].join(", "),
      },
    },
  );
  if (!manifestResponse.ok) {
    throw new Error(
      `image is not anonymously pullable: registry returned HTTP ${manifestResponse.status}`,
    );
  }

  await manifestResponse.body?.cancel();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const image = process.argv[2];
  if (!image) {
    console.error("Usage: node verify-public-image.mjs <ghcr.io/image@sha256:digest>");
    process.exitCode = 2;
  } else {
    verifyPublicImage(image)
      .then(() => console.log(`Verified anonymous pull access for ${image}`))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
