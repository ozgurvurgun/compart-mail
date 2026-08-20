import type { ObjectStore } from "../../application/ports";

export class R2ObjectStore implements ObjectStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, data: ArrayBuffer | string, contentType: string): Promise<void> {
    await this.bucket.put(key, data, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return object.arrayBuffer();
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      const keys = (page.objects ?? []).map((object) => object.key);
      await Promise.all(keys.map((key) => this.bucket.delete(key)));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}
