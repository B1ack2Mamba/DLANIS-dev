// lib/crypto.ts
// Простая обёртка над WebCrypto: AES-GCM с паролем (PBKDF2 -> AES key).
// Формат шифротекста: [12 байт IV][cipher...]; tag встроен в cipher.

export async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Возвращает Uint8Array: [IV(12)][cipher...]
export async function aesGcmEncrypt(plain: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = iv; // достаточно для demo; можешь вынести отдельную соль
  const key = await deriveAesKey(passphrase, salt);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

export async function aesGcmDecrypt(blob: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (blob.length < 12) throw new Error("Bad payload");
  const iv = blob.slice(0, 12);
  const cipher = blob.slice(12);
  const key = await deriveAesKey(passphrase, iv);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new Uint8Array(plain);
}

export const utf8 = {
  enc: (s: string) => new TextEncoder().encode(s),
  dec: (b: Uint8Array) => new TextDecoder().decode(b),
};

// Сервис: оценка оверхеда AES-GCM (IV=12 + tag≈16)
export const AES_OVERHEAD_BYTES = 12 + 16;
