import type { ChangeHistory, DocumentMeta, DocumentOutline, PressTable, RelatedFamily, RelatedLink, SectionPayload } from "./types.js";
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
export declare function parseDocument(html: string, sourceUrl: string): ParsedDocument;
export declare function renderSection(parsed: ParsedDocument, sectionOrTableId: string, options?: {
    includeWithdrawn?: boolean;
    maxBytes?: number;
}): SectionPayload;
export declare function parseChanges(html: string, formId: string, lastUpdate: string | null): ChangeHistory;
export declare function familySearchSlug(family: RelatedFamily): string | null;
