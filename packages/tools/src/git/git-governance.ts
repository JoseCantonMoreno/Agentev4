import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { defineTool } from "../registry.js";

const execFileAsync = promisify(execFile);

/** Comandos estructurados (array de args), nunca un string de shell libre. */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

const WorkspaceInput = z.object({ workspacePath: z.string() });

export const GitStatus = defineTool({
  name: "Git_Status",
  description: "Devuelve `git status --short --branch` del workspace.",
  inputSchema: WorkspaceInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath }) => git(workspacePath, ["status", "--short", "--branch"])
});

const DiffInput = z.object({ workspacePath: z.string(), staged: z.boolean().default(false) });

export const GitDiff = defineTool({
  name: "Git_Diff",
  description: "Devuelve `git diff` del workspace (o `git diff --staged` si `staged` es true).",
  inputSchema: DiffInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath, staged }) => git(workspacePath, staged ? ["diff", "--staged"] : ["diff"])
});

const CommitInput = z.object({
  workspacePath: z.string(),
  message: z.string().min(1),
  files: z.array(z.string()).min(1)
});

export const GitCommit = defineTool({
  name: "Git_Commit",
  description: "Hace `git add` de `files` y `git commit -m message` en el workspace.",
  inputSchema: CommitInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath, message, files }) => {
    await git(workspacePath, ["add", "--", ...files]);
    return git(workspacePath, ["commit", "-m", message]);
  }
});

const BranchInput = z.object({ workspacePath: z.string(), create: z.string().optional() });

export const GitBranch = defineTool({
  name: "Git_Branch",
  description: "Lista las ramas locales, o crea y cambia a una nueva rama si se pasa `create`.",
  inputSchema: BranchInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath, create }) =>
    create === undefined ? git(workspacePath, ["branch", "--list"]) : git(workspacePath, ["checkout", "-b", create])
});

const LogInput = z.object({ workspacePath: z.string(), maxCount: z.number().int().positive().default(10) });

export const GitLog = defineTool({
  name: "Git_Log",
  description: "Devuelve `git log --oneline -n maxCount` del workspace.",
  inputSchema: LogInput,
  outputSchema: z.string(),
  handler: async ({ workspacePath, maxCount }) => git(workspacePath, ["log", "--oneline", `-${maxCount}`])
});
