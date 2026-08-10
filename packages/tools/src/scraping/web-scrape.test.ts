import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebScrape } from "./web-scrape.js";

describe("Web_Scrape", () => {
  let baseUrl: string;
  let close: () => void;

  beforeAll(async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><script>evil()</script><h1>Titulo</h1><p>Texto plano</p></body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    close = () => server.close();
  });

  afterAll(() => close());

  it("descarga la URL, quita etiquetas/scripts y envuelve el resultado como untrusted", async () => {
    const result = await WebScrape.handler({ url: baseUrl });

    expect(result).toContain(`<untrusted_data source="scrape:${baseUrl}">`);
    expect(result).toContain("Titulo");
    expect(result).toContain("Texto plano");
    expect(result).not.toContain("evil()");
    expect(result).not.toContain("<h1>");
  });
});
