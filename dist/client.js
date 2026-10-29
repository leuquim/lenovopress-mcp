import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRESS_ORIGIN } from "./config.js";
import { PressError } from "./errors.js";
export class PressClient {
    config;
    fetchImpl;
    lastNetworkAt = 0;
    memory = new Map();
    constructor(config, fetchImpl = fetch) {
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    async getText(urlPath) {
        return this.request("GET", urlPath);
    }
    async head(urlPath) {
        return this.request("HEAD", urlPath);
    }
    async postForm(urlPath, fields) {
        const body = new URLSearchParams(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)]))).toString();
        return this.request("POST", urlPath, body, "application/x-www-form-urlencoded");
    }
    async request(method, urlPath, body, contentType) {
        const url = urlPath.startsWith("http") ? urlPath : `${PRESS_ORIGIN}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
        const key = cacheKey(method, url, body);
        const cached = this.memory.get(key);
        if (cached)
            return cached;
        const fixture = await this.readFixture(method, url, body);
        if (fixture) {
            this.memory.set(key, fixture);
            return fixture;
        }
        const disk = await this.readCache(key);
        if (disk) {
            this.memory.set(key, disk);
            return disk;
        }
        if (this.config.offline) {
            throw new PressError("OFFLINE", `No fixture or cache for ${method} ${url}`);
        }
        await this.throttle();
        const fetched = await this.network(method, url, body, contentType);
        this.memory.set(key, fetched);
        await this.writeCache(key, fetched);
        return fetched;
    }
    async readFixture(method, url, body) {
        const fixtureDir = this.config.fixtureDir;
        if (!fixtureDir)
            return null;
        const relative = matchFixture(method, url, body);
        if (!relative)
            return null;
        const filePath = path.join(fixtureDir, relative);
        if (!existsSync(filePath))
            return null;
        if (relative.endsWith(".json") && !relative.includes("osig") && !relative.includes("search")) {
            const parsed = JSON.parse(await readFile(filePath, "utf8"));
            return { ...parsed, url, method, source: "fixture" };
        }
        if (relative.endsWith(".head.json")) {
            const parsed = JSON.parse(await readFile(filePath, "utf8"));
            return { ...parsed, url, method, body: parsed.body ?? "", source: "fixture" };
        }
        const raw = await readFile(filePath, "utf8");
        if (relative.endsWith(".json")) {
            return {
                url,
                method,
                status: 200,
                headers: { "content-type": "application/json" },
                body: raw,
                source: "fixture",
            };
        }
        return {
            url,
            method,
            status: 200,
            headers: { "content-type": "text/html; charset=UTF-8" },
            body: raw,
            source: "fixture",
        };
    }
    async readCache(key) {
        const filePath = path.join(this.config.cacheDir, `${key}.json`);
        if (!existsSync(filePath))
            return null;
        try {
            const parsed = JSON.parse(await readFile(filePath, "utf8"));
            return { ...parsed, source: "cache" };
        }
        catch {
            return null;
        }
    }
    async writeCache(key, fetched) {
        await mkdir(this.config.cacheDir, { recursive: true });
        const record = {
            url: fetched.url,
            method: fetched.method,
            status: fetched.status,
            headers: fetched.headers,
            body: fetched.body,
        };
        await writeFile(path.join(this.config.cacheDir, `${key}.json`), JSON.stringify(record), "utf8");
    }
    async throttle() {
        const wait = this.lastNetworkAt + this.config.rateLimitMs - Date.now();
        if (wait > 0)
            await new Promise((resolve) => setTimeout(resolve, wait));
        this.lastNetworkAt = Date.now();
    }
    async network(method, url, body, contentType) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
        try {
            const headers = {
                "user-agent": "lenovo-press-mcp/0.1 (public documentation retrieval)",
                accept: method === "POST" ? "application/json,text/javascript,*/*" : "*/*",
            };
            if (contentType)
                headers["content-type"] = contentType;
            const init = {
                method,
                headers,
                signal: controller.signal,
                redirect: "follow",
            };
            if (method === "POST" && body !== undefined)
                init.body = body;
            const response = await this.fetchImpl(url, init);
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });
            const text = method === "HEAD" ? "" : await response.text();
            if (response.status >= 400) {
                throw new PressError("HTTP_ERROR", `${method} ${url} returned ${response.status}`, { status: response.status });
            }
            return { url, method, status: response.status, headers: responseHeaders, body: text, source: "network" };
        }
        catch (error) {
            if (error instanceof PressError)
                throw error;
            throw new PressError("NETWORK", `Failed ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
export function matchFixture(method, url, body) {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const upper = method.toUpperCase();
    if ((upper === "GET" || upper === "HEAD") && (pathname === "/lp2264" || pathname === "/lp2264-thinksystem-sr680a-v4-server")) {
        return "html/lp2264.html";
    }
    if (upper === "HEAD" && pathname === "/lp2264.pdf")
        return "http/lp2264.pdf.head.json";
    if (upper === "POST" && pathname === "/press/search/jsonquery") {
        const fields = parseForm(body);
        const family = (fields.product_family ?? "").toLowerCase();
        const term = (fields.term ?? "").toLowerCase();
        if (family === "sr680a-v4-server")
            return "http/search-family-sr680a-v4-server.json";
        if (term === "lp2264")
            return "http/search-lp2264.json";
        if (term === "7dmkcto1ww")
            return "http/search-7dmkcto1ww.json";
        if (term === "c5qy")
            return "http/search-c5qy.json";
        if (term === "4xb7a93127")
            return "http/search-4xb7a93127.json";
        if (term === "b300")
            return "http/search-b300.json";
        if (term === "cx8")
            return "http/search-cx8.json";
        if (term === "sr680a v4" || term === "sr680a")
            return "http/search-lp2264.json";
    }
    if (upper === "POST" && pathname === "/osig/index/jsonfilter") {
        const term = (parseForm(body).term ?? "").toLowerCase();
        if (term === "7dmk" || term === "sr680a v4")
            return "http/osig-7dmk.json";
    }
    return null;
}
function parseForm(body) {
    const fields = {};
    if (!body)
        return fields;
    for (const [key, value] of new URLSearchParams(body))
        fields[key] = value;
    return fields;
}
function cacheKey(method, url, body) {
    return createHash("sha256").update(`${method}\n${url}\n${body ?? ""}`).digest("hex");
}
//# sourceMappingURL=client.js.map