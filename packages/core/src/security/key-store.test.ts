import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KeyStore } from "./key-store.js";

describe("KeyStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agentev4-keystore-"));
    filePath = join(dir, "keys.enc.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("set/get funcionan solo en RAM", () => {
    const store = new KeyStore();
    store.set("anthropic", "sk-ant-secreta");
    expect(store.get("anthropic")).toBe("sk-ant-secreta");
    expect(store.has("openai")).toBe(false);
  });

  it("persistToDisk sin confirmación explícita lanza y no escribe archivo", async () => {
    const store = new KeyStore();
    store.set("anthropic", "sk-ant-secreta");

    await expect(store.persistToDisk(filePath, "passphrase", false)).rejects.toThrow(
      "confirmación explícita"
    );
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("persistToDisk confirmado cifra: el archivo nunca contiene la clave en texto plano", async () => {
    const store = new KeyStore();
    store.set("anthropic", "sk-ant-super-secreta");

    await store.persistToDisk(filePath, "passphrase", true);

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain("sk-ant-super-secreta");
  });

  it("loadFromDisk descifra y recupera exactamente las claves originales", async () => {
    const store = new KeyStore();
    store.set("anthropic", "sk-ant-secreta");
    store.set("openai", "sk-oai-secreta");
    await store.persistToDisk(filePath, "passphrase", true);

    const loaded = await KeyStore.loadFromDisk(filePath, "passphrase");

    expect(loaded.get("anthropic")).toBe("sk-ant-secreta");
    expect(loaded.get("openai")).toBe("sk-oai-secreta");
  });

  it("loadFromDisk con passphrase incorrecta falla en vez de devolver datos corruptos", async () => {
    const store = new KeyStore();
    store.set("anthropic", "sk-ant-secreta");
    await store.persistToDisk(filePath, "passphrase-correcta", true);

    await expect(KeyStore.loadFromDisk(filePath, "passphrase-incorrecta")).rejects.toThrow();
  });
});
