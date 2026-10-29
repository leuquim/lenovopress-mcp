import { existsSync } from "node:fs";
import path from "node:path";
export const PRESS_ORIGIN = "https://lenovopress.lenovo.com";
export const MAX_RESULT_BYTES = 1_500_000;
export const MAX_SECTION_BYTES = 80_000;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 25;
export const DEFAULT_OSIG_LIMIT = 50;
export const MAX_OSIG_LIMIT = 100;
export const DEFAULT_RATE_LIMIT_MS = 60_000;
export function getRuntimeConfig(env = process.env) {
    const projectRoot = resolveProjectRoot(env);
    const timeout = parsePositiveInt(env.PRESS_REQUEST_TIMEOUT_MS, 30_000);
    const rateLimitMs = parseNonNegativeInt(env.PRESS_RATE_LIMIT_MS, DEFAULT_RATE_LIMIT_MS);
    const fixtureDir = env.PRESS_FIXTURE_DIR
        ? path.resolve(env.PRESS_FIXTURE_DIR)
        : existsSync(path.join(projectRoot, "fixtures", "http"))
            ? path.join(projectRoot, "fixtures")
            : null;
    return {
        projectRoot,
        cacheDir: path.resolve(env.PRESS_CACHE_DIR ?? path.join(projectRoot, ".cache")),
        fixtureDir,
        rateLimitMs,
        requestTimeoutMs: timeout,
        offline: env.PRESS_OFFLINE === "1" || env.PRESS_OFFLINE === "true",
    };
}
function resolveProjectRoot(env) {
    const candidates = [
        env.PRESS_MCP_ROOT,
        path.resolve(import.meta.dirname, ".."),
        process.cwd(),
    ].filter((value) => Boolean(value));
    return candidates.find((candidate) => existsSync(path.join(candidate, "package.json"))
        && existsSync(path.join(candidate, "src"))) ?? process.cwd();
}
function parsePositiveInt(raw, fallback) {
    const value = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
function parseNonNegativeInt(raw, fallback) {
    const value = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
//# sourceMappingURL=config.js.map