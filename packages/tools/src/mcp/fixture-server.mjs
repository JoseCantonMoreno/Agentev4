// ponytail: JS plano (no TS) a propósito -- es un servidor MCP desechable
// que solo existe para el test de integración de loadMcpConnections /
// createMcpToolRegistry (spawn real por stdio, no un mock del SDK), igual
// que concurrency-worker.mjs hace con worker_threads para SQLite.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "agentev4-fixture", version: "0.0.0" });

server.registerTool(
  "Echo",
  {
    description: "Devuelve el texto recibido, para verificar el round-trip MCP end-to-end.",
    inputSchema: { text: z.string() }
  },
  async ({ text }) => ({ content: [{ type: "text", text }] })
);

server.registerTool(
  "Boom",
  {
    description: "Siempre falla, para verificar que isError del servidor MCP se propaga.",
    inputSchema: { text: z.string() }
  },
  async () => ({ content: [{ type: "text", text: "kaboom" }], isError: true })
);

await server.connect(new StdioServerTransport());
