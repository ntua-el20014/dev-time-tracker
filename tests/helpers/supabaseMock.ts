/**
 * Supabase Mock Helper
 *
 * Creates a chainable mock that replicates the Supabase PostgREST query builder.
 * Every method returns `this` so chains like:
 *   supabase.from("table").select("*").eq("col", v).single()
 * resolve to configurable { data, error } results.
 *
 * Usage in tests:
 *   import { createMockSupabase, mockResult } from "./supabaseMock";
 *   vi.mock("../../src/supabase/config", () => ({ supabase: createMockSupabase() }));
 *
 *   // Configure per-call result:
 *   mockResult({ data: [...], error: null });
 *
 *   // Or per-table result:
 *   mockTableResult("time_tracking_sessions", { data: {...}, error: null });
 */
import { vi } from "vitest";

// ---------- Result stack ----------
// Tests push results here; the mock pops them in FIFO order.
let resultQueue: Array<{ data: any; error: any }> = [];
const tableResultMap: Map<string, { data: any; error: any }> = new Map();
const rpcResultMap: Map<string, { data: any; error: any }> = new Map();

let lastCalledTable: string | null = null;
let lastCalledRpc: string | null = null;
// Track the chain calls for assertions
let callLog: Array<{ method: string; args: any[] }> = [];

/** Push a result that the next query chain will resolve to. */
export function mockResult(result: {
  data: any;
  error: any;
  [key: string]: any;
}) {
  resultQueue.push(result);
}

/** Push multiple results to be consumed in order. */
export function mockResults(
  results: Array<{ data: any; error: any; [key: string]: any }>,
) {
  resultQueue.push(...results);
}

/** Set a default result for a specific table. */
export function mockTableResult(
  table: string,
  result: { data: any; error: any },
) {
  tableResultMap.set(table, result);
}

/** Set a result for a specific RPC function. */
export function mockRpcResult(
  fnName: string,
  result: { data: any; error: any },
) {
  rpcResultMap.set(fnName, result);
}

/** Get the call log for assertions. */
export function getCallLog() {
  return [...callLog];
}

/** Get calls filtered by method name. */
export function getCallsFor(method: string) {
  return callLog.filter((c) => c.method === method);
}

/** Reset all mock state between tests. */
export function resetMockState() {
  resultQueue = [];
  tableResultMap.clear();
  rpcResultMap.clear();
  lastCalledTable = null;
  lastCalledRpc = null;
  callLog = [];
}

// ---------- Resolve result ----------
function resolveResult(): { data: any; error: any } {
  // 1. If there's a queued result, pop it.
  if (resultQueue.length > 0) {
    return resultQueue.shift()!;
  }
  // 2. If there's a table-specific default, use it.
  if (lastCalledTable && tableResultMap.has(lastCalledTable)) {
    return tableResultMap.get(lastCalledTable)!;
  }
  // 3. Fallback.
  return { data: null, error: null };
}

function resolveRpcResult(fnName: string): { data: any; error: any } {
  if (resultQueue.length > 0) {
    return resultQueue.shift()!;
  }
  if (rpcResultMap.has(fnName)) {
    return rpcResultMap.get(fnName)!;
  }
  return { data: null, error: null };
}

// ---------- Query builder ----------
function createQueryBuilder(): any {
  const builder: any = {};

  // Terminal methods — return { data, error } (or thenable)
  const makeThenable = () => {
    const result = resolveResult();
    // Make it work both as a promise (await query) and as a direct value
    const thenable = {
      ...result,
      then: (resolve: any) => {
        return resolve ? resolve(result) : result;
      },
    };
    return thenable;
  };

  // Chain methods — every query-builder method returns the builder itself.
  const chainMethods = [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "like",
    "ilike",
    "is",
    "in",
    "not",
    "or",
    "and",
    "order",
    "limit",
    "range",
    "single",
    "maybeSingle",
    "filter",
    "match",
    "contains",
    "containedBy",
    "textSearch",
    "csv",
    "returns",
    "throwOnError",
    "abortSignal",
  ];

  for (const method of chainMethods) {
    builder[method] = vi.fn((...args: any[]) => {
      callLog.push({ method, args });
      return builder;
    });
  }

  // Make the builder itself thenable so `await supabase.from(...).select(...)` works.
  // Supabase PostgREST ALWAYS resolves — errors are in the {data, error} object.
  builder.then = (resolve: any) => {
    const result = resolveResult();
    return resolve ? resolve(result) : result;
  };

  return builder;
}

// ---------- Auth mock ----------
function createAuthMock() {
  return {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: "test-user-id", email: "test@example.com" } },
      error: null,
    }),
    getSession: vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "mock-token",
          user: { id: "test-user-id" },
        },
      },
      error: null,
    }),
    signInWithPassword: vi.fn().mockResolvedValue({
      data: { user: { id: "test-user-id" }, session: {} },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
  };
}

// ---------- Main mock creator ----------
export function createMockSupabase() {
  return {
    from: vi.fn((table: string) => {
      lastCalledTable = table;
      callLog.push({ method: "from", args: [table] });
      return createQueryBuilder();
    }),
    rpc: vi.fn((fnName: string, params?: any) => {
      lastCalledRpc = fnName;
      callLog.push({ method: "rpc", args: [fnName, params] });
      const result = resolveRpcResult(fnName);
      return {
        ...result,
        then: (resolve: any) => {
          return resolve ? resolve(result) : result;
        },
      };
    }),
    auth: createAuthMock(),
  };
}

/** Pre-created singleton – use in vi.mock async factories via dynamic import. */
export const mockSupabase = createMockSupabase();
