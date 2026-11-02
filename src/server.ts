import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { asCached, FETCH_SOURCES, PressClient, type FetchSource } from "./client.js";
import {
  BROWSE_CATEGORIES,
  DEFAULT_OSIG_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_OSIG_LIMIT,
  MAX_COMPARE_DOCS,
  MAX_FIND_PART_DOCS,
  MAX_RESULT_BYTES,
  MAX_SEARCH_LIMIT,
  MAX_SECTION_BYTES,
  RESOURCE_TYPES,
  PARSED_CACHE_SIZE,
} from "./config.js";
import { PressError, errorMessage } from "./errors.js";
import { classifyQuery, formIdFromPath, pdfUrl } from "./ids.js";
import { isProductGuide, normalizeOsig, normalizeOsigRows, normalizePdfInfo, normalizeSearch, rankHits } from "./normalize.js";
import type { OsigOptions } from "./normalize.js";
import { familySearchSlug, findRows, identifierKey, matchSections, parseBrowsePage, parseDocument, renderSection } from "./parse.js";
import type { ParsedDocument, RowMatch } from "./parse.js";
import type { DocumentMeta, JsonRecord, SearchHit, SectionPayload } from "./types.js";
import { LruMap } from "./lru.js";

interface LoadedDocument {
  parsed: ParsedDocument;
  retrievedAt: string;
  source: FetchSource;
}

interface CompareDoc {
  formId: string;
  title: string;
  lastUpdate: string | null;
  url: string;
  sectionId: string | null;
  section: SectionPayload | null;
  alternatives: string[];
}

interface DocumentSummary {
  formId: string;
  title: string;
  resourceType: string;
  url: string;
  lastUpdate: string | null;
}

interface PartDoc extends DocumentSummary {
  matches: RowMatch[];
  totalMatches: number;
}

