// Browser-side card secret handling. The secret key never leaves this tab: we
// generate it here, hand Rain only its RSA-encrypted form, and decrypt the PAN
// and CVC locally. The server therefore never sees a plaintext card number.

const SANDBOX_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCAP192809jZyaw62g/eTzJ3P9H
+RmT88sXUYjQ0K8Bx+rJ83f22+9isKx+lo5UuV8tvOlKwvdDS/pVbzpG7D7NO45c
0zkLOXwDHZkou8fuj8xhDO5Tq3GzcrabNLRLVz3dkx0znfzGOhnY4lkOMIdKxlQb
LuVM/dGDC9UpulF+UwIDAQAB
-----END PUBLIC KEY-----`;

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const pairs = hex.match(/.{2}/g) ?? [];
  const bytes = new Uint8Array(pairs.length);
  pairs.forEach((pair, i) => (bytes[i] = parseInt(pair, 16)));
  return bytes;
}

// Rain expects the base64 of the raw secret bytes, RSA-OAEP encrypted with
// SHA-1 rather than the WebCrypto default of SHA-256.
export async function createSession(): Promise<{
  secretKey: string;
  sessionId: string;
}> {
  const secretKey = crypto.randomUUID().replace(/-/g, "");
  const pem = SANDBOX_PUBLIC_KEY.replace(/-----[A-Z ]+-----/g, "").replace(
    /\s/g,
    "",
  );
  const key = await crypto.subtle.importKey(
    "spki",
    fromBase64(pem),
    { name: "RSA-OAEP", hash: "SHA-1" },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    new TextEncoder().encode(toBase64(hexToBytes(secretKey))),
  );
  return { secretKey, sessionId: toBase64(new Uint8Array(encrypted)) };
}

export async function decrypt(
  field: { iv: string; data: string },
  secretKey: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(secretKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(field.iv) },
    key,
    fromBase64(field.data),
  );
  return new TextDecoder().decode(plain);
}
