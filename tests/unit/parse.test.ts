import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyQuery, formIdFromPath } from "../../src/ids.js";
import { parseDocument, renderSection } from "../../src/parse.js";

const fixtureHtml = readFileSync(
  path.join(import.meta.dirname, "..", "..", "fixtures", "html", "lp2264.html"),
  "utf8",
);

const parsed = parseDocument(fixtureHtml, "https://lenovopress.lenovo.com/lp2264-thinksystem-sr680a-v4-server");

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

  it("parses the GPU table including feature CBAG from the fixture HTML", () => {
    const section = renderSection(parsed, "gpu-accelerators");
    expect(section.sectionId).toBe("gpu-accelerators");
    expect(section.tables.length).toBeGreaterThan(0);
    const gpuTable = section.tables.find((table) => table.id === "table-gpu-accelerators") ?? section.tables[0]!;
    expect(gpuTable.columns.join(" ")).toMatch(/Part number/i);
    expect(gpuTable.columns.join(" ")).toMatch(/Feature code/i);
    expect(gpuTable.rows.flat().join(" ")).toContain("CBAG");
    expect(section.identifiers.some((id) => id.kind === "feature" && id.value === "CBAG")).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(section), "utf8")).toBeLessThan(80_000);
    expect(section.markdown).not.toContain("<html");
    expect(section.markdown.length).toBeGreaterThan(40);
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