const annotations = {
  readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;

const provenanceOutput = {
  retrievedAt: z.string(),
  source: z.enum(FETCH_SOURCES),
};

const searchOutput = z.object({
  items: z.array(z.object({
    formId: z.string(),
    slug: z.string(),
    url: z.string(),
    title: z.string(),
    resourceType: z.string(),
    publishDate: z.string().nullable(),
    lastUpdate: z.string().nullable(),
    withdrawn: z.boolean(),
    entitlement: z.string(),
  })),
  page: z.number(),
  totalPages: z.number(),
  totalItems: z.number(),
  hasMore: z.boolean(),
  ...provenanceOutput,
});

const browseOutput = z.object({
  items: z.array(z.object({
    formId: z.string(),
    slug: z.string(),
    url: z.string(),
    title: z.string(),
    resourceType: z.string().nullable(),
    date: z.string().nullable(),
  })),
  page: z.number(),
  totalItems: z.number(),
  hasMore: z.boolean(),
  ...provenanceOutput,
});

function provenance(value: Pick<LoadedDocument, "retrievedAt" | "source">): Pick<LoadedDocument, "retrievedAt" | "source"> {
  return { retrievedAt: value.retrievedAt, source: value.source };
}

export function createPressServer(client: PressClient): McpServer {
  const parsedCache = new LruMap<string, Promise<LoadedDocument>>(PARSED_CACHE_SIZE);
  const server = new McpServer({
    name: "lenovo-press",
    version: "0.1.0",
  }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: [
      "Use press_resolve for an identifier, then press_document_outline before press_document_section.",
      "For specs/options, fetch sections and follow nextRowOffset until null.",
      "Use press_compare to compare one topic across guides; use press_find_part to find a part across search hits.",
      "For OS support, use press_osig_lookup and narrow with facets; set includeWithdrawn when hiddenWithdrawn is positive.",
      "Use press_browse for category and benchmark discovery.",
      "This is not a configurator: x-config is authoritative for orderability, compatibility, CSE, and CFR.",
      "Always include lastUpdate when present; if Press and x-config disagree on a SKU, believe x-config.",
    ].join("\n"),
  });

  const run = async (action: () => Promise<JsonRecord>) => {
    try {
      const result = await action();
      const serialized = JSON.stringify(result);
      if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
        throw new PressError("TOO_LARGE", `Result exceeds ${MAX_RESULT_BYTES} bytes; narrow the section, page, or limit`);
      }
      return {
        content: [{ type: "text" as const, text: serialized }],
        structuredContent: result,
      };
    } catch (error) {
      const payload = {
        error: {
          code: error instanceof PressError ? error.code : "MCP_OPERATION_FAILED",
          message: errorMessage(error),
          ...(error instanceof PressError && error.details !== undefined ? { details: error.details } : {}),
        },
      };
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    }
  };

  server.registerTool("press_search", {
    title: "Search Lenovo Press",
    description: "Search public Lenovo Press publications by text, form ID, MTM, feature code, or part number. Returns a page of document hits, not a compatibility matrix.",
    inputSchema: z.object({
      query: z.string().max(200).default("").describe("Form ID, MTM, feature, part, or descriptive text."),
      resourceType: z.enum(RESOURCE_TYPES).optional().describe("Site resource_type slug."),
      productFamily: z.string().max(80).optional().describe("family slug as seen in press_related output"),
      includeWithdrawn: z.boolean().default(false),
      sort: z.enum(["relevance", "last_update", "publish_date", "title"]).default("relevance"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT),
      refresh: z.boolean().optional(),
    }),
    outputSchema: searchOutput,
    annotations: annotations.readOnly,
  }, async (input) => run(async () => search(client, input)));

  server.registerTool("press_browse", {
    title: "Browse Lenovo Press Category",
    description: "Browse one supported Lenovo Press category page, including servers, options, networking, and selected benchmarks.",
    inputSchema: z.object({
      category: z.enum(BROWSE_CATEGORIES),
      page: z.number().int().min(1).default(1),
      refresh: z.boolean().optional(),
    }),
    outputSchema: browseOutput,
    annotations: annotations.readOnly,
  }, async (input) => run(async () => browse(client, input.category, input.page, input.refresh)));

  server.registerTool("press_resolve", {
    title: "Resolve Press Identifier",
    description: "Map a URL, form ID (LP2264), slug, MTM (7DMKCTO1WW), feature, or part number to Press document candidates. Product guides rank first when the query is a product identifier.",
    inputSchema: z.object({
      query: z.string().min(1).max(300),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => resolve(client, parsedCache, input.query, input.refresh)));

  server.registerTool("press_document_meta", {
    title: "Press Document Metadata",
    description: "Return title, form ID, authors, updated date, PDF URL, and resource type for one Press document.",
    inputSchema: z.object({
      id: z.string().min(1).max(300).describe("Form ID, slug, or Press URL."),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const loaded = await loadDocument(client, parsedCache, input.id, input.refresh);
    return { ...loaded.parsed.meta, ...provenance(loaded) };
  }));

  server.registerTool("press_document_outline", {
    title: "Press Document Outline",
    description: "Return the table of contents and table captions for a Press document. Use this before fetching a section.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const loaded = await loadDocument(client, parsedCache, input.id, input.refresh);
    return { ...loaded.parsed.outline, ...provenance(loaded) };
  }));

  server.registerTool("press_document_section", {
    title: "Press Document Section",
    description: "Return one named section, table, or topic as markdown or structured tables plus identifiers. Follow nextRowOffset when a clipped page has more rows.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      section: z.string().min(1).max(120).describe("Section slug (gpu-accelerators) or table id (table-gpu-accelerators)."),
      includeWithdrawn: z.boolean().default(false),
      rowOffset: z.number().int().min(0).default(0),
      format: z.enum(["markdown", "tables"]).default("markdown"),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const loaded = await loadDocument(client, parsedCache, input.id, input.refresh);
    return { ...renderSection(loaded.parsed, input.section, {
      includeWithdrawn: input.includeWithdrawn,
      maxBytes: MAX_SECTION_BYTES,
      rowOffset: input.rowOffset,
      format: input.format,
    }), ...provenance(loaded) };
  }));

  server.registerTool("press_find_rows", {
    title: "Find Part Rows in a Press Document",
    description: "rows for a part in one known document; use press_find_part to search across documents",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      query: z.string().min(1).max(200),
      includeWithdrawn: z.boolean().default(false),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const loaded = await loadDocument(client, parsedCache, input.id, input.refresh);
    const rows = visibleRows(loaded.parsed, input.query, input.includeWithdrawn);
    const matches = rows.slice(input.offset, input.offset + input.limit);
    return {
      matches,
      totalMatches: rows.length,
      hasMore: input.offset + matches.length < rows.length,
      document: docSummary(loaded.parsed.meta),
      ...provenance(loaded),
    };
  }));

  server.registerTool("press_compare", {
    title: "Compare Press Guide Topics",
    description: "Compare one topic side-by-side across 2-4 Press guides. Each guide is matched independently; provenance is the newest retrievedAt and source among returned documents, and byIdentifier highlights shared parts.",
    inputSchema: z.object({
      ids: z.array(z.string().min(1).max(300)).min(2).max(MAX_COMPARE_DOCS),
      topic: z.string().min(1).max(120),
      format: z.enum(["markdown", "tables"]).default("markdown"),
      includeWithdrawn: z.boolean().default(false),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => compareDocuments(client, parsedCache, input)));

  server.registerTool("press_find_part", {
    title: "Find Part Across Press Documents",
    description: "Answer which documents list a part, feature code, or token and what each matching row says, with retrievedAt and source from the newest loaded document.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      maxDocs: z.number().int().min(1).max(MAX_FIND_PART_DOCS).default(5),
      resourceType: z.enum([...RESOURCE_TYPES, "any"]).default("product-guide").describe("Defaults to product guides; \"any\" includes articles, briefs and references."),
      includeWithdrawn: z.boolean().default(false),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => findPart(client, parsedCache, input)));

  server.registerTool("press_document_changes", {
    title: "Press Change History",
    description: "Return dated Press change-history entries for a document. latestOnly defaults to the most recent update.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      latestOnly: z.boolean().default(true),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const loaded = await loadDocument(client, parsedCache, input.id, input.refresh);
    const entries = input.latestOnly ? loaded.parsed.changes.entries.slice(0, 1) : loaded.parsed.changes.entries;
    return { ...loaded.parsed.changes, entries, ...provenance(loaded) };
  }));

  server.registerTool("press_related", {
    title: "Related Press Documents",
    description: "Return related publications, product-family links, and the family document bundle for a Press document.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => related(client, parsedCache, input.id, input.refresh)));

  server.registerTool("press_osig_lookup", {
    title: "OSIG OS Support Lookup",
    description: "Look up Lenovo OSIG interoperability rows with facets for narrowing. hiddenWithdrawn reports matching rows excluded by the default withdrawn filter.",
    inputSchema: z.object({
      query: z.string().min(1).max(120),
      osFamily: z.string().max(120).optional(),
      osVersion: z.string().max(120).optional(),
      supportStatement: z.string().max(120).optional(),
      availability: z.string().max(120).optional(),
      includeWithdrawn: z.boolean().default(false),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(MAX_OSIG_LIMIT).default(DEFAULT_OSIG_LIMIT),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => osigLookup(client, input)));

  server.registerTool("press_pdf_info", {
    title: "Press PDF Metadata",
    description: "Return the public PDF URL and HEAD metadata (bytes, last-modified) without downloading PDF bytes.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      refresh: z.boolean().optional(),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => pdfInfo(client, input.id, input.refresh)));

  server.registerResource("press-doc", new ResourceTemplate("press://doc/{formId}", {
    list: undefined,
  }), {
    title: "Press document meta and outline",
    description: "Metadata and table of contents for a Press form ID.",
    mimeType: "application/json",
  }, async (uri, extra) => {
    const formId = String(extra.formId ?? "");
    const loaded = await loadDocument(client, parsedCache, formId);
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ meta: loaded.parsed.meta, outline: loaded.parsed.outline, ...provenance(loaded) }),
      }],
    };
  });

  server.registerPrompt("press_options_brief", {
    title: "GPU, network, and power options",
    description: "Pull the option sections of a product guide for an HPC/AI architect briefing.",
    argsSchema: z.object({
      product: z.string().min(1).max(200).describe("Product name, form ID, or MTM."),
    }),
  }, ({ product }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          `Brief the published GPU, network, and power options for ${product} from Lenovo Press.`,
          "Call press_resolve, then press_document_outline, then press_document_section for gpu-accelerators, network-adapters, and power-supplies.",
          "Quote part numbers and feature codes from the tables. Remind that x-config is authoritative for orderability.",
        ].join("\n"),
      },
    }],
  }));

  server.registerPrompt("press_what_changed", {
    title: "Latest Press update",
    description: "Summarize the latest change-history entry for a Press document.",
    argsSchema: z.object({
      id: z.string().min(1).max(200),
    }),
  }, ({ id }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: `Call press_document_changes with id ${id} and latestOnly true. Summarize what changed and which sections to re-read.`,
      },
    }],
  }));

  return server;
}

