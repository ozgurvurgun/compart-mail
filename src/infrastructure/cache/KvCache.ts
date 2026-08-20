export class KvCache {
  constructor(private readonly kv: KVNamespace) {}

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async putJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const ttl = Math.max(60, Math.floor(ttlSeconds));
    await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }
}
