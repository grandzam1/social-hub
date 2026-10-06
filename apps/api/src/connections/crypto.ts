const IV_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

let imported: { masterKey: string; key: CryptoKey } | null = null;

async function importMasterKey(masterKey: string): Promise<CryptoKey> {
  const trimmed = masterKey.trim();
  if (imported?.masterKey === trimmed) return imported.key;
  const raw = base64ToBytes(trimmed);
  if (raw.byteLength !== 32) {
    throw new Error("MASTER_KEY must be 32 bytes, base64-encoded");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  imported = { masterKey: trimmed, key };
  return key;
}

/** Random 12-byte IV, then AES-GCM ciphertext (tag included), as one base64 string. */
export async function encryptValue(
  masterKey: string,
  plaintext: string,
): Promise<string> {
  const key = await importMasterKey(masterKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const packed = new Uint8Array(iv.byteLength + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(cipher, iv.byteLength);
  return bytesToBase64(packed);
}

export async function decryptValue(
  masterKey: string,
  stored: string,
): Promise<string> {
  const key = await importMasterKey(masterKey);
  const packed = base64ToBytes(stored);
  if (packed.byteLength <= IV_BYTES) {
    throw new Error("Stored connection value is not encrypted");
  }
  const iv = copyBytes(packed.subarray(0, IV_BYTES));
  const cipher = copyBytes(packed.subarray(IV_BYTES));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Could not decrypt connection value");
  }
}

/** Short preview such as sk-...4f2a. Never the full value. */
export function maskPreview(value: string): string {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

/** Token preview such as vault_...a1b2. */
export function maskToken(token: string): string {
  return `vault_...${token.slice(-4)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