async function search(client: PressClient, input: {
  query: string;
  resourceType?: string | undefined;
  productFamily?: string | undefined;
  includeWithdrawn: boolean;
  sort: string;
  page: number;
  limit: number;
  refresh?: boolean | undefined;
}): Promise<z.infer<typeof searchOutput>> {
  const fetched = await client.postForm("/press/search/jsonquery", {
    term: input.query,
    resource_type: input.resourceType ?? "",
    product_family: input.productFamily ?? "",
    drafts: 0,
    withdrawn: input.includeWithdrawn ? 1 : 0,
    entitled: 0,
    sort: input.sort,
    limit: input.limit,
    page: input.page,
  }, input.refresh);
  const raw = JSON.parse(fetched.body) as { status?: string; items?: unknown };
  if (raw.status && raw.status !== "success") {
    throw new PressError("SEARCH_FAILED", "Press search returned an error", raw);
  }
  return searchOutput.parse({ ...normalizeSearch(raw, input.page, input.limit), ...provenance(fetched) });
}

async function browse(client: PressClient, category: string, page: number, refresh?: boolean): Promise<z.infer<typeof browseOutput>> {
  const fetched = await client.getText(`/${category}?page=${page}`, refresh);
  return browseOutput.parse({ ...parseBrowsePage(fetched.body), page, ...provenance(fetched) });
}

