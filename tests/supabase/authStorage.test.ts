import { describe, it, expect, vi, beforeEach } from "vitest";

// The module keeps its state, so each test loads a fresh copy
async function load() {
  vi.resetModules();
  return import("../../src/supabase/authStorage");
}

function backend(initial: Buffer | null, encrypted = true) {
  let file: Buffer | null = initial;
  const b = {
    read: vi.fn(async () => file),
    write: vi.fn(async (data: Buffer) => {
      file = data;
    }),
    remove: vi.fn(async () => {
      file = null;
    }),
    encrypt: encrypted ? (t: string) => Buffer.from(`enc:${t}`) : null,
    decrypt: encrypted
      ? (d: Buffer) => {
          const s = d.toString();
          if (!s.startsWith("enc:")) throw new Error("not ours");
          return s.slice(4);
        }
      : null,
  };
  return { b, file: () => file };
}

describe("authStorage", () => {
  beforeEach(() => vi.useRealTimers());

  it("waits for init before answering (the client reads at import time)", async () => {
    const { authStorage, initAuthStorage } = await load();
    const pending = authStorage.getItem("sb-token");
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    const { b } = backend(Buffer.from('enc:{"sb-token":"abc"}'));
    await initAuthStorage(b);
    expect(await pending).toBe("abc");
  });

  it("stores the session encrypted and removes the file when it is cleared", async () => {
    const { authStorage, initAuthStorage } = await load();
    const env = backend(null);
    await initAuthStorage(env.b);
    await authStorage.setItem("sb-token", "secret-refresh-token");
    expect(env.file()?.toString()).toBe('enc:{"sb-token":"secret-refresh-token"}');
    await authStorage.removeItem("sb-token");
    expect(env.file()).toBeNull();
    expect(env.b.remove).toHaveBeenCalled();
  });

  it("writes plain JSON only when the OS has no encryption", async () => {
    const { authStorage, initAuthStorage } = await load();
    const env = backend(null, false);
    await initAuthStorage(env.b);
    await authStorage.setItem("k", "v");
    expect(env.file()?.toString()).toBe('{"k":"v"}');
  });

  it("starts signed out when the file can't be read or decrypted", async () => {
    const { authStorage, initAuthStorage } = await load();
    await initAuthStorage(backend(Buffer.from("garbage")).b);
    expect(await authStorage.getItem("sb-token")).toBeNull();
  });

  it("keeps the latest value when writes overlap", async () => {
    const { authStorage, initAuthStorage } = await load();
    const env = backend(null);
    await initAuthStorage(env.b);
    await Promise.all([authStorage.setItem("k", "1"), authStorage.setItem("k", "2")]);
    expect(env.file()?.toString()).toBe('enc:{"k":"2"}');
  });
});
