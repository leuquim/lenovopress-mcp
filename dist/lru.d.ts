export declare class LruMap<K, V> {
    private readonly limit;
    private readonly entries;
    constructor(limit: number);
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    delete(key: K): boolean;
}
