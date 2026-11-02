import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyQuery, formIdFromPath } from "../../src/ids.js";
import { findRows, matchSections, parseBrowsePage, parseDocument, renderSection } from "../../src/parse.js";

const fixtureHtml = readFileSync(
  path.join(import.meta.dirname, "..", "..", "fixtures", "html", "lp2264.html"),
  "utf8",
);

const parsed = parseDocument(fixtureHtml, "https://lenovopress.lenovo.com/lp2264-thinksystem-sr680a-v4-server");

const browseFixture = (page: number) => readFileSync(
  path.join(import.meta.dirname, "..", "..", "fixtures", "html", `browse-ai-servers-p${page}.html`),
  "utf8",
);

describe("LP2264 fixture parse", () => {
  it("extracts document meta from the saved HTML", () => {
    expect(parsed.meta.formId).toBe("LP2264");
    expect(parsed.meta.resourceType).toBe("Product Guide");
    expect(parsed.meta.title).toMatch(/SR680a V4/i);
    expect(parsed.meta.pdfUrl).toBe("https://lenovopress.lenovo.com/lp2264.pdf");
    expect(parsed.meta.pdfPages).toBe(65);
    expect(parsed.meta.authors.some((author) => /David Watts/i.test(author.name))).toBe(true);
    expect(parsed.meta.updated).toMatch(/2026/);
  });

  it("returns a named outline with GPU, network, power, and generation-compare sections", () => {
    const ids = parsed.outline.sections.map((section) => section.id);
    expect(parsed.outline.sections.length).toBeGreaterThan(20);
    expect(ids).toEqual(expect.arrayContaining([
      "gpu-accelerators",
      "network-adapters",
      "power-supplies",
      "comparing-the-sr680a-v4-to-the-sr680a-v3",
    ]));
    expect(parsed.outline.tables.some((table) => table.id === "table-gpu-accelerators")).toBe(true);
  });

  it("matches a topic to the closest section id or title", () => {
    expect(matchSections(parsed, "gpu")[0]).toBe("gpu-accelerators");
    expect(matchSections(parsed, "power")[0]).toBe("power-supplies");
    expect(matchSections(parsed, "memory")[0]).toBe("memory");
    expect(matchSections(parsed, "nonsense")).toEqual([]);
  });

  it("parses the GPU table including feature CBAG from the fixture HTML", () => {
    const section = renderSection(parsed, "gpu-accelerators", { format: "tables" });
    expect(section.sectionId).toBe("gpu-accelerators");
    expect(section.tables!.length).toBeGreaterThan(0);
    const gpuTable = section.tables!.find((table) => table.id === "table-gpu-accelerators") ?? section.tables![0]!;
    expect(gpuTable.columns.join(" ")).toMatch(/Part number/i);
    expect(gpuTable.columns.join(" ")).toMatch(/Feature code/i);
    expect(gpuTable.rows.flat().join(" ")).toContain("CBAG");
    expect(section.identifiers.some((id) => id.kind === "feature" && id.value === "CBAG")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(section), "utf8")).toBeLessThan(80_000);
    expect(section.markdown).toBeUndefined();
  });

  it("expands header and body spans so every body row matches its column width", () => {
    const table = parsed.tables.get("table-intel-6-p-core-processor-features")?.table;
    expect(table).toBeDefined();
    expect(table!.columns).toHaveLength(16);
    for (const { table: current } of parsed.tables.values()) {
      expect(current.rows.every((row) => row.length === current.columns.length)).toBe(true);
      expect(current.rowWithdrawn).toHaveLength(current.rows.length);
    }
  });

  it("returns one representation at a time and keeps prose while clipping", () => {
    const markdown = renderSection(parsed, "comparing-the-sr680a-v4-to-the-sr680a-v3", { maxBytes: 700 });
    expect(markdown.tables).toBeUndefined();
    expect(markdown.markdown).toMatch(/SR680a/i);
    expect(markdown.truncated).toBe(true);

    const tables = renderSection(parsed, "gpu-accelerators", { format: "tables" });
    expect(tables.markdown).toBeUndefined();
    expect(tables.tables).toBeDefined();
  });

  it("makes row paging progress and exposes the next absolute row offset", () => {
    const first = renderSection(parsed, "gpu-accelerators", { format: "tables", maxBytes: 1 });
    expect(first.tables?.flatMap((table) => table.rows)).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextRowOffset).toBe(1);
    const second = renderSection(parsed, "gpu-accelerators", { format: "tables", maxBytes: 1, rowOffset: first.nextRowOffset! });
    expect(second.tables?.flatMap((table) => table.rows)).toHaveLength(1);
    expect(second.nextRowOffset).toBe(2);
  });

  it("finds exact tokens across tables while retaining row context", () => {
    const matches = findRows(parsed, "4XB7A93127");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((match) => match.row.some((cell) => /\b4XB7A93127\b/i.test(cell)))).toBe(true);
    expect(matches[0]).toMatchObject({
      tableId: expect.any(String),
      caption: expect.any(String),
      header: expect.any(Array),
      withdrawn: expect.any(Boolean),
    });
  });

  it("parses dated change-history entries from the fixture modal", () => {
    expect(parsed.changes.entries.length).toBeGreaterThan(3);
    expect(parsed.changes.entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const texts = parsed.changes.entries.flatMap((entry) => entry.bullets.map((bullet) => bullet.text)).join("\n");
    expect(texts).toMatch(/4XB7A93127|B300|drive/i);
    expect(parsed.changes.entries.some((entry) => entry.bullets.some((bullet) => bullet.parts.includes("4XB7A93127")))).toBe(true);
  });

  it("extracts related publications and product families", () => {
    expect(parsed.relatedLinks.some((link) => /ds0198/i.test(link.url))).toBe(true);
    expect(parsed.families.some((family) => /sr680a-v4/i.test(family.url))).toBe(true);
  });
});

describe("identifier helpers", () => {
  it("classifies architect identifiers without inventing a second parser", () => {
    expect(formIdFromPath("/lp2264-thinksystem-sr680a-v4-server")).toBe("LP2264");
    expect(classifyQuery("7DMKCTO1WW").kind).toBe("mtm");
    expect(classifyQuery("4XB7A93127").kind).toBe("part");
    expect(classifyQuery("C5QY").kind).toBe("feature");
    expect(classifyQuery("LP2264").kind).toBe("form");
  });
});

describe("browse fixtures", () => {
  it("parses the first AI Servers category page with metadata and pagination", () => {
    const page = parseBrowsePage(browseFixture(1));
    expect(page).toMatchObject({ totalItems: 51, hasMore: true });
    expect(page.items).toHaveLength(10);
    expect(page.items[0]).toMatchObject({
      formId: "LP2551",
      title: "Enterprise Context Layer for AI Agents",
      resourceType: "Reference Architecture",
      date: "29 Oct 2026",
    });
  });

  it("parses the second AI Servers category page without first-page overlap", () => {
    const first = parseBrowsePage(browseFixture(1));
    const second = parseBrowsePage(browseFixture(2));
    expect(second).toMatchObject({ totalItems: 51, hasMore: true });
    expect(second.items).toHaveLength(10);
    expect(second.items.some((item) => first.items.some((firstItem) => firstItem.formId === item.formId))).toBe(false);
  });
});
