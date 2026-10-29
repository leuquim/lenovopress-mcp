export type QueryKind = "url" | "form" | "slug" | "mtm" | "part" | "feature" | "text";
export declare function formIdFromPath(rawPath: string): string | null;
export declare function slugFromPath(rawPath: string): string;
export declare function documentUrl(formOrSlug: string): string;
export declare function pdfUrl(formId: string): string;
export declare function classifyQuery(raw: string): {
    kind: QueryKind;
    value: string;
    formId: string | null;
};
export declare function isPartNumber(value: string): boolean;
export declare function isFeatureCode(value: string): boolean;
export declare function isMtm(value: string): boolean;
export declare function extractParts(text: string): string[];
export declare function machineTypeFromServer(server: string): string | null;
