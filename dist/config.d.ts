export declare const PRESS_ORIGIN = "https://lenovopress.lenovo.com";
export declare const MAX_RESULT_BYTES = 1500000;
export declare const MAX_SECTION_BYTES = 80000;
export declare const MAX_COMPARE_DOCS = 4;
export declare const MAX_FIND_PART_DOCS = 10;
export declare const DEFAULT_SEARCH_LIMIT = 10;
export declare const MAX_SEARCH_LIMIT = 25;
export declare const DEFAULT_OSIG_LIMIT = 50;
export declare const MAX_OSIG_LIMIT = 100;
export declare const PARSED_CACHE_SIZE = 24;
export declare const MEMORY_CACHE_SIZE = 32;
export declare const RESOURCE_TYPES: readonly ["article", "comparison-reference", "datasheet", "interactive-3d-tour", "lenovo-validated-design", "performance-benchmark-result", "planning-implementation", "positioning-information", "product-guide", "reference-architecture", "reference-information", "solution-brief", "study-guide", "tool", "video"];
export declare const BROWSE_CATEGORIES: readonly ["servers/ai-servers", "servers/rack-scale", "servers/dense", "servers/multinode", "servers/options/gpu", "servers/options/infiniband", "servers/options/ethernet", "networking/infiniband-switches", "networking/ethernet-switches", "servers/benchmarks/mlperf", "servers/benchmarks/spechpc", "servers/benchmarks/specmpi"];
export interface RuntimeConfig {
    cacheDir: string;
    fixtureDir: string | null;
    requestTimeoutMs: number;
    offline: boolean;
}
export declare function getRuntimeConfig(env?: NodeJS.ProcessEnv): RuntimeConfig;
