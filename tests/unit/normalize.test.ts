import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeOsig, normalizeOsigRows, normalizeSearch, rankHits } from "../../src/normalize.js";

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
  it("filters OSIG rows, computes facets before pagination, and keeps row metadata", () => {
    const raw = JSON.parse(readFileSync(path.join(searchDir, "osig-7dmk.json"), "utf8")) as { items: unknown[] };
    const rows = normalizeOsigRows(raw);
    const filtered = normalizeOsig(rows, {
      offset: 0,
      limit: 1,
      includeWithdrawn: true,
      osFamily: "Red Hat Enterprise Linux",
      osVersion: "RHEL 9",
      supportStatement: "Supported & Certified",
    });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.totalItems).toBeGreaterThan(1);
    expect(filtered.hasMore).toBe(true);
    expect(filtered.items.every((row) => row.osVersion === "RHEL 9")).toBe(true);
    expect(filtered.facets.osSubVersion.map((facet) => facet.value)).toEqual(expect.arrayContaining(["RHEL 9.5", "RHEL 9.6"]));

    const subVersion = normalizeOsig(rows, {
      offset: 0,
      limit: 5,
      includeWithdrawn: true,
      osVersion: "rhel 9.6",
    });
    expect(subVersion.items).toHaveLength(1);
    expect(subVersion.items[0]?.osSubVersion).toBe("RHEL 9.6");

    const withdrawn = normalizeOsig(rows, {
      offset: 0,
      limit: 5,
      includeWithdrawn: true,
      availability: "withdrawn",
    });
    expect(withdrawn.items.length).toBeGreaterThan(0);
    expect(withdrawn.items[0]).toMatchObject({
      replacementServer: "SR680a V4 (7DMK)",
      replacementUrl: "https://lenovopress.lenovo.com/lp2264",
    });

    const page = normalizeOsig(rows, { offset: 0, limit: 5, includeWithdrawn: false });
    expect(page.totalItems).toBe(8);
    expect(page.hiddenWithdrawn).toBe(1);
    expect(page.facets.availability).toEqual([{ value: "Available", count: 8 }, { value: "Withdrawn", count: 1 }]);
    expect(page.facets.osFamily).toEqual([...page.facets.osFamily].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)));
    expect(JSON.stringify(page).length).toBeLessThan(50_000);
  });
});
