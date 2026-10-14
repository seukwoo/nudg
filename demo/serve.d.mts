import type { Server } from "node:http";

/** Starts the examples server on `port` (0 picks a free one); resolves once it's listening. */
export function serve(port?: number, host?: string): Promise<Server>;
