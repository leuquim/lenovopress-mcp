import type { ChangeHistory, DocumentMeta, DocumentOutline, Identifier, PressTable, RelatedFamily, RelatedLink, SectionPayload } from "./types.js";
export interface ParsedDocument {
    meta: DocumentMeta;
    outline: DocumentOutline;
    changes: ChangeHistory;
    relatedLinks: RelatedLink[];
    families: RelatedFamily[];
    sections: Map<string, {
        title: string;
        html: string;
    }>;
    tables: Map<string, {
        table: PressTable;
        sectionId: string | null;
    }>;
}
export interface BrowsePage {
    items: Array<{
        formId: string;
        slug: string;
        url: string;
        title: string;
        resourceType: string | null;
        date: string | null;
    }>;
    totalItems: number;
    hasMore: boolean;
}
export declare function parseBrowsePage(html: string): BrowsePage;
export declare function parseDocument(html: string, sourceUrl: string): ParsedDocument;
export declare function renderSection(parsed: ParsedDocument, sectionOrTableId: string, options?: {
    includeWithdrawn?: boolean;
    maxBytes?: number;
    rowOffset?: number;
    format?: "markdown" | "tables";
}): SectionPayload;
export interface RowMatch {
    sectionId: string | null;
    tableId: string;
    caption: string;
    header: string[];
    row: string[];
    withdrawn: boolean;
}
export declare function findRows(parsed: ParsedDocument, needle: string): RowMatch[];
export declare function matchSections(parsed: ParsedDocument, topic: string): string[];
export declare function parseChanges(html: string, formId: string, lastUpdate: string | null): ChangeHistory;
export declare function identifierKey(identifier: Identifier): string;
export declare function familySearchSlug(family: RelatedFamily): string | null;
