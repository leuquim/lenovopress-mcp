export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return this;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }
}
