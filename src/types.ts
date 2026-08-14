export type JsonRecord = Record<string, unknown>;

export interface Identifier {
  kind: "part" | "feature" | "mtm" | "form";
  value: string;
}

export interface DocumentMeta {
  formId: string;
  docId: number | null;
  title: string;
  resourceType: string;
  authors: Array<{ name: string; url: string | null }>;
  updated: string | null;
  pdfUrl: string;
  pdfPages: number | null;
  pdfSizeLabel: string | null;
  url: string;
  slug: string;
  entitlement: string;
}

export interface OutlineSection {
  id: string;
  title: string;
  tableCount: number;
}

export interface OutlineTable {
  id: string;
  caption: string;
  sectionId: string | null;
}

export interface DocumentOutline {
  formId: string;
  title: string;
  lastUpdate: string | null;
  sections: OutlineSection[];
  tables: OutlineTable[];
}

export interface PressTable {
  id: string;
  caption: string;
  columns: string[];
  rows: string[][];
  rowWithdrawn: boolean[];
  withdrawnRows: number;
}

export interface SectionPayload {
  formId: string;
  sectionId: string;
  title: string;
  markdown: string;
  tables: PressTable[];
  identifiers: Identifier[];
  truncated: boolean;
}

export interface ChangeEntry {
  date: string;
  bullets: Array<{ text: string; sectionId: string | null; parts: string[] }>;
}

export interface ChangeHistory {
  formId: string;
  lastUpdate: string | null;
  entries: ChangeEntry[];
}

export interface RelatedLink {
  title: string;
  url: string;
  kind: "press" | "pubs" | "support" | "product" | "other";
}

export interface RelatedFamily {
  slug: string;
  title: string;
  url: string;
}

export interface SearchHit {
  formId: string;
  slug: string;
  url: string;
  title: string;
  resourceType: string;
  publishDate: string | null;
  lastUpdate: string | null;
  withdrawn: boolean;
  entitlement: string;
}

export interface SearchPage {
  items: SearchHit[];
  page: number;
  totalPages: number;
  totalItems: number;
  hasMore: boolean;
}

export interface OsigRow {
  id: string;
  server: string;
  machineType: string | null;
  osFamily: string;
  osVersion: string;
  osSubVersion: string;
  supportStatement: string;
  availability: string;
  productGuideUrl: string | null;
}

export interface OsigPage {
  updated: string | null;
  items: OsigRow[];
  totalItems: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface PdfInfo {
  formId: string;
  url: string;
  bytes: number | null;
  lastModified: string | null;
  contentType: string | null;
}

export interface ResolveResult {
  query: string;
  primary: SearchHit | null;
  meta: DocumentMeta | null;
  candidates: SearchHit[];
}

export interface RelatedPayload {
  formId: string;
  links: RelatedLink[];
  families: RelatedFamily[];
  familyDocs: SearchHit[];
}
