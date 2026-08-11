import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface ShellCapability {
  identifier: string;
  allow?: Array<{ name: string; cmd: string; args: unknown }>;
}

const capability = JSON.parse(
  readFileSync(fileURLToPath(new URL("./default.json", import.meta.url)), "utf8")
) as { permissions: Array<string | ShellCapability> };

describe("desktop shell capability", () => {
  it("allows spawning node only with the exact agent-server entry argument", () => {
    const spawn = capability.permissions.find(
      (permission): permission is ShellCapability =>
        typeof permission === "object" && permission.identifier === "shell:allow-spawn"
    );

    expect(spawn?.allow).toEqual([
      {
        name: "node",
        cmd: "node",
        args: ["../server/dist/index.js"]
      }
    ]);
    expect(spawn?.allow?.[0]?.args).not.toBe(true);
  });

  it("does not grant execute, kill, or wildcard shell permissions", () => {
    expect(capability.permissions).not.toContain("shell:allow-execute");
    expect(capability.permissions).not.toContain("shell:allow-kill");
    expect(JSON.stringify(capability)).not.toContain('"args":true');
    expect(JSON.stringify(capability)).not.toContain("*");
  });
});
