import { writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const expectedTools = [
  "press_browse",
  "press_compare",
  "press_document_changes",
  "press_document_meta",
  "press_document_outline",
  "press_document_section",
  "press_find_part",
  "press_find_rows",
  "press_osig_lookup",
  "press_pdf_info",
  "press_related",
  "press_resolve",
  "press_search",
];

const evidence: Record<string, unknown> = {};

describe.sequential("MCP stdio Press surface", () => {
  const projectRoot = path.resolve(import.meta.dirname, "..", "..");
  const client = new Client({ name: "press-e2e", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, "dist", "index.js")],
    cwd: projectRoot,
    env: stringEnvironment({
      ...process.env,
      PRESS_MCP_ROOT: projectRoot,
      PRESS_FIXTURE_DIR: path.join(projectRoot, "fixtures"),
      PRESS_OFFLINE: "1",
    }),
    stderr: "pipe",
  });

  beforeAll(async () => {
    transport.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    const evidencePath = process.env.PRESS_EVIDENCE_PATH;
    if (evidencePath) {
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    }
    await client.close();
  });

  it("advertises the Press documentation tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(expectedTools);
    for (const tool of tools) {
      expect(tool.description).toEqual(expect.any(String));
      expect(tool.inputSchema).toEqual(expect.any(Object));
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
    evidence.tools = names;
    log("tools/list", names);
  });

  it("resolves LP2264, outlines it, and returns a GPU section with CBAG", async () => {
    const resolved = await call("press_resolve", { query: "LP2264" });
    expect(resolved.primary).toMatchObject({ formId: "LP2264" });
    expect(String((resolved.meta as Record<string, unknown> | null)?.pdfUrl ?? "")).toContain("lp2264.pdf");

    const fromMtm = await call("press_resolve", { query: "7DMKCTO1WW" });
    expect((fromMtm.candidates as Array<{ formId: string }>).some((hit) => hit.formId === "LP2264")).toBe(true);

    const fromSlug = await call("press_resolve", { query: "lp2264-thinksystem-sr680a-v4-server" });
    expect(fromSlug.primary).toMatchObject({ formId: "LP2264" });

    const meta = await call("press_document_meta", { id: "LP2264" });
    expect(meta.formId).toBe("LP2264");
    expect(String(meta.pdfUrl)).toContain("lp2264.pdf");

    const related = await call("press_related", { id: "LP2264" });
    expect((related.links as unknown[]).length).toBeGreaterThan(0);
    expect((related.familyDocs as Array<{ formId: string }>).some((hit) => hit.formId === "LP2264")).toBe(true);

    const outline = await call("press_document_outline", { id: "LP2264" });
    const sections = outline.sections as Array<{ id: string }>;
    expect(sections.length).toBeGreaterThan(20);
    expect(sections.map((section) => section.id)).toEqual(expect.arrayContaining([
      "gpu-accelerators",
      "network-adapters",
      "power-supplies",
    ]));

    const gpu = await call("press_document_section", { id: "LP2264", section: "gpu-accelerators" });
    const payload = JSON.stringify(gpu);
    expect(payload).toContain("CBAG");
    expect(payload).not.toMatch(/<!DOCTYPE html>/i);
    expect(Buffer.byteLength(payload, "utf8")).toBeLessThan(200_000);
    expect(gpu.markdown).toEqual(expect.any(String));
    expect(gpu.tables).toBeUndefined();
    const gpuTables = await call("press_document_section", { id: "LP2264", section: "gpu-accelerators", format: "tables" });
    expect(gpuTables.markdown).toBeUndefined();
    expect(gpuTables.tables).toEqual(expect.any(Array));
    const compare = await call("press_document_section", { id: "LP2264", section: "comparing-the-sr680a-v4-to-the-sr680a-v3" });
    expect(JSON.stringify(compare)).toMatch(/SR680a V3/i);
    log("gpu-section-bytes", Buffer.byteLength(payload, "utf8"));
  });

  it("returns dated changes, PDF HEAD metadata, search pages, and filtered OSIG rows", async () => {
    const changes = await call("press_document_changes", { id: "LP2264", latestOnly: true });
    const entries = changes.entries as Array<{ date: string; bullets: unknown[] }>;
    expect(entries.length).toBe(1);
    expect(entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const pdf = await call("press_pdf_info", { id: "LP2264" });
    expect(pdf.url).toBe("https://lenovopress.lenovo.com/lp2264.pdf");
    expect(Number(pdf.bytes)).toBeGreaterThan(1_000_000);

    const search = await call("press_search", { query: "4XB7A93127", limit: 5 });
    expect(Number(search.totalItems)).toBeGreaterThan(1);
    expect((search.items as unknown[]).length).toBeGreaterThan(1);
    expect((search.items as Array<{ lastUpdate: string }>)[0]?.lastUpdate).toBeTruthy();
    expect(search).toMatchObject({ source: "fixture" });
    expect(String(search.retrievedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    for (const query of ["C5QY", "B300", "CX8"]) {
      const page = await call("press_search", { query, limit: 5 });
      expect(Number(page.totalItems)).toBeGreaterThan(1);
      expect((page.items as Array<{ title: string; url: string; resourceType: string }>).length).toBeGreaterThan(1);
      expect(JSON.stringify(page)).not.toMatch(/compatibility matrix/i);
    }

    const osig = await call("press_osig_lookup", { query: "7DMK", limit: 8 });
    const rows = osig.items as Array<{ server: string; osFamily: string; availability: string }>;
    expect(rows).toHaveLength(8);
    expect(osig.hiddenWithdrawn).toBeGreaterThan(0);
    expect(osig.facets).toEqual(expect.any(Object));
    expect(osig).toMatchObject({ source: "fixture" });
    expect(Buffer.byteLength(JSON.stringify(osig), "utf8")).toBeLessThan(100_000);
    log("osig-rows", rows.length);
  });

  it("compares matched sections and finds a part across search results", async () => {
    const compare = await call("press_compare", { ids: ["LP2264", "LP2264"], topic: "gpu", format: "tables" });
    expect((compare.documents as Array<{ sectionId: string }>).every((document) => document.sectionId === "gpu-accelerators")).toBe(true);
    expect((compare.byIdentifier as Array<{ value: string }>).some((identifier) => identifier.value === "CBAG")).toBe(true);

    const found = await call("press_find_part", { query: "CBAG" });
    expect((found.documents as Array<{ formId: string; matches: unknown[] }>)).toEqual(expect.arrayContaining([
      expect.objectContaining({ formId: "LP2264", matches: expect.any(Array) }),
    ]));
  });

  async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(result.structuredContent).toBeDefined();
    const payload = result.structuredContent as Record<string, unknown>;
    const text = Array.isArray(result.content) ? JSON.stringify(result.content) : "";
    expect(text).not.toMatch(/<!DOCTYPE html>/i);
    expect(Buffer.byteLength(JSON.stringify(payload), "utf8")).toBeLessThan(1_500_000);
    evidence[`${name}:${JSON.stringify(args)}`] = summarize(name, payload);
    return payload;
  }
});

function summarize(name: string, payload: Record<string, unknown>): unknown {
  if (name === "press_document_section") {
    return {
      sectionId: payload.sectionId,
      tableCount: Array.isArray(payload.tables) ? payload.tables.length : 0,
      identifierCount: Array.isArray(payload.identifiers) ? payload.identifiers.length : 0,
      bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
      hasCbag: JSON.stringify(payload).includes("CBAG"),
    };
  }
  if (name === "press_search") {
    return {
      totalItems: payload.totalItems,
      itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
      formIds: Array.isArray(payload.items)
        ? (payload.items as Array<{ formId?: string }>).map((item) => item.formId)
        : [],
    };
  }
  if (name === "press_osig_lookup") {
    return {
      totalItems: payload.totalItems,
      itemCount: Array.isArray(payload.items) ? payload.items.length : 0,
      bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
    };
  }
  return payload;
}

function log(label: string, value: unknown): void {
  process.stdout.write(`[press-e2e] ${label}=${typeof value === "string" ? value : JSON.stringify(value)}\n`);
}

function stringEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
