import { z } from "zod";
import { defineTool } from "../registry.js";
import { wrapUntrusted } from "../security/untrusted.js";

const FETCH_TIMEOUT_MS = 15_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WebScrapeInput = z.object({ url: z.string().url() });

/**
 * ponytail: fetcher simple sobre `fetch` nativo + strip de HTML por regex.
 * El Scrapling real (stealth fetchers, evasión anti-bot, JS rendering) es
 * una librería Python sin puerto TS maduro; subir de nivel (headless
 * browser, rotación de fingerprint) si un sitio concreto empieza a
 * bloquear este fetcher.
 */
export const WebScrape = defineTool({
  name: "Web_Scrape",
  description: "Descarga una URL y devuelve su texto (HTML sin etiquetas), envuelto como untrusted data.",
  inputSchema: WebScrapeInput,
  outputSchema: z.string(),
  handler: async ({ url }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const html = await response.text();
      return wrapUntrusted(stripHtml(html), `scrape:${url}`);
    } finally {
      clearTimeout(timer);
    }
  }
});
