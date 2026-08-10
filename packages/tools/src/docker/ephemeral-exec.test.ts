import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { DockerUnavailableError, runEphemeral } from "./ephemeral-exec.js";

const execFileAsync = promisify(execFile);

/** DoD Fase 4: ningún contenedor efímero sobrevive al proceso padre. */
async function containerExists(name: string): Promise<boolean> {
  const { stdout } = await execFileAsync("docker", [
    "ps",
    "-a",
    "--filter",
    `name=^/${name}$`,
    "--format",
    "{{.Names}}"
  ]);
  return stdout.trim().length > 0;
}

describe("runEphemeral", () => {
  it(
    "ejecuta un comando normal y devuelve su stdout",
    async () => {
      const result = await runEphemeral("echo hola-agentev4", { workspacePath: process.cwd() });

      expect(result.stdout.trim()).toBe("hola-agentev4");
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      await expect(containerExists(result.containerName)).resolves.toBe(false);
    },
    60_000
  );

  it(
    "un comando que excede timeoutMs se marca timedOut y el contenedor se destruye",
    async () => {
      const result = await runEphemeral("sleep 5", {
        workspacePath: process.cwd(),
        timeoutMs: 500
      });

      expect(result.timedOut).toBe(true);
      await expect(containerExists(result.containerName)).resolves.toBe(false);
    },
    60_000
  );

  it(
    "un proceso que ignora SIGTERM igualmente se destruye vía SIGKILL",
    async () => {
      const result = await runEphemeral("trap '' TERM; sleep 30", {
        workspacePath: process.cwd(),
        timeoutMs: 500
      });

      expect(result.timedOut).toBe(true);
      await expect(containerExists(result.containerName)).resolves.toBe(false);
    },
    60_000
  );

  it("falla explícitamente si el daemon Docker no responde, sin degradar en silencio", async () => {
    await expect(
      runEphemeral("echo no-deberia-ejecutarse", {
        workspacePath: process.cwd(),
        dockerHost: "tcp://127.0.0.1:1"
      })
    ).rejects.toThrow(DockerUnavailableError);
  });
});
