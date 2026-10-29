import { type RuntimeConfig } from "./config.js";
export interface Fetched {
    url: string;
    method: string;
    status: number;
    headers: Record<string, string>;
    body: string;
    source: "fixture" | "cache" | "network";
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export declare class PressClient {
    private readonly config;
    private readonly fetchImpl;
    private lastNetworkAt;
    private readonly memory;
    constructor(config: RuntimeConfig, fetchImpl?: FetchLike);
    getText(urlPath: string): Promise<Fetched>;
    head(urlPath: string): Promise<Fetched>;
    postForm(urlPath: string, fields: Record<string, string | number>): Promise<Fetched>;
    request(method: string, urlPath: string, body?: string, contentType?: string): Promise<Fetched>;
    private readFixture;
    private readCache;
    private writeCache;
    private throttle;
    private network;
}
export declare function matchFixture(method: string, url: string, body?: string): string | null;
