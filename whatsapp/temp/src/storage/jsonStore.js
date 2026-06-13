import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { catalogSeed } from "../catalog/seed.js";

const emptyStore = {
  customers: [],
  orders: [],
  payments: [],
  paymentScreenshots: [],
  feedback: [],
  whatsappConversations: [],
  menuCategories: catalogSeed.categories,
  menuItems: catalogSeed.items
};

export class JsonStore {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return hydrate(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.write(emptyStore);
      return structuredClone(emptyStore);
    }
  }

  async write(data) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload = JSON.stringify(hydrate(data), null, 2);
    this.writeQueue = this.writeQueue.then(() => writeFile(this.filePath, payload, "utf8"));
    return this.writeQueue;
  }

  async update(mutator) {
    const data = await this.read();
    const result = await mutator(data);
    await this.write(data);
    return result;
  }
}

function hydrate(data) {
  return {
    ...structuredClone(emptyStore),
    ...data,
    menuCategories: data.menuCategories?.length ? data.menuCategories : catalogSeed.categories,
    menuItems: data.menuItems?.length ? data.menuItems : catalogSeed.items
  };
}
