/**
 * Where the Supabase session (access + refresh token) is kept: a file in
 * userData, encrypted with the OS keychain (Electron safeStorage) when it is
 * available. Only the main process has a Supabase client, so this is the one
 * copy of the session; the renderer never sees the tokens.
 *
 * Every call waits for initAuthStorage(), which index.ts runs once the app
 * paths are final (DTT_USER_DATA_DIR) — the client starts reading at import.
 * File access and encryption are injected so this has no Electron import.
 */

export interface AuthStorageBackend {
  read(): Promise<Buffer | null>;
  write(data: Buffer): Promise<void>;
  remove(): Promise<void>;
  /** null when the OS offers no encryption (then the file is plain JSON) */
  encrypt: ((text: string) => Buffer) | null;
  decrypt: ((data: Buffer) => string) | null;
}

let backend: AuthStorageBackend | null = null;
let cache: Record<string, string> = {};
let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});
/** Writes run one after another, so an older write never lands last. */
let writing: Promise<void> = Promise.resolve();

function decode(data: Buffer): Record<string, string> {
  try {
    const text = backend?.decrypt
      ? backend.decrypt(data)
      : data.toString("utf-8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Unreadable (e.g. encrypted on another machine): start signed out
    return {};
  }
}

function persist() {
  const snapshot = JSON.stringify(cache);
  writing = writing.then(async () => {
    if (!backend) return;
    try {
      if (snapshot === "{}") await backend.remove();
      else {
        await backend.write(
          backend.encrypt
            ? backend.encrypt(snapshot)
            : Buffer.from(snapshot, "utf-8"),
        );
      }
    } catch {
      // Keep the in-memory session; the next change tries again
    }
  });
  return writing;
}

export async function initAuthStorage(b: AuthStorageBackend): Promise<void> {
  backend = b;
  const data = await b.read().catch(() => null);
  cache = data ? decode(data) : {};
  markReady();
}

/** The storage adapter given to the Supabase client. */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    await ready;
    return cache[key] ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await ready;
    cache[key] = value;
    await persist();
  },
  async removeItem(key: string): Promise<void> {
    await ready;
    delete cache[key];
    await persist();
  },
};
