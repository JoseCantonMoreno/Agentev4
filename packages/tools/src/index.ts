import { EditLines } from "./filesystem/edit-lines.js";
import {
  FileSystemDelete,
  FileSystemMove,
  FileSystemRead,
  FileSystemSearch,
  FileSystemWrite
} from "./filesystem/filesystem-tools.js";
import { GitBranch, GitCommit, GitDiff, GitLog, GitStatus } from "./git/git-governance.js";
import type { ToolRegistry } from "./registry.js";
import { WebScrape } from "./scraping/web-scrape.js";
import { ContextInspector } from "./context/context-inspector.js";
import { SessionCheckpointLoad, SessionCheckpointSave } from "./session/session-checkpoint.js";

export * from "./docker/ephemeral-exec.js";
export * from "./registry.js";
export * from "./security/untrusted.js";
export * from "./filesystem/path-guard.js";
export * from "./filesystem/filesystem-tools.js";
export * from "./filesystem/edit-lines.js";
export * from "./git/git-governance.js";
export * from "./scraping/web-scrape.js";
export * from "./context/context-inspector.js";
export * from "./session/session-checkpoint.js";
export * from "./mcp/mcp-bridge.js";

/**
 * Registro estático de Fase 5 (todo excepto las tools MCP, que se descubren
 * en runtime por servidor vía `loadMcpConnections`). Listo para inyectarse
 * como `executeTool` en `runAgenticLoop` (Fase 2) a través de
 * `executeRegisteredTool`.
 */
export function createStaticToolRegistry(): ToolRegistry {
  const tools = [
    FileSystemRead,
    FileSystemWrite,
    FileSystemDelete,
    FileSystemMove,
    FileSystemSearch,
    EditLines,
    GitStatus,
    GitDiff,
    GitCommit,
    GitBranch,
    GitLog,
    WebScrape,
    ContextInspector,
    SessionCheckpointSave,
    SessionCheckpointLoad
  ];
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}
