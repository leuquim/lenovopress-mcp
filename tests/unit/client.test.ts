import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchFixture, PressClient } from "../../src/client.js";
import type { RuntimeConfig } from "../../src/config.js";

describe("fixture routing", () => {
  it("maps document, search, PDF HEAD, and OSIG requests to saved files", () => {
    expect(matchFixture("GET", "https://lenovopress.lenovo.com/lp2264")).toBe("html/lp2264.html");
    expect(matchFixture("HEAD", "https://lenovopress.lenovo.com/lp2264.pdf")).toBe("http/lp2264.pdf.head.json");
    expect(matchFixture("POST", "https://lenovopress.lenovo.com/press/search/jsonquery", "term=4XB7A93127&page=1")).toBe("http/search-4xb7a93127.json");
    expect(matchFixture("POST", "https://lenovopress.lenovo.com/osig/index/jsonfilter", "term=7DMK")).toBe("http/osig-7dmk.json");
    expect(matchFixture("GET", "https://lenovopress.lenovo.com/unknown")).toBeNull();
  });
});

describe("live client policy", () => {
  it("never requests entitled or draft documents and waits between network fetches", async () => {
    const bodies: string[] = [];
    const started = Date.now();
    let calls = 0;
    const client = new PressClient(liveConfig(80), async (_url, init) => {
      calls += 1;
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify({ status: "success", items: [], pager: { page: "1", total_pages: 1, total_items: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await client.postForm("/press/search/jsonquery", {
      term: "C5QY",
      resource_type: "",
      product_family: "",
      drafts: 0,
      withdrawn: 0,
      entitled: 0,
      sort: "relevance",
      limit: 5,
      page: 1,
    });
    await client.postForm("/press/search/jsonquery", {
      term: "B300",
      resource_type: "",
      product_family: "",
      drafts: 0,
      withdrawn: 0,
      entitled: 0,
      sort: "relevance",
      limit: 5,
      page: 1,
    });
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
    expect(bodies[0]).toMatch(/entitled=0/);
    expect(bodies[0]).toMatch(/drafts=0/);
    expect(bodies.join("\n")).not.toMatch(/entitled=1/);
    expect(bodies.join("\n")).not.toMatch(/drafts=1/);
  });
});

function liveConfig(rateLimitMs: number): RuntimeConfig {
  return {
    projectRoot: path.resolve(import.meta.dirname, "..", ".."),
    cacheDir: mkdtempSync(path.join(tmpdir(), "press-mcp-")),
    fixtureDir: null,
    rateLimitMs,
    requestTimeoutMs: 5_000,
    offline: false,
  };
}