async function compareDocuments(
  client: PressClient,
  cache: LruMap<string, Promise<LoadedDocument>>,
  input: { ids: string[]; topic: string; format: "markdown" | "tables"; includeWithdrawn: boolean; refresh?: boolean | undefined },
): Promise<JsonRecord> {
  const results = await loadAll(client, cache, input.ids.map((id) => ({ id, ref: id })), input.refresh);
  const identifiers = new Map<string, { kind: string; value: string; formIds: Set<string> }>();
  const documents: CompareDoc[] = results.loaded.map(({ doc: current }) => {
    const [sectionId, ...alternatives] = matchSections(current.parsed, input.topic);
    const sectionIds = [...current.parsed.sections.keys()];
    const choices = sectionId ? alternatives.slice(0, 5) : sectionIds;
    const section = sectionId
      ? renderSection(current.parsed, sectionId, {
        includeWithdrawn: input.includeWithdrawn,
        maxBytes: Math.floor(MAX_SECTION_BYTES / input.ids.length),
        format: input.format,
      })
      : null;
    (section?.identifiers ?? []).forEach((identifier) => {
      const key = identifierKey(identifier);
      const item = identifiers.get(key) ?? { ...identifier, formIds: new Set<string>() };
      item.formIds.add(current.parsed.meta.formId);
      identifiers.set(key, item);
    });
    return {
      ...docSummary(current.parsed.meta),
      sectionId: sectionId ?? null,
      section,
      alternatives: choices,
    };
  });
  const newest = results.loaded.map(({ doc }) => doc).reduce<LoadedDocument | null>((latest, current) =>
    !latest || current.retrievedAt > latest.retrievedAt ? current : latest, null);
  const byIdentifier = [...identifiers.values()]
    .map((identifier) => ({ kind: identifier.kind, value: identifier.value, formIds: [...identifier.formIds].sort() }))
    .sort((left, right) => right.formIds.length - left.formIds.length || left.value.localeCompare(right.value));
  return {
    documents,
    failed: results.failed,
    byIdentifier,
    ...(newest ? provenance(newest) : {}),
  };
}

