import { describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@agentev4/shared";
import { PermissionEngine, type CanUseTool, type PermissionDecision } from "./permission-engine.js";

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: "c1", name, input };
}

function spyCanUseTool(decision: PermissionDecision): CanUseTool {
  return vi.fn(async () => decision);
}

const ALLOW: PermissionDecision = { behavior: "allow" };
const DENY: PermissionDecision = { behavior: "deny", message: "no" };

describe("PermissionEngine — orden de evaluación", () => {
  it("una regla deny bloquea sin llegar nunca al callback HITL", async () => {
    const canUseTool = spyCanUseTool(ALLOW);
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool,
      rules: { deny: ["Bash(rm *)"] }
    });

    const result = await engine.evaluate(call("Bash", { command: "rm -rf /tmp" }));

    expect(result.behavior).toBe("deny");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("una tool en la allow-list nunca pide confirmación", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool,
      rules: { allow: ["Read"] }
    });

    const result = await engine.evaluate(call("Read", { path: "/tmp/a.txt" }));

    expect(result.behavior).toBe("allow");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("deny gana sobre ask y allow cuando las tres reglas matchean la misma tool", async () => {
    const canUseTool = spyCanUseTool(ALLOW);
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool,
      rules: { deny: ["Bash"], ask: ["Bash"], allow: ["Bash"] }
    });

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(result.behavior).toBe("deny");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("ask gana sobre allow: fuerza HITL aunque la tool también esté en la allow-list", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool,
      rules: { ask: ["Bash"], allow: ["Bash"] }
    });

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(canUseTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual(DENY);
  });

  it("un hook Pre-ToolUse corta el pipeline antes de evaluar deny", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool,
      hooks: [async () => ALLOW],
      rules: { deny: ["Bash"] }
    });

    const result = await engine.evaluate(call("Bash", { command: "rm -rf /" }));

    expect(result).toEqual(ALLOW);
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("un hook que devuelve undefined deja pasar al resto del pipeline", async () => {
    const canUseTool = spyCanUseTool(ALLOW);
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool,
      hooks: [async () => undefined],
      rules: { deny: ["Bash"] }
    });

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(result.behavior).toBe("deny");
    expect(canUseTool).not.toHaveBeenCalled();
  });
});

describe("PermissionEngine — modos de permiso", () => {
  it("plan permite tools de solo lectura sin pedir confirmación", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({ mode: "plan", canUseTool });

    const result = await engine.evaluate(call("FileSystem_Read", { path: "/a" }));

    expect(result.behavior).toBe("allow");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("plan deniega tools mutables sin pedir confirmación", async () => {
    const canUseTool = spyCanUseTool(ALLOW);
    const engine = new PermissionEngine({ mode: "plan", canUseTool });

    const result = await engine.evaluate(call("FileSystem_Write", { path: "/a" }));

    expect(result.behavior).toBe("deny");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("acceptEdits aprueba tools de edición automáticamente", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({ mode: "acceptEdits", canUseTool });

    const result = await engine.evaluate(call("Edit_Lines", { path: "/a" }));

    expect(result.behavior).toBe("allow");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("bypassPermissions ignora incluso una regla deny", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({
      mode: "bypassPermissions",
      canUseTool,
      rules: { deny: ["Bash"] }
    });

    const result = await engine.evaluate(call("Bash", { command: "rm -rf /" }));

    expect(result.behavior).toBe("allow");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("dontAsk deniega en fail-closed lo que no esté explícitamente permitido", async () => {
    const canUseTool = spyCanUseTool(ALLOW);
    const engine = new PermissionEngine({ mode: "dontAsk", canUseTool });

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(result.behavior).toBe("deny");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("auto aprueba en fail-open lo que no esté resuelto por reglas previas", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({ mode: "auto", canUseTool });

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(result.behavior).toBe("allow");
    expect(canUseTool).not.toHaveBeenCalled();
  });

  it("default sin reglas cae al callback HITL como último recurso", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({ mode: "default", canUseTool });

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(canUseTool).toHaveBeenCalledTimes(1);
    expect(result).toEqual(DENY);
  });

  it("setMode cambia el modo activo en caliente", async () => {
    const canUseTool = spyCanUseTool(DENY);
    const engine = new PermissionEngine({ mode: "dontAsk", canUseTool });
    engine.setMode("auto");

    const result = await engine.evaluate(call("Bash", { command: "ls" }));

    expect(result.behavior).toBe("allow");
  });
});

describe("PermissionEngine — sintaxis de reglas con scoping", () => {
  it("Bash(rm *) matchea por prefijo de comando", async () => {
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool: spyCanUseTool(ALLOW),
      rules: { deny: ["Bash(rm *)"] }
    });

    const blocked = await engine.evaluate(call("Bash", { command: "rm -rf /tmp" }));
    const passed = await engine.evaluate(call("Bash", { command: "ls -la" }));

    expect(blocked.behavior).toBe("deny");
    expect(passed.behavior).not.toBe("deny");
  });

  it("Edit(/secrets/**) matchea por prefijo de ruta", async () => {
    const engine = new PermissionEngine({
      mode: "default",
      canUseTool: spyCanUseTool(ALLOW),
      rules: { deny: ["Edit(/secrets/**)"] }
    });

    const blocked = await engine.evaluate(call("Edit", { path: "/secrets/keys.txt" }));
    const passed = await engine.evaluate(call("Edit", { path: "/src/index.ts" }));

    expect(blocked.behavior).toBe("deny");
    expect(passed.behavior).not.toBe("deny");
  });
});
