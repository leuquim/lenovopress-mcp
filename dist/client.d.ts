import { type RuntimeConfig } from "./config.js";
export declare const FETCH_SOURCES: readonly ["fixture", "cache", "network"];
export type FetchSource = typeof FETCH_SOURCES[number];
export interface Fetched {
    url: string;
    method: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    source: FetchSource;
    retrievedAt: string;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export declare class PressClient {
    private readonly config;
    private readonly fetchImpl;
    private readonly memory;
    private readonly pending;
    constructor(config: RuntimeConfig, fetchImpl?: FetchLike);
    getText(urlPath: string, refresh?: boolean | undefined): Promise<Fetched>;
    head(urlPath: string, refresh?: boolean | undefined): Promise<Fetched>;
    postForm(urlPath: string, fields: Record<string, string | number>, refresh?: boolean | undefined): Promise<Fetched>;
    private request;
    private requestUncached;
    private readFixture;
    private readCache;
    private writeCache;
    private remember;
    private network;
}
export declare function asCached<T extends {
    source: FetchSource;
}>(value: T): Omit<T, "source"> & {
    source: FetchSource;
};
export declare function matchFixture(method: string, url: string, body?: string): string | null;
