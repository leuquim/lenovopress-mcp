import { PRESS_ORIGIN } from "./config.js";
import { attr, decodeEntities, elementInner, findOpenTag, hasClass, stripTags } from "./html.js";
import { extractParts, formIdFromPath, isFeatureCode, isMtm, isPartNumber, pdfUrl, slugFromPath } from "./ids.js";
const MONTHS = {
    january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
    july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
export function parseDocument(html, sourceUrl) {
    const content = isolateContent(html);
    const meta = parseMeta(html, sourceUrl);
    const sections = collectSections(content);
    const tables = collectTables(content, sections);
    const outline = buildOutline(content, meta, sections, tables);
    return {
        meta,
        outline,
        changes: parseChanges(html, meta.formId, meta.updated),
        relatedLinks: parseRelatedLinks(content),
        families: parseFamilies(content),
        sections,
        tables,
    };
}
export function renderSection(parsed, sectionOrTableId, options = {}) {
    const includeWithdrawn = options.includeWithdrawn === true;
    const maxBytes = options.maxBytes ?? 80_000;
    const tableHit = parsed.tables.get(sectionOrTableId);
    const sectionId = tableHit?.sectionId ?? sectionOrTableId;
    const section = parsed.sections.get(sectionId);
    if (!section && !tableHit) {
        const available = [...parsed.sections.keys(), ...parsed.tables.keys()].slice(0, 40);
        throw new Error(`Unknown section or table '${sectionOrTableId}'. Available: ${available.join(", ")}`);
    }
    const title = section?.title ?? tableHit?.table.caption ?? sectionId;
    const rawTables = tableHit
        ? [tableHit.table]
        : [...parsed.tables.values()]
            .filter((entry) => entry.sectionId === sectionId)
            .map((entry) => entry.table);
    const tables = rawTables.map((table) => filterTable(table, includeWithdrawn));
    const markdown = tableHit
        ? tableToMarkdown(tables[0])
        : htmlToMarkdown(section?.html ?? "", includeWithdrawn);
    const identifiers = tables.flatMap((table) => identifiersFromTable(table));
    const payload = {
        formId: parsed.meta.formId,
        sectionId,
        title,
        markdown,
        tables,
        identifiers: uniqueIdentifiers(identifiers),
        truncated: false,
    };
    return clipSection(payload, maxBytes);
}
function isolateContent(html) {
    const start = html.search(/id="contentcol"|id="document"|class="section"/i);
    if (start < 0)
        return html;
    const modal = html.indexOf('id="change_history_modal"', start);
    return html.slice(start, modal > start ? modal : html.length);
}
function parseMeta(html, sourceUrl) {
    const bsd = html.match(/var\s+bsd\s*=\s*\{\s*docId\s*:\s*(\d+)\s*,\s*formId\s*:\s*"([^"]+)"\s*,\s*resourceType\s*:\s*"([^"]+)"/);
    const title = firstText(html, /<h1 class="static-hero__title">([^<]+)<\/h1>/i)
        ?? firstText(html, /<meta property="og:title" content="([^"]+)"/i)
        ?? "Untitled";
    const formId = bsd?.[2] ?? formIdFromPath(sourceUrl) ?? "UNKNOWN";
    const slug = slugFromPath(sourceUrl.includes(formId.toLowerCase()) ? sourceUrl : `${formId.toLowerCase()}`);
    const authors = [];
    const authorBlock = html.match(/<h5 id="meta-authors">[\s\S]*?<\/h5>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (authorBlock?.[1]) {
        const authorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = authorRe.exec(authorBlock[1]))) {
            const href = attr(`<a ${match[1] ?? ""}>`, "href");
            authors.push({
                name: stripTags(match[2] ?? "").trim(),
                url: href ? absolutize(href) : null,
            });
        }
    }
    const updated = firstText(html, /<h5 id="meta-published">[\s\S]*?<\/h5>\s*([^<]+)/i);
    const pdfSizeLabel = firstText(html, /<h5 id="meta-pdf-size">[\s\S]*?<\/h5>\s*([^<]+)/i);
    const pdfPagesMatch = pdfSizeLabel?.match(/([\d,]+)\s*pages/i);
    const pdfHref = html.match(/href="([^"]+\.pdf)"/i)?.[1];
    return {
        formId,
        docId: bsd?.[1] ? Number.parseInt(bsd[1], 10) : null,
        title: decodeEntities(title).replace(/\s+Product Guide$/i, "").trim(),
        resourceType: bsd?.[3] ?? firstText(html, /<h4>([^<]+)<\/h4>/i) ?? "Document",
        authors,
        updated: updated?.trim() ?? null,
        pdfUrl: pdfHref ? absolutize(pdfHref) : pdfUrl(formId),
        pdfPages: pdfPagesMatch?.[1] ? Number.parseInt(pdfPagesMatch[1].replace(/,/g, ""), 10) : null,
        pdfSizeLabel: pdfSizeLabel?.trim() ?? null,
        url: sourceUrl.startsWith("http") ? sourceUrl.split("#")[0] : `${PRESS_ORIGIN}/${slug}`,
        slug,
        entitlement: "Unrestricted",
    };
}
function collectSections(html) {
    const sections = new Map();
    const re = /<div\b([^>]*\bclass="[^"]*\bsection\b[^"]*"[^>]*)>/gi;
    let match;
    while ((match = re.exec(html))) {
        const tag = match[0];
        const id = attr(tag, "id");
        if (!id)
            continue;
        const extracted = elementInner(html, match.index);
        if (!extracted)
            continue;
        const heading = extracted.inner.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
            ?? precedingHeading(html, match.index)
            ?? id;
        sections.set(id, { title: stripTags(heading).trim() || id, html: extracted.inner });
    }
    return sections;
}
function precedingHeading(html, index) {
    const window = html.slice(Math.max(0, index - 800), index);
    const match = window.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>\s*$/i);
    return match?.[1] ?? null;
}
function collectTables(html, sections) {
    const tables = new Map();
    const re = /<table\b[^>]*>/gi;
    let match;
    let auto = 0;
    while ((match = re.exec(html))) {
        const extracted = elementInner(html, match.index);
        if (!extracted)
            continue;
        const parsed = parseTable(extracted.inner, ++auto);
        if (!parsed)
            continue;
        const sectionId = sectionIdForOffset(html, match.index, sections);
        tables.set(parsed.id, { table: parsed, sectionId });
    }
    return tables;
}
function sectionIdForOffset(html, offset, sections) {
    let found = null;
    let best = -1;
    const re = /<div\b([^>]*\bclass="[^"]*\bsection\b[^"]*"[^>]*)>/gi;
    let match;
    while ((match = re.exec(html))) {
        if (match.index > offset)
            break;
        const id = attr(match[0], "id");
        if (!id || !sections.has(id))
            continue;
        if (match.index >= best) {
            best = match.index;
            found = id;
        }
    }
    return found;
}
function parseTable(inner, autoIndex) {
    const captionHtml = inner.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? "";
    const captionId = captionHtml.match(/\bid="([^"]+)"/i)?.[1];
    const caption = stripTags(captionHtml).trim() || `Table ${autoIndex}`;
    const thead = inner.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? "";
    const headerRow = firstRow(thead) ?? firstRow(inner);
    const columns = headerRow ? cells(headerRow).map((cell) => cell.text) : [];
    if (columns.length === 0)
        return null;
    const body = inner.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? inner;
    const rows = [];
    const rowWithdrawn = [];
    for (const row of allRows(body)) {
        const parsed = cells(row.html);
        if (parsed.length === 0)
            continue;
        if (headerRow && row.html === headerRow)
            continue;
        if (parsed.every((cell) => cell.text === "") && parsed.length === 1)
            continue;
        const values = parsed.map((cell) => cell.text);
        if (columns.length > 0 && values.length !== columns.length) {
            while (values.length < columns.length)
                values.push("");
        }
        rows.push(values);
        rowWithdrawn.push(row.withdrawn);
    }
    return {
        id: captionId ?? `table-${autoIndex}`,
        caption,
        columns,
        rows,
        rowWithdrawn,
        withdrawnRows: rowWithdrawn.filter(Boolean).length,
    };
}
function firstRow(html) {
    return allRows(html)[0]?.html ?? null;
}
function allRows(html) {
    const rows = [];
    const re = /<tr\b([^>]*)>/gi;
    let match;
    while ((match = re.exec(html))) {
        const extracted = elementInner(html, match.index);
        if (!extracted)
            continue;
        rows.push({ html: extracted.inner, withdrawn: hasClass(match[0], "withdrawn") });
    }
    return rows;
}
function cells(rowHtml) {
    const out = [];
    const re = /<t[dh]\b([^>]*)>/gi;
    let match;
    while ((match = re.exec(rowHtml))) {
        const extracted = elementInner(rowHtml, match.index);
        if (!extracted)
            continue;
        out.push({
            text: stripTags(extracted.inner).replace(/\s+/g, " ").trim(),
            withdrawn: hasClass(match[0], "withdrawn"),
        });
    }
    return out;
}
function buildOutline(html, meta, sections, tables) {
    const toc = [];
    const tocBlock = html.match(/<div class="panel panel-default panel-toc">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/i)?.[0]
        ?? html.match(/class="panel-toc"[\s\S]*?<\/div>\s*<\/div>/i)?.[0]
        ?? "";
    const tocRe = /<a\b[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const seen = new Set();
    while ((match = tocRe.exec(tocBlock))) {
        const id = match[1] ?? "";
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        const title = stripTags(match[2] ?? "").trim() || id;
        const tableCount = [...tables.values()].filter((entry) => entry.sectionId === id).length;
        toc.push({ id, title, tableCount });
    }
    if (toc.length === 0) {
        for (const [id, section] of sections) {
            toc.push({
                id,
                title: section.title,
                tableCount: [...tables.values()].filter((entry) => entry.sectionId === id).length,
            });
        }
    }
    return {
        formId: meta.formId,
        title: meta.title,
        lastUpdate: meta.updated,
        sections: toc,
        tables: [...tables.values()].map((entry) => ({
            id: entry.table.id,
            caption: entry.table.caption,
            sectionId: entry.sectionId,
        })),
    };
}
export function parseChanges(html, formId, lastUpdate) {
    const modal = html.match(/id="change_history_modal_body"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)?.[1]
        ?? html.match(/<div class="section" id="change-history">([\s\S]*?)<\/div>/i)?.[1]
        ?? "";
    const entries = [];
    const parts = modal.split(/<p>\s*Changes in the /i);
    for (const part of parts.slice(1)) {
        const header = part.match(/^([^<]+?)\s+update:/i);
        if (!header?.[1])
            continue;
        const date = normalizeDate(header[1]);
        const body = part.slice(header[0].length);
        const bullets = [];
        const topList = body.match(/<ul>([\s\S]*?)<\/ul>/i)?.[1] ?? body;
        const itemRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
        let item;
        while ((item = itemRe.exec(topList))) {
            const raw = item[1] ?? "";
            if (item.index > 0 && topList.slice(0, item.index).includes("<ul>"))
                continue;
            const text = stripTags(raw).replace(/\s+/g, " ").trim();
            if (!text)
                continue;
            const sectionId = raw.match(/href="#([^"]+)"/i)?.[1] ?? null;
            bullets.push({ text, sectionId, parts: extractParts(text) });
        }
        if (bullets.length > 0)
            entries.push({ date, bullets });
    }
    return { formId, lastUpdate, entries };
}
function normalizeDate(label) {
    const match = label.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
    if (!match)
        return label.trim();
    const month = MONTHS[match[1].toLowerCase()];
    if (!month)
        return label.trim();
    return `${match[3]}-${month}-${match[2].padStart(2, "0")}`;
}
function parseRelatedLinks(html) {
    const block = sectionHtml(html, "related-publications-and-links");
    if (!block)
        return [];
    const links = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(block))) {
        const href = attr(`<a ${match[1] ?? ""}>`, "href");
        if (!href || href.startsWith("#"))
            continue;
        const url = absolutize(href);
        const title = stripTags(match[2] ?? "").trim() || url;
        links.push({ title, url, kind: classifyLink(url) });
    }
    return dedupeLinks(links);
}
function parseFamilies(html) {
    const block = sectionHtml(html, "product-families") ?? sectionHtml(html, "related-product-families");
    if (!block)
        return [];
    const families = [];
    const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(block))) {
        const href = attr(`<a ${match[1] ?? ""}>`, "href");
        if (!href || href.includes("#") || hasClass(`<a ${match[1] ?? ""}>`, "copy-link"))
            continue;
        const title = stripTags(match[2] ?? "").trim();
        if (!title)
            continue;
        const url = absolutize(href);
        const slug = url.replace(/\/$/, "").split("/").pop() ?? title;
        families.push({ slug, title, url });
    }
    return families;
}
function sectionHtml(html, id) {
    const index = findOpenTag(html, (tag) => attr(tag, "id") === id);
    if (index < 0)
        return null;
    return elementInner(html, index)?.inner ?? null;
}
function classifyLink(url) {
    if (/lenovopress/i.test(url))
        return "press";
    if (/pubs\.lenovo\.com/i.test(url))
        return "pubs";
    if (/datacentersupport|serverproven|support\.lenovo/i.test(url))
        return "support";
    if (/lenovo\.com\/.*servers|\/p\/servers/i.test(url))
        return "product";
    return "other";
}
function dedupeLinks(links) {
    const seen = new Set();
    return links.filter((link) => {
        if (seen.has(link.url))
            return false;
        seen.add(link.url);
        return true;
    });
}
function filterTable(table, includeWithdrawn) {
    if (includeWithdrawn || table.withdrawnRows === 0)
        return table;
    const rows = [];
    const rowWithdrawn = [];
    table.rows.forEach((row, index) => {
        if (table.rowWithdrawn[index])
            return;
        rows.push(row);
        rowWithdrawn.push(false);
    });
    return { ...table, rows, rowWithdrawn, withdrawnRows: 0 };
}
function identifiersFromTable(table) {
    const found = [];
    const partIdx = table.columns.findIndex((col) => /part\s*number/i.test(col));
    const featureIdx = table.columns.findIndex((col) => /feature\s*code/i.test(col));
    const mtmIdx = table.columns.findIndex((col) => /machine\s*type|mtm|model/i.test(col));
    for (const row of table.rows) {
        const part = partIdx >= 0 ? row[partIdx] : undefined;
        const feature = featureIdx >= 0 ? row[featureIdx] : undefined;
        const mtm = mtmIdx >= 0 ? row[mtmIdx] : undefined;
        if (part && isPartNumber(part))
            found.push({ kind: "part", value: part.toUpperCase() });
        if (feature && isFeatureCode(feature))
            found.push({ kind: "feature", value: feature.toUpperCase() });
        if (mtm && isMtm(mtm.split(/\s|\//)[0] ?? "")) {
            found.push({ kind: "mtm", value: (mtm.split(/\s|\//)[0] ?? "").toUpperCase() });
        }
    }
    return found;
}
function uniqueIdentifiers(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = `${item.kind}:${item.value}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function htmlToMarkdown(html, includeWithdrawn) {
    let working = html;
    if (!includeWithdrawn) {
        working = working.replace(/<tr\b[^>]*class="[^"]*\bwithdrawn\b[^"]*"[\s\S]*?<\/tr>/gi, "");
        working = working.replace(/<li\b[^>]*class="[^"]*\bwithdrawn\b[^"]*"[\s\S]*?<\/li>/gi, "");
    }
    working = working.replace(/<table\b[\s\S]*?<\/table>/gi, (tableHtml) => {
        const inner = tableHtml.replace(/^<table\b[^>]*>/i, "").replace(/<\/table>$/i, "");
        const table = parseTable(inner, 0);
        return table ? `\n\n${tableToMarkdown(table)}\n\n` : "";
    });
    working = working.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, title) => `\n\n## ${stripTags(title)}\n\n`);
    working = working.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, title) => `\n\n### ${stripTags(title)}\n\n`);
    return stripTags(working).trim();
}
function tableToMarkdown(table) {
    const header = `| ${table.columns.join(" | ")} |`;
    const sep = `| ${table.columns.map(() => "---").join(" | ")} |`;
    const rows = table.rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
    return [`**${table.caption}**`, header, sep, ...rows].join("\n");
}
function escapeCell(value) {
    return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function clipSection(payload, maxBytes) {
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") <= maxBytes)
        return payload;
    const clipped = {
        ...payload,
        tables: payload.tables.slice(0, 1),
        markdown: payload.markdown.slice(0, Math.max(2000, maxBytes / 4)),
        truncated: true,
    };
    if (Buffer.byteLength(JSON.stringify(clipped), "utf8") <= maxBytes)
        return clipped;
    return {
        ...clipped,
        markdown: clipped.markdown.slice(0, 1500),
        tables: clipped.tables.map((table) => ({ ...table, rows: table.rows.slice(0, 8) })),
    };
}
function firstText(html, re) {
    const match = html.match(re);
    return match?.[1] ? decodeEntities(match[1]).trim() : null;
}
function absolutize(href) {
    if (/^https?:\/\//i.test(href))
        return href;
    if (href.startsWith("//"))
        return `https:${href}`;
    if (href.startsWith("/"))
        return `${PRESS_ORIGIN}${href}`;
    return `${PRESS_ORIGIN}/${href}`;
}
export function familySearchSlug(family) {
    if (family.url.includes("#"))
        return null;
    if (!/thinksystem|thinkedge|thinkagile|sr\d|sd\d|se\d/i.test(`${family.url} ${family.title}`)) {
        return null;
    }
    const last = family.url.replace(/\/$/, "").split("/").pop() ?? family.slug;
    if (!last || last.includes("."))
        return null;
    return last.endsWith("-server") ? last : `${last}-server`;
}
//# sourceMappingURL=parse.js.map