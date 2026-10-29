const ENTITY_MAP = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    deg: "deg",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: "\"",
    ldquo: "\"",
    hellip: "...",
    times: "x",
    reg: "(R)",
    copy: "(C)",
    trade: "(TM)",
};
export function decodeEntities(value) {
    return value
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => codePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => codePoint(Number.parseInt(dec, 10)))
        .replace(/&([a-zA-Z]+);/g, (match, name) => ENTITY_MAP[name] ?? match);
}
function codePoint(value) {
    if (!Number.isFinite(value) || value < 0 || value > 0x10ffff)
        return "";
    return String.fromCodePoint(value);
}
export function stripTags(html) {
    return decodeEntities(html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|h[1-6]|tr|caption)>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "- ")
        .replace(/<[^>]+>/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim());
}
export function attr(tag, name) {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    if (!match)
        return null;
    return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
}
export function hasClass(tag, className) {
    const value = attr(tag, "class");
    if (!value)
        return false;
    return value.split(/\s+/).includes(className);
}
/** Return the inner HTML of the element whose opening tag starts at `openIndex`. */
export function elementInner(html, openIndex) {
    const openMatch = html.slice(openIndex).match(/^<([a-zA-Z0-9]+)(\s[^>]*)?>/);
    if (!openMatch)
        return null;
    const tagName = openMatch[1]?.toLowerCase() ?? "";
    const openEnd = openIndex + openMatch[0].length;
    if (openMatch[0].endsWith("/>"))
        return { inner: "", end: openEnd };
    const openRe = new RegExp(`<${tagName}\\b`, "gi");
    const closeRe = new RegExp(`</${tagName}\\s*>`, "gi");
    openRe.lastIndex = openEnd;
    closeRe.lastIndex = openEnd;
    let depth = 1;
    let cursor = openEnd;
    while (depth > 0 && cursor < html.length) {
        openRe.lastIndex = cursor;
        closeRe.lastIndex = cursor;
        const nextOpen = openRe.exec(html);
        const nextClose = closeRe.exec(html);
        if (!nextClose)
            return null;
        if (nextOpen && nextOpen.index < nextClose.index) {
            depth += 1;
            cursor = nextOpen.index + nextOpen[0].length;
        }
        else {
            depth -= 1;
            if (depth === 0) {
                return { inner: html.slice(openEnd, nextClose.index), end: nextClose.index + nextClose[0].length };
            }
            cursor = nextClose.index + nextClose[0].length;
        }
    }
    return null;
}
export function findOpenTag(html, predicate, from = 0) {
    const re = /<[^>]+>/g;
    re.lastIndex = from;
    let match;
    while ((match = re.exec(html))) {
        const tag = match[0];
        if (tag.startsWith("</") || tag.startsWith("<!"))
            continue;
        if (predicate(tag))
            return match.index;
    }
    return -1;
}
//# sourceMappingURL=html.js.map