async function findPart(
  client: PressClient,
  cache: LruMap<string, Promise<LoadedDocument>>,
  input: { query: string; maxDocs: number; resourceType?: string | undefined; includeWithdrawn: boolean; refresh?: boolean | undefined },
): Promise<JsonRecord> {
  const page = await search(client, {
    query: input.query,
    resourceType: input.resourceType === "any" ? undefined : input.resourceType,
    includeWithdrawn: input.includeWithdrawn,
    sort: "relevance",
    page: 1,
    limit: input.maxDocs,
    refresh: input.refresh,
  });
  const results = await loadAll(client, cache, page.items.map((hit) => ({ id: hit.formId, ref: hit.url })), input.refresh);
  const mentionedWithoutRows = results.loaded.flatMap(({ doc }) => {
    const allRows = findRows(doc.parsed, input.query);
    const rows = visibleRows(doc.parsed, input.query, input.includeWithdrawn);
    if (rows.length === 0) {
      return [{
        formId: doc.parsed.meta.formId,
        title: doc.parsed.meta.title,
        withdrawnRows: allRows.length,
      }];
    }
    return [];
  });
  const documents: PartDoc[] = results.loaded.flatMap(({ doc }) => {
    const rows = visibleRows(doc.parsed, input.query, input.includeWithdrawn);
    return rows.length === 0 ? [] : [{ ...docSummary(doc.parsed.meta), matches: rows.slice(0, 10), totalMatches: rows.length }];
  });
  documents.sort((left, right) => {
    const leftGuide = isProductGuide(left.resourceType) ? 0 : 1;
    const rightGuide = isProductGuide(right.resourceType) ? 0 : 1;
    return leftGuide - rightGuide || right.totalMatches - left.totalMatches;
  });
  const newest = results.loaded.map(({ doc }) => doc).reduce<LoadedDocument | null>((latest, current) =>
    !latest || current.retrievedAt > latest.retrievedAt ? current : latest, null);
  return {
    documents,
    mentionedWithoutRows,
    failed: results.failed,
    searchTotal: page.totalItems,
    hasMoreDocs: page.totalItems > input.maxDocs,
    ...(newest ? provenance(newest) : {}),
  };
}

async function resolve(client: PressClient, cache: LruMap<string, Promise<LoadedDocument>>, query: string, refresh?: boolean): Promise<JsonRecord> {
  const classified = classifyQuery(query);
  let meta: DocumentMeta | null = null;
  let locatorHits: SearchHit[] = [];
  let retrieval: Pick<LoadedDocument, "retrievedAt" | "source"> | null = null;
  if (classified.kind === "url" || classified.kind === "form" || classified.kind === "slug") {
    try {
      const loaded = await loadDocument(client, cache, classified.formId ?? classified.value, refresh);
      meta = loaded.parsed.meta;
      locatorHits = [hitFromMeta(loaded.parsed.meta)];
      retrieval = loaded;
    } catch {
      locatorHits = [];
    }
  }
  const searchQuery = classified.kind === "url" ? (classified.formId ?? query) : classified.value;
  let searchHits: SearchHit[] = [];
  try {
    const page = await search(client, {
      query: searchQuery,
      includeWithdrawn: false,
      sort: classified.kind === "text" ? "relevance" : "last_update",
      page: 1,
      limit: 10,
      refresh,
    });
    searchHits = page.items;
    retrieval = provenance(page);
  } catch {
    searchHits = [];
  }
  const merged = dedupeHits([...locatorHits, ...searchHits]);
  const ranked = rankHits(merged, searchQuery);
  return {
    query,
    primary: ranked[0] ?? null,
    meta,
    candidates: ranked,
    retrievedAt: retrieval?.retrievedAt ?? null,
    source: retrieval?.source ?? null,
  };
}

async function related(client: PressClient, cache: LruMap<string, Promise<LoadedDocument>>, id: string, refresh?: boolean): Promise<JsonRecord> {
  const loaded = await loadDocument(client, cache, id, refresh);
  const { parsed } = loaded;
  let familyDocs: SearchHit[] = [];
  const family = parsed.families
    .map((item) => familySearchSlug(item))
    .find((slug: string | null): slug is string => Boolean(slug));
  if (family) {
    try {
      const page = await search(client, {
        query: "",
        productFamily: family,
        includeWithdrawn: false,
        sort: "relevance",
        page: 1,
        limit: 15,
        refresh,
      });
      familyDocs = page.items;
    } catch {
      familyDocs = [];
    }
  }
  return {
    formId: parsed.meta.formId,
    links: parsed.relatedLinks,
    families: parsed.families,
    familyDocs,
    ...provenance(loaded),
  };
}

