import { PRESS_ORIGIN } from "./config.js";

const FORM_RE = /^(lp|ds|tips|redp|sg)(\d+)/i;
const PART_RE = /^4[A-Z0-9]{8,}$/i;
const MTM_RE = /^[0-9][A-Z0-9]{3}(?:CTO\d+[A-Z]{2})?$/i;
const FEATURE_RE = /^[A-Z][A-Z0-9]{3}$/;

export type QueryKind = "url" | "form" | "slug" | "mtm" | "part" | "feature" | "text";

export function formIdFromPath(rawPath: string): string | null {
  const segs = rawPath.replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "").split("/").filter(Boolean);
  for (const seg of segs) {
    const stem = seg.replace(/\.pdf$/i, "").split("-")[0] ?? "";
    const match = stem.match(FORM_RE);
    if (match) return `${match[1]!.toUpperCase()}${match[2]!}`;
    if (stem.toLowerCase() === "osig") return "OSIG";
  }
  return null;
}

export function slugFromPath(rawPath: string): string {
  const cleaned = rawPath.replace(/^https?:\/\/[^/]+/i, "").replace(/^\//, "").replace(/\.pdf$/i, "");
  const segs = cleaned.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? cleaned;
  return last;
}

export function documentUrl(formOrSlug: string): string {
  const trimmed = formOrSlug.replace(/^\//, "");
  return `${PRESS_ORIGIN}/${trimmed}`;
}

export function pdfUrl(formId: string): string {
  return `${PRESS_ORIGIN}/${formId.toLowerCase()}.pdf`;
}

export function classifyQuery(raw: string): { kind: QueryKind; value: string; formId: string | null } {
  const value = raw.trim();
  if (!value) return { kind: "text", value, formId: null };
  if (/^https?:\/\//i.test(value) || value.startsWith("lenovopress.")) {
    const url = value.startsWith("http") ? value : `https://${value}`;
    return { kind: "url", value: url, formId: formIdFromPath(url) };
  }
  const formMatch = value.match(FORM_RE);
  if (formMatch && !value.includes(" ") && value.length <= 16) {
    return { kind: "form", value: `${formMatch[1]!.toUpperCase()}${formMatch[2]!}`, formId: `${formMatch[1]!.toUpperCase()}${formMatch[2]!}` };
  }
  if (value.toLowerCase() === "osig") return { kind: "form", value: "OSIG", formId: "OSIG" };
  if (/^(lp|ds|tips|redp|sg)\d+-/i.test(value) && !value.includes(" ")) {
    return { kind: "slug", value: value.replace(/^\//, ""), formId: formIdFromPath(value) };
  }
  if (PART_RE.test(value)) return { kind: "part", value: value.toUpperCase(), formId: null };
  if (MTM_RE.test(value)) return { kind: "mtm", value: value.toUpperCase(), formId: null };
  if (FEATURE_RE.test(value) && value === value.toUpperCase()) {
    return { kind: "feature", value, formId: null };
  }
  return { kind: "text", value, formId: formIdFromPath(value) };
}

export function isPartNumber(value: string): boolean {
  return PART_RE.test(value.trim());
}

export function isFeatureCode(value: string): boolean {
  return FEATURE_RE.test(value.trim());
}

export function isMtm(value: string): boolean {
  return MTM_RE.test(value.trim());
}

export function extractParts(text: string): string[] {
  const found = text.match(/\b4[A-Z0-9]{8,}\b/gi) ?? [];
  return [...new Set(found.map((item) => item.toUpperCase()))];
}

export function machineTypeFromServer(server: string): string | null {
  const match = server.match(/\(([0-9][A-Z0-9]{3}(?:\/[0-9][A-Z0-9]{3})*)\)/i);
  if (!match?.[1]) return null;
  const first = match[1].split("/")[0];
  return first ? first.toUpperCase() : null;
}
