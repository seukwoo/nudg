// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** How long one protocol call may take. Screenshots of a big page take a second; anything longer is a hang. */
const CALL_TIMEOUT_MS = 30_000;

export interface Browser {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Subscribes to a protocol event, e.g. "Runtime.exceptionThrown" (enable its domain first). */
  on(method: string, handler: (params: any) => void): void;
  /** Evaluates an expression in the page and returns its value. */
  evaluate(expression: string): Promise<any>;
  close(): Promise<void>;
}

export async function launchBrowser(chrome: string): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), "nudg-chrome-"));
  const child = spawn(
    chrome,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  // Wait for Chrome to exit before removing its profile; it writes until it's gone.
  let resolveExited!: () => void;
  const exited = new Promise<void>((resolve) => (resolveExited = resolve));
  child.once("exit", () => resolveExited());
  // A missing or unrunnable executable is an asynchronous 'error', which would otherwise crash
  // the process. It also never exits, and the polls below must stop at once.
  const gone = new AbortController();
  const failed = new Promise<never>((_, reject) =>
    child.once("error", (e) => {
      resolveExited();
      gone.abort();
      reject(new Error(`Could not start Chrome at ${chrome}: ${e.message}`));
    }),
  );
  failed.catch(() => {});
  const cleanup = async () => {
    child.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // A leftover temp profile is harmless.
    }
  };

  try {
    const port = await Promise.race([failed, waitFor(() => readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0], 15_000, 50, gone.signal)]);
    const targets = await Promise.race([
      failed,
      waitFor(
        async () => {
          const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          return list.find((t: { type: string }) => t.type === "page");
        },
        15_000,
        50,
        gone.signal,
      ),
    ]);

    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("Could not connect to Chrome."));
    });
    let nextId = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const listeners = new Map<string, ((params: any) => void)[]>();
    ws.onmessage = (message) => {
      const msg = JSON.parse(String(message.data));
      if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
      const waiter = msg.id !== undefined ? pending.get(msg.id) : undefined;
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else waiter.resolve(msg.result);
    };

    // A call that never answers would hang a test run for hours; fail it instead.
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`Chrome did not answer ${method} within ${CALL_TIMEOUT_MS / 1000} s.`));
        }, CALL_TIMEOUT_MS);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });

    return {
      send,
      on(method, handler) {
        listeners.set(method, [...(listeners.get(method) ?? []), handler]);
      },
      async evaluate(expression) {
        const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Evaluation failed.");
        return result.result.value;
      },
      async close() {
        ws.close();
        await cleanup();
      },
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Retries `fn` until it returns a value or the timeout passes; an aborted `signal` stops it early. */
export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs: number, intervalMs = 50, signal?: AbortSignal): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline && !signal?.aborted) {
    try {
      const value = await fn();
      if (value !== undefined && value !== null && value !== "") return value as NonNullable<T>;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs} ms${lastError ? `: ${(lastError as Error).message}` : ""}.`);
}