async function osigLookup(client: PressClient, input: OsigOptions & { query: string; refresh?: boolean | undefined }): Promise<JsonRecord> {
  const fetched = await client.postForm("/osig/index/jsonfilter", { term: input.query }, input.refresh);
  const raw = JSON.parse(fetched.body) as { status?: string; items?: unknown };
  if (raw.status && raw.status !== "success") {
    throw new PressError("OSIG_FAILED", "OSIG lookup returned an error", raw);
  }
  const rows = normalizeOsigRows(raw);
  if (rows.length > 4000) {
    throw new PressError("TOO_LARGE", "OSIG result is unfiltered; use a tighter server term such as 7DMK or SR680a V4");
  }
  const page = normalizeOsig(rows, input);
  return { ...page, ...provenance(fetched) };
}

async function pdfInfo(client: PressClient, id: string, refresh?: boolean): Promise<JsonRecord> {
  const formId = formIdFromPath(id) ?? classifyQuery(id).formId ?? id.replace(/^\//, "").split("-")[0]!.toUpperCase();
  const url = pdfUrl(formId);
  const fetched = await client.head(url, refresh);
  return { ...normalizePdfInfo(formId, url, fetched.headers), ...provenance(fetched) };
}

async function loadDocument(
  client: PressClient,
  cache: LruMap<string, Promise<LoadedDocument>>,
  id: string,
  refresh?: boolean,
): Promise<LoadedDocument> {
  const classified = classifyQuery(id);
  const path = classified.kind === "url"
    ? new URL(classified.value).pathname
    : `/${classified.formId?.toLowerCase() ?? classified.value.replace(/^\//, "")}`;
  const cacheKey = path.toLowerCase();
  const hit = refresh ? undefined : cache.get(cacheKey);
  if (hit) {
    return asCached(await hit);
  }
  const pending = client.getText(path, refresh).then((fetched) => ({
    parsed: parseDocument(fetched.body, fetched.url),
    ...provenance(fetched),
  }));
  rememberParsed(cache, cacheKey, pending);
  try {
    const loaded = await pending;
    rememberParsed(cache, `/${loaded.parsed.meta.formId.toLowerCase()}`, pending);
    return loaded;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

function rememberParsed(cache: LruMap<string, Promise<LoadedDocument>>, key: string, value: Promise<LoadedDocument>): void {
  cache.set(key, value);
}

async function loadAll(
  client: PressClient,
  cache: LruMap<string, Promise<LoadedDocument>>,
  refs: ReadonlyArray<{ id: string; ref: string }>,
  refresh?: boolean,
): Promise<{ loaded: Array<{ id: string; doc: LoadedDocument }>; failed: Array<{ id: string; error: string }> }> {
  const settled = await Promise.allSettled(refs.map(({ ref }) => loadDocument(client, cache, ref, refresh)));
  return {
    loaded: settled.flatMap((result, index) => result.status === "fulfilled"
      ? [{ id: refs[index]!.id, doc: result.value }]
      : []),
    failed: settled.flatMap((result, index) => result.status === "rejected"
      ? [{ id: refs[index]!.id, error: errorMessage(result.reason) }]
      : []),
  };
}

function docSummary(meta: DocumentMeta): DocumentSummary {
  return { formId: meta.formId, title: meta.title, url: meta.url, resourceType: meta.resourceType, lastUpdate: meta.updated };
}

function visibleRows(parsed: ParsedDocument, query: string, includeWithdrawn: boolean): RowMatch[] {
  return findRows(parsed, query).filter((match) => includeWithdrawn || !match.withdrawn);
}

function hitFromMeta(meta: DocumentMeta): SearchHit {
  return {
    formId: meta.formId,
    slug: meta.slug,
    url: meta.url,
    title: meta.title,
    resourceType: meta.resourceType,
    publishDate: null,
    lastUpdate: meta.updated,
    withdrawn: false,
    entitlement: meta.entitlement,
  };
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = hit.formId || hit.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

