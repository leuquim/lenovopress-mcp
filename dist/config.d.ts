export declare const PRESS_ORIGIN = "https://lenovopress.lenovo.com";
export declare const MAX_RESULT_BYTES = 1500000;
export declare const MAX_SECTION_BYTES = 80000;
export declare const DEFAULT_SEARCH_LIMIT = 10;
export declare const MAX_SEARCH_LIMIT = 25;
export declare const DEFAULT_OSIG_LIMIT = 50;
export declare const MAX_OSIG_LIMIT = 100;
export declare const DEFAULT_RATE_LIMIT_MS = 60000;
export interface RuntimeConfig {
    projectRoot: string;
    cacheDir: string;
    fixtureDir: string | null;
    rateLimitMs: number;
    requestTimeoutMs: number;
    offline: boolean;
}
export declare function getRuntimeConfig(env?: NodeJS.ProcessEnv): RuntimeConfig;
