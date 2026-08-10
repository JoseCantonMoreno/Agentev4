import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitBranch, GitCommit, GitDiff, GitLog, GitStatus } from "./git-governance.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

describe("Git_Governance", () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-git-"));
    await git(workspacePath, ["init", "--initial-branch=main"]);
    await git(workspacePath, ["config", "user.email", "test@agentev4.local"]);
    await git(workspacePath, ["config", "user.name", "Agentev4 Test"]);
    await writeFile(join(workspacePath, "a.txt"), "contenido inicial", "utf8");
    await git(workspacePath, ["add", "a.txt"]);
    await git(workspacePath, ["commit", "-m", "inicial"]);
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("Git_Status refleja un archivo sin trackear", async () => {
    await writeFile(join(workspacePath, "b.txt"), "nuevo", "utf8");
    const status = await GitStatus.handler({ workspacePath });
    expect(status).toContain("b.txt");
  });

  it("Git_Diff muestra los cambios de un archivo modificado", async () => {
    await writeFile(join(workspacePath, "a.txt"), "contenido modificado", "utf8");
    const diff = await GitDiff.handler({ workspacePath, staged: false });
    expect(diff).toContain("contenido modificado");
  });

  it("Git_Commit hace add + commit de los archivos indicados", async () => {
    await writeFile(join(workspacePath, "c.txt"), "c", "utf8");
    const output = await GitCommit.handler({ workspacePath, message: "feat: c", files: ["c.txt"] });
    expect(output).toContain("feat: c");

    const log = await GitLog.handler({ workspacePath, maxCount: 5 });
    expect(log).toContain("feat: c");
  });

  it("Git_Branch lista ramas y puede crear una nueva", async () => {
    const list = await GitBranch.handler({ workspacePath });
    expect(list).toContain("main");

    await GitBranch.handler({ workspacePath, create: "feature-x" });
    const listAfter = await GitBranch.handler({ workspacePath });
    expect(listAfter).toContain("feature-x");
  });
});
