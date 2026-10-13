// A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Browser {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
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
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
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
    const port = await waitFor(() => readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0], 15_000);
    const targets = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((t: { type: string }) => t.type === "page");
    }, 15_000);

    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("Could not connect to Chrome."));
    });
    let nextId = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    ws.onmessage = (message) => {
      const msg = JSON.parse(String(message.data));
      const waiter = msg.id !== undefined ? pending.get(msg.id) : undefined;
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else waiter.resolve(msg.result);
    };

    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    return {
      send,
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

/** Retries `fn` until it returns a value or the timeout passes. */
export async function waitFor<T>(fn: () => T | Promise<T>, timeoutMs: number, intervalMs = 50): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
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
