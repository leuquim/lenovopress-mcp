export class LruMap {
    limit;
    entries = new Map();
    constructor(limit) {
        this.limit = limit;
    }
    get(key) {
        const value = this.entries.get(key);
        if (value === undefined)
            return undefined;
        this.entries.delete(key);
        this.entries.set(key, value);
        return value;
    }
    set(key, value) {
        this.entries.delete(key);
        this.entries.set(key, value);
        if (this.entries.size > this.limit)
            this.entries.delete(this.entries.keys().next().value);
        return this;
    }
    delete(key) {
        return this.entries.delete(key);
    }
}
//# sourceMappingURL=lru.js.map