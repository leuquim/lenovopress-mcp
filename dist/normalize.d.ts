import type { OsigPage, OsigRow, PdfInfo, SearchHit, SearchPage } from "./types.js";
export interface RawSearchItem {
    title?: unknown;
    relativeLink?: unknown;
    resourceType?: unknown;
    publishDate?: unknown;
    lastUpdate?: unknown;
    withdrawn?: unknown;
    entitlement?: unknown;
}
export interface RawSearchResponse {
    status?: unknown;
    items?: unknown;
    pager?: {
        page?: unknown;
        total_pages?: unknown;
        total_items?: unknown;
    };
}
export declare function normalizeSearch(raw: RawSearchResponse, page: number, limit: number): SearchPage;
export declare function normalizeHit(raw: RawSearchItem): SearchHit | null;
export interface RawOsigItem {
    id?: unknown;
    server?: unknown;
    os_family?: unknown;
    os_version?: unknown;
    os_sub_version?: unknown;
    support_statement?: unknown;
    availability?: unknown;
    replacement_url?: unknown;
    product_guide_url?: unknown;
}
export declare function normalizeOsig(raw: {
    items?: unknown;
    status?: unknown;
}, options: {
    offset: number;
    limit: number;
    includeWithdrawn: boolean;
}): OsigPage;
export declare function normalizeOsigRow(raw: unknown): OsigRow | null;
export declare function normalizePdfInfo(formId: string, url: string, headers: Headers | Record<string, string>): PdfInfo;
export declare function rankHits(hits: SearchHit[], query: string): SearchHit[];
