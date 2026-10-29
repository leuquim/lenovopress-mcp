import { PRESS_ORIGIN } from "./config.js";
import { formIdFromPath, machineTypeFromServer, slugFromPath } from "./ids.js";
export function normalizeSearch(raw, page, limit) {
    const items = Array.isArray(raw.items)
        ? raw.items.map((item) => normalizeHit(item)).filter((hit) => hit !== null)
        : [];
    const totalItems = toInt(raw.pager?.total_items, items.length);
    const totalPages = toInt(raw.pager?.total_pages, totalItems === 0 ? 1 : Math.ceil(totalItems / Math.max(1, limit)));
    const current = toInt(raw.pager?.page, page);
    return {
        items,
        page: current,
        totalPages,
        totalItems,
        hasMore: current < totalPages,
    };
}
export function normalizeHit(raw) {
    const title = asString(raw.title);
    const relative = asString(raw.relativeLink);
    if (!title || !relative)
        return null;
    const slug = slugFromPath(relative);
    const formId = formIdFromPath(relative) ?? slug.toUpperCase();
    return {
        formId,
        slug,
        url: `${PRESS_ORIGIN}${relative.startsWith("/") ? relative : `/${relative}`}`,
        title,
        resourceType: asString(raw.resourceType) ?? "Document",
        publishDate: asString(raw.publishDate),
        lastUpdate: asString(raw.lastUpdate),
        withdrawn: raw.withdrawn === 1 || raw.withdrawn === true || raw.withdrawn === "1",
        entitlement: asString(raw.entitlement) ?? "Unrestricted",
    };
}
export function normalizeOsig(raw, options) {
    const all = Array.isArray(raw.items) ? raw.items.map(normalizeOsigRow).filter((row) => row !== null) : [];
    const filtered = options.includeWithdrawn
        ? all
        : all.filter((row) => !/^withdrawn$/i.test(row.availability));
    const slice = filtered.slice(options.offset, options.offset + options.limit);
    return {
        updated: null,
        items: slice,
        totalItems: filtered.length,
        offset: options.offset,
        limit: options.limit,
        hasMore: options.offset + slice.length < filtered.length,
    };
}
export function normalizeOsigRow(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const item = raw;
    const server = asString(item.server);
    if (!server)
        return null;
    return {
        id: asString(item.id) ?? server,
        server,
        machineType: machineTypeFromServer(server),
        osFamily: asString(item.os_family) ?? "",
        osVersion: asString(item.os_version) ?? "",
        osSubVersion: asString(item.os_sub_version) ?? "",
        supportStatement: asString(item.support_statement) ?? "",
        availability: asString(item.availability) ?? "",
        productGuideUrl: asString(item.product_guide_url) ?? asString(item.replacement_url),
    };
}
export function normalizePdfInfo(formId, url, headers) {
    const get = (name) => {
        if (headers instanceof Headers)
            return headers.get(name);
        const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
        return key ? headers[key] ?? null : null;
    };
    const length = get("content-length");
    return {
        formId,
        url,
        bytes: length ? Number.parseInt(length, 10) : null,
        lastModified: get("last-modified"),
        contentType: get("content-type"),
    };
}
export function rankHits(hits, query) {
    const needle = query.trim().toLowerCase();
    const form = needle.replace(/[^a-z0-9]/g, "");
    return [...hits].sort((left, right) => {
        return score(right, needle, form) - score(left, needle, form);
    });
}
function score(hit, needle, form) {
    let value = 0;
    if (hit.formId.toLowerCase() === needle || hit.formId.toLowerCase() === form)
        value += 100;
    if (hit.slug.toLowerCase() === needle)
        value += 80;
    if (/product guide/i.test(hit.resourceType))
        value += 20;
    if (hit.title.toLowerCase().includes(needle))
        value += 10;
    if (!hit.withdrawn)
        value += 5;
    if (hit.entitlement === "Unrestricted")
        value += 2;
    return value;
}
function asString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function toInt(value, fallback) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}
//# sourceMappingURL=normalize.js.map