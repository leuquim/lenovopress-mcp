import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchFixture, PressClient } from "../../src/client.js";
import { getRuntimeConfig, type RuntimeConfig } from "../../src/config.js";

describe("fixture routing", () => {
  it("maps document, search, PDF HEAD, and OSIG requests to saved files", () => {
    expect(matchFixture("GET", "https://lenovopress.lenovo.com/lp2264")).toBe("html/lp2264.html");
    expect(matchFixture("HEAD", "https://lenovopress.lenovo.com/lp2264.pdf")).toBe("http/lp2264.pdf.head.json");
    expect(matchFixture("GET", "https://lenovopress.lenovo.com/servers/ai-servers?page=1")).toBe("html/browse-ai-servers-p1.html");
    expect(matchFixture("GET", "https://lenovopress.lenovo.com/servers/ai-servers?page=2")).toBe("html/browse-ai-servers-p2.html");
    expect(matchFixture("POST", "https://lenovopress.lenovo.com/press/search/jsonquery", "term=4XB7A93127&page=1")).toBe("http/search-4xb7a93127.json");
    expect(matchFixture("POST", "https://lenovopress.lenovo.com/osig/index/jsonfilter", "term=7DMK")).toBe("http/osig-7dmk.json");
    expect(matchFixture("GET", "https://lenovopress.lenovo.com/unknown")).toBeNull();
  });
});

describe("runtime configuration", () => {
  it("enables fixtures only when explicitly configured", () => {
    expect(getRuntimeConfig({ PRESS_MCP_ROOT: path.resolve(import.meta.dirname, "..", "..") }).fixtureDir).toBeNull();
    expect(getRuntimeConfig({ PRESS_FIXTURE_DIR: "fixtures" }).fixtureDir).toBe(path.resolve("fixtures"));
  });
});

describe("live client policy", () => {
  it("never requests entitled or draft documents", async () => {
    const bodies: string[] = [];
    let calls = 0;
    const client = new PressClient(liveConfig(), async (_url, init) => {
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
    expect(bodies[0]).toMatch(/entitled=0/);
    expect(bodies[0]).toMatch(/drafts=0/);
    expect(bodies.join("\n")).not.toMatch(/entitled=1/);
    expect(bodies.join("\n")).not.toMatch(/drafts=1/);
  });
});

describe("request coordination", () => {
  it("deduplicates identical in-flight requests", async () => {
    const calls: number[] = [];
    const duplicate = new PressClient(liveConfig(), async () => {
      calls.push(Date.now());
      return new Response("ok");
    });
    await Promise.all([duplicate.getText("/same"), duplicate.getText("/same")]);
    expect(calls).toHaveLength(1);
    expect((await duplicate.getText("/same")).source).toBe("cache");

    const refreshed = await duplicate.getText("/same", true);
    expect(refreshed.source).toBe("network");
    expect(calls).toHaveLength(2);
  });

});

describe("cache retrieval metadata", () => {
  it("uses a legacy cache file's mtime when retrievedAt is absent", async () => {
    const config = liveConfig();
    const writer = new PressClient(config, async () => new Response("cached"));
    await writer.getText("/legacy");
    const file = path.join(config.cacheDir, readdirSync(config.cacheDir)[0]!);
    const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete record.retrievedAt;
    writeFileSync(file, JSON.stringify(record));
    const expected = statSync(file).mtime.toISOString();
    const reader = new PressClient(config, async () => {
      throw new Error("should read disk cache");
    });
    expect((await reader.getText("/legacy")).retrievedAt).toBe(expected);
  });
});

function liveConfig(): RuntimeConfig {
  return {
    cacheDir: mkdtempSync(path.join(tmpdir(), "press-mcp-")),
    fixtureDir: null,
    requestTimeoutMs: 5_000,
    offline: false,
  };
}
