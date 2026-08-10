import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDoneCondition } from "./done-condition.js";

describe("checkDoneCondition", () => {
  let workspacePath: string;
  let agenteDir: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "agentev4-done-"));
    agenteDir = join(workspacePath, ".agente");
    await mkdir(agenteDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("pending si no existe ningún archivo de condición", async () => {
    await rm(agenteDir, { recursive: true, force: true });
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: false, source: "none" });
  });

  it("lee prd.json con status done", async () => {
    await writeFile(join(agenteDir, "prd.json"), JSON.stringify({ status: "done" }), "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: true, source: "prd.json" });
  });

  it("lee prd.json con status pendiente", async () => {
    await writeFile(join(agenteDir, "prd.json"), JSON.stringify({ status: "in_progress" }), "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: false, source: "prd.json" });
  });

  it("prd.json tiene prioridad sobre progress.txt", async () => {
    await writeFile(join(agenteDir, "prd.json"), JSON.stringify({ status: "in_progress" }), "utf8");
    await writeFile(join(agenteDir, "progress.txt"), "DONE\n", "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: false, source: "prd.json" });
  });

  it("lee progress.txt con marcador DONE", async () => {
    await writeFile(join(agenteDir, "progress.txt"), "empezando...\nDONE\n", "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: true, source: "progress.txt" });
  });

  it("progress.txt sin marcador DONE es pendiente", async () => {
    await writeFile(join(agenteDir, "progress.txt"), "todavía trabajando\n", "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: false, source: "progress.txt" });
  });

  it("plan.md sin checkboxes pendientes cuenta como done", async () => {
    await writeFile(join(agenteDir, "plan.md"), "- [x] paso 1\n- [x] paso 2\n", "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: true, source: "plan.md" });
  });

  it("plan.md con checkboxes pendientes no está done", async () => {
    await writeFile(join(agenteDir, "plan.md"), "- [x] paso 1\n- [ ] paso 2\n", "utf8");
    expect(await checkDoneCondition(workspacePath)).toEqual({ done: false, source: "plan.md" });
  });
});
