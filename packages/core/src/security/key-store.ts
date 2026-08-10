import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

interface EncryptedPayload {
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

/**
 * Claves de proveedor LLM en RAM por defecto (Fase 10): se pierden al cerrar
 * el proceso salvo llamada explícita a `persistToDisk` con `confirmed: true`
 * (la confirmación del usuario ocurre en la UI de la Fase 11; este módulo
 * solo hace cumplir que nunca se persista sin ella).
 */
export class KeyStore {
  private readonly keys = new Map<string, string>();

  set(provider: string, apiKey: string): void {
    this.keys.set(provider, apiKey);
  }

  get(provider: string): string | undefined {
    return this.keys.get(provider);
  }

  has(provider: string): boolean {
    return this.keys.has(provider);
  }

  async persistToDisk(filePath: string, passphrase: string, confirmed: boolean): Promise<void> {
    if (!confirmed) {
      throw new Error("Persistencia en disco requiere confirmación explícita del usuario.");
    }

    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const derivedKey = scryptSync(passphrase, salt, KEY_LENGTH);
    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
    const plaintext = JSON.stringify(Object.fromEntries(this.keys));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    const payload: EncryptedPayload = {
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
    await writeFile(filePath, JSON.stringify(payload), "utf8");
  }

  static async loadFromDisk(filePath: string, passphrase: string): Promise<KeyStore> {
    const payload = JSON.parse(await readFile(filePath, "utf8")) as EncryptedPayload;
    const derivedKey = scryptSync(passphrase, Buffer.from(payload.salt, "base64"), KEY_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, derivedKey, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");

    const store = new KeyStore();
    for (const [provider, apiKey] of Object.entries(JSON.parse(plaintext) as Record<string, string>)) {
      store.set(provider, apiKey);
    }
    return store;
  }
}
