#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { PressClient } from "./client.js";
import { getRuntimeConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { createPressServer } from "./server.js";
const config = getRuntimeConfig();
const client = new PressClient(config);
const handle = serveStdio(() => createPressServer(client), {
    onerror: (error) => process.stderr.write(`[lenovo-press-mcp] MCP transport error: ${error.message}\n`),
});
let shuttingDown = false;
async function shutdown() {
    if (shuttingDown)
        return;
    shuttingDown = true;
    await handle.close().catch(() => undefined);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
process.once("uncaughtException", (error) => {
    process.stderr.write(`[lenovo-press-mcp] ${errorMessage(error)}\n`);
});
//# sourceMappingURL=index.js.map