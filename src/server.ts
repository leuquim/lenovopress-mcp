import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";
import { PressClient } from "./client.js";
import {
  DEFAULT_OSIG_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  MAX_OSIG_LIMIT,
  MAX_RESULT_BYTES,
  MAX_SEARCH_LIMIT,
  MAX_SECTION_BYTES,
} from "./config.js";
import { PressError, errorMessage } from "./errors.js";
import { classifyQuery, formIdFromPath, pdfUrl } from "./ids.js";
import { normalizeOsig, normalizePdfInfo, normalizeSearch, rankHits } from "./normalize.js";
import { familySearchSlug, parseDocument, renderSection } from "./parse.js";
import type { ParsedDocument } from "./parse.js";
import type { DocumentMeta, JsonRecord, SearchHit } from "./types.js";

const annotations = {
  readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
} as const;

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
});

export function createPressServer(client: PressClient): McpServer {
  const parsedCache = new Map<string, ParsedDocument>();
  const server = new McpServer({
    name: "lenovo-press",
    version: "0.1.0",
  }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions: [
      "Retrieve public Lenovo Press documentation (product guides, datasheets, OSIG, related pubs).",
      "This is not a configurator. x-config remains the source of truth for orderability, compatibility, and CSE/CFR.",
      "Default to one search page or one document section. Never dump a full product-guide HTML or PDF.",
      "Always include lastUpdate when present. If Press and x-config disagree on a SKU, believe x-config.",
    ].join(" "),
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
      resourceType: z.string().max(80).optional().describe("Site resource_type slug, e.g. product-guide."),
      productFamily: z.string().max(80).optional().describe("Family slug, e.g. sr680a-v4-server."),
      includeWithdrawn: z.boolean().default(false),
      sort: z.enum(["relevance", "last_update", "publish_date", "title"]).default("relevance"),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT),
    }),
    outputSchema: searchOutput,
    annotations: annotations.readOnly,
  }, async (input) => run(async () => search(client, {
    query: input.query,
    includeWithdrawn: input.includeWithdrawn,
    sort: input.sort,
    page: input.page,
    limit: input.limit,
    ...(input.resourceType !== undefined ? { resourceType: input.resourceType } : {}),
    ...(input.productFamily !== undefined ? { productFamily: input.productFamily } : {}),
  })));

  server.registerTool("press_resolve", {
    title: "Resolve Press Identifier",
    description: "Map a URL, form ID (LP2264), slug, MTM (7DMKCTO1WW), feature, or part number to Press document candidates. Product guides rank first when the query is a product identifier.",
    inputSchema: z.object({
      query: z.string().min(1).max(300),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => resolve(client, parsedCache, input.query)));

  server.registerTool("press_document_meta", {
    title: "Press Document Metadata",
    description: "Return title, form ID, authors, updated date, PDF URL, and resource type for one Press document.",
    inputSchema: z.object({
      id: z.string().min(1).max(300).describe("Form ID, slug, or Press URL."),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const parsed = await loadDocument(client, parsedCache, input.id);
    return parsed.meta as unknown as JsonRecord;
  }));

  server.registerTool("press_document_outline", {
    title: "Press Document Outline",
    description: "Return the table of contents and table captions for a Press document. Use this before fetching a section.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const parsed = await loadDocument(client, parsedCache, input.id);
    return parsed.outline as unknown as JsonRecord;
  }));

  server.registerTool("press_document_section", {
    title: "Press Document Section",
    description: "Return one named section or table as markdown plus structured tables and part/feature identifiers. Do not request the whole guide.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      section: z.string().min(1).max(120).describe("Section slug (gpu-accelerators) or table id (table-gpu-accelerators)."),
      includeWithdrawn: z.boolean().default(false),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const parsed = await loadDocument(client, parsedCache, input.id);
    return renderSection(parsed, input.section, {
      includeWithdrawn: input.includeWithdrawn,
      maxBytes: MAX_SECTION_BYTES,
    }) as unknown as JsonRecord;
  }));

  server.registerTool("press_document_changes", {
    title: "Press Change History",
    description: "Return dated Press change-history entries for a document. latestOnly defaults to the most recent update.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
      latestOnly: z.boolean().default(true),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => {
    const parsed = await loadDocument(client, parsedCache, input.id);
    const entries = input.latestOnly ? parsed.changes.entries.slice(0, 1) : parsed.changes.entries;
    return { ...parsed.changes, entries };
  }));

  server.registerTool("press_related", {
    title: "Related Press Documents",
    description: "Return related publications, product-family links, and the family document bundle for a Press document.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => related(client, parsedCache, input.id)));

  server.registerTool("press_osig_lookup", {
    title: "OSIG OS Support Lookup",
    description: "Look up Lenovo OSIG interoperability rows for a server term such as 7DMK or SR680a V4. Returns a filtered page, never the full OSIG export.",
    inputSchema: z.object({
      query: z.string().min(1).max(120),
      includeWithdrawn: z.boolean().default(false),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(MAX_OSIG_LIMIT).default(DEFAULT_OSIG_LIMIT),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => osigLookup(client, input)));

  server.registerTool("press_pdf_info", {
    title: "Press PDF Metadata",
    description: "Return the public PDF URL and HEAD metadata (bytes, last-modified) without downloading PDF bytes.",
    inputSchema: z.object({
      id: z.string().min(1).max(300),
    }),
    annotations: annotations.readOnly,
  }, async (input) => run(async () => pdfInfo(client, input.id)));

  server.registerResource("press-doc", new ResourceTemplate("press://doc/{formId}", {
    list: undefined,
  }), {
    title: "Press document meta and outline",
    description: "Metadata and table of contents for a Press form ID.",
    mimeType: "application/json",
  }, async (uri, extra) => {
    const formId = String(extra.formId ?? "");
    const parsed = await loadDocument(client, parsedCache, formId);
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ meta: parsed.meta, outline: parsed.outline }),
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
  resourceType?: string;
  productFamily?: string;
  includeWithdrawn: boolean;
  sort: string;
  page: number;
  limit: number;
}): Promise<JsonRecord> {
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
  });
  const raw = JSON.parse(fetched.body) as { status?: string; items?: unknown };
  if (raw.status && raw.status !== "success") {
    throw new PressError("SEARCH_FAILED", "Press search returned an error", raw);
  }
  return searchOutput.parse(normalizeSearch(raw, input.page, input.limit));
}

async function resolve(client: PressClient, cache: Map<string, ParsedDocument>, query: string): Promise<JsonRecord> {
  const classified = classifyQuery(query);
  let meta: DocumentMeta | null = null;
  let locatorHits: SearchHit[] = [];
  if (classified.kind === "url" || classified.kind === "form" || classified.kind === "slug") {
    try {
      const parsed = await loadDocument(client, cache, classified.formId ?? classified.value);
      meta = parsed.meta;
      locatorHits = [hitFromMeta(parsed.meta)];
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
    });
    searchHits = (page.items as SearchHit[]) ?? [];
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
  };
}

