/**
 * GitHub App JWT creation using WebCrypto (Workers-compatible, no Node deps).
 * GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY") PEM keys; WebCrypto only
 * imports PKCS#8, so PKCS#1 keys are wrapped in a PKCS#8 envelope here.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function pemBody(pem: string, label: string): Uint8Array | undefined {
  const match = pem.match(
    new RegExp(`-----BEGIN ${label}-----([A-Za-z0-9+/=\\s]+)-----END ${label}-----`),
  );
  if (!match?.[1]) return undefined;
  const raw = atob(match[1].replace(/\s+/g, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** DER length encoding. */
function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap a PKCS#1 RSAPrivateKey DER structure in a PKCS#8 PrivateKeyInfo. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  // AlgorithmIdentifier: SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
  const algorithmIdentifier = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const version = [0x02, 0x01, 0x00];
  const octetString = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const contentLength = version.length + algorithmIdentifier.length + octetString.length;
  return new Uint8Array([
    0x30,
    ...derLength(contentLength),
    ...version,
    ...algorithmIdentifier,
    ...octetString,
  ]);
}

export async function importGitHubAppKey(pem: string): Promise<CryptoKey> {
  const pkcs8 = pemBody(pem, 'PRIVATE KEY');
  const pkcs1 = pemBody(pem, 'RSA PRIVATE KEY');
  const keyData = pkcs8 ?? (pkcs1 ? pkcs1ToPkcs8(pkcs1) : undefined);
  if (!keyData) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is not a valid PEM private key.');
  }
  return crypto.subtle.importKey(
    'pkcs8',
    keyData.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * Create a short-lived GitHub App JWT (RS256). Used only to list
 * installations and mint installation access tokens.
 */
export async function createAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const key = await importGitHubAppKey(privateKeyPem);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        // 60s clock-drift allowance; max GitHub-permitted lifetime is 10 minutes.
        iat: nowSeconds - 60,
        exp: nowSeconds + 9 * 60,
        iss: appId,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}
