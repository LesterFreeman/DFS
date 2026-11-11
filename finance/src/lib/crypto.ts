// Passcode encryption with the browser's built-in WebCrypto: PBKDF2-SHA256 stretches the passcode
// into an AES-256-GCM key. The passcode is never stored; without it the data cannot be read.

const ITERATIONS = 600_000;

export interface Sealed {
  enc: true;
  salt: string;
  iv: string;
  ct: string;
  iter: number;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export interface Key {
  key: CryptoKey;
  salt: string;
  iter: number;
}

export async function deriveKey(passcode: string, salt?: string, iter = ITERATIONS): Promise<Key> {
  const saltBytes = salt ? unb64(salt) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, salt: b64(saltBytes), iter };
}

export async function seal(value: unknown, k: Key): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k.key, new TextEncoder().encode(JSON.stringify(value)));
  return { enc: true, salt: k.salt, iv: b64(iv), ct: b64(ct), iter: k.iter };
}

/** Throws when the passcode is wrong (or the data was tampered with). */
export async function open<T>(sealed: Sealed, k: Key): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, k.key, unb64(sealed.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

export async function openWithPasscode<T>(sealed: Sealed, passcode: string): Promise<{ value: T; key: Key }> {
  const key = await deriveKey(passcode, sealed.salt, sealed.iter);
  return { value: await open<T>(sealed, key), key };
}