async function related(client: PressClient, cache: Map<string, ParsedDocument>, id: string): Promise<JsonRecord> {
  const parsed = await loadDocument(client, cache, id);
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
      });
      familyDocs = (page.items as SearchHit[]) ?? [];
    } catch {
      familyDocs = [];
    }
  }
  return {
    formId: parsed.meta.formId,
    links: parsed.relatedLinks,
    families: parsed.families,
    familyDocs,
  };
}

async function osigLookup(client: PressClient, input: {
  query: string;
  includeWithdrawn: boolean;
  offset: number;
  limit: number;
}): Promise<JsonRecord> {
  const fetched = await client.postForm("/osig/index/jsonfilter", { term: input.query });
  const raw = JSON.parse(fetched.body) as { status?: string; items?: unknown };
  if (raw.status && raw.status !== "success") {
    throw new PressError("OSIG_FAILED", "OSIG lookup returned an error", raw);
  }
  const page = normalizeOsig(raw, input);
  if (page.totalItems > 4000) {
    throw new PressError("TOO_LARGE", "OSIG result is unfiltered; use a tighter server term such as 7DMK or SR680a V4");
  }
  return page as unknown as JsonRecord;
}

async function pdfInfo(client: PressClient, id: string): Promise<JsonRecord> {
  const formId = formIdFromPath(id) ?? classifyQuery(id).formId ?? id.replace(/^\//, "").split("-")[0]!.toUpperCase();
  const url = pdfUrl(formId);
  const fetched = await client.head(url);
  return normalizePdfInfo(formId, url, fetched.headers) as unknown as JsonRecord;
}

async function loadDocument(
  client: PressClient,
  cache: Map<string, ParsedDocument>,
  id: string,
): Promise<ParsedDocument> {
  const classified = classifyQuery(id);
  const path = classified.kind === "url"
    ? new URL(classified.value).pathname
    : `/${classified.formId?.toLowerCase() ?? classified.value.replace(/^\//, "")}`;
  const cacheKey = path.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const fetched = await client.getText(path);
  const parsed = parseDocument(fetched.body, fetched.url);
  cache.set(cacheKey, parsed);
  cache.set(`/${parsed.meta.formId.toLowerCase()}`, parsed);
  return parsed;
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

