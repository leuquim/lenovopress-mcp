export declare function decodeEntities(value: string): string;
export declare function stripTags(html: string): string;
export declare function attr(tag: string, name: string): string | null;
export declare function hasClass(tag: string, className: string): boolean;
/** Return the inner HTML of the element whose opening tag starts at `openIndex`. */
export declare function elementInner(html: string, openIndex: number): {
    inner: string;
    end: number;
} | null;
export declare function findOpenTag(html: string, predicate: (tag: string) => boolean, from?: number): number;
