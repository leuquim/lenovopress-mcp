import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOsig, normalizeSearch, rankHits } from "../../src/normalize.js";

const searchDir = path.join(import.meta.dirname, "..", "..", "fixtures", "http");

describe("search normalize", () => {
  it("maps jsonquery items to form IDs and keeps pagination metadata", () => {
    const raw = JSON.parse(readFileSync(path.join(searchDir, "search-lp2264.json"), "utf8")) as {
      items: unknown[];
      pager: { page: string; total_pages: string; total_items: string };
    };
    const page = normalizeSearch(raw, 1, 5);
    expect(page.totalItems).toBe(4);
    expect(page.hasMore).toBe(false);
    const guide = page.items.find((item) => item.formId === "LP2264");
    expect(guide?.resourceType).toBe("Product Guide");
    expect(guide?.url).toContain("/lp2264-thinksystem-sr680a-v4-server");
    expect(guide?.lastUpdate).toMatch(/2026/);
  });

  it("ranks the product guide above other LP2264 search hits", () => {
    const raw = JSON.parse(readFileSync(path.join(searchDir, "search-lp2264.json"), "utf8")) as { items: unknown[] };
    const page = normalizeSearch(raw, 1, 10);
    const ranked = rankHits(page.items, "LP2264");
    expect(ranked[0]?.formId).toBe("LP2264");
  });

  it("reports multiple hits for a shared feature code", () => {
    const raw = JSON.parse(readFileSync(path.join(searchDir, "search-c5qy.json"), "utf8")) as {
      pager: { total_items: string };
      items: unknown[];
    };
    const page = normalizeSearch(raw, 1, 5);
    expect(page.totalItems).toBeGreaterThan(1);
    expect(page.items.length).toBeGreaterThan(1);
    expect(page.hasMore).toBe(true);
  });
});

describe("OSIG normalize", () => {
  it("pages filtered OSIG rows and parses the machine type", () => {
    const raw = JSON.parse(readFileSync(path.join(searchDir, "osig-7dmk.json"), "utf8")) as { items: unknown[] };
    const page = normalizeOsig(raw, { offset: 0, limit: 5, includeWithdrawn: false });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.items.every((row) => /7DMK/i.test(row.server))).toBe(true);
    expect(page.items[0]?.machineType).toBe("7DMK");
    expect(page.items.some((row) => /Withdrawn/i.test(row.availability))).toBe(false);
    expect(JSON.stringify(page).length).toBeLessThan(50_000);
  });
});
