import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_IMAGE = "alpine:3.20";
const DEFAULT_TIMEOUT_MS = 120_000;
const DAEMON_PREFLIGHT_TIMEOUT_MS = 5_000;

export class DockerUnavailableError extends Error {
  constructor(cause: string) {
    super(`El daemon de Docker no responde: ${cause}`);
    this.name = "DockerUnavailableError";
  }
}

export interface EphemeralExecOptions {
  /** Ruta absoluta del workspace activo, montada en `/workspace` dentro del contenedor. */
  workspacePath: string;
  image?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** ponytail: solo para tests — fuerza el DOCKER_HOST usado por el preflight y el `docker run`. */
  dockerHost?: string;
}

export interface EphemeralExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Nombre del contenedor efímero, útil para auditoría o verificación externa (`docker ps`). */
  containerName: string;
}

function dockerEnv(dockerHost: string | undefined): NodeJS.ProcessEnv {
  return dockerHost === undefined ? process.env : { ...process.env, DOCKER_HOST: dockerHost };
}

/**
 * Falla explícita si el daemon Docker no responde: nunca degradar en silencio
 * a ejecución sin sandbox (ver Errores #02 de la vault).
 */
async function assertDockerAvailable(dockerHost: string | undefined): Promise<void> {
  try {
    await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], {
      env: dockerEnv(dockerHost),
      timeout: DAEMON_PREFLIGHT_TIMEOUT_MS
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DockerUnavailableError(message);
  }
}

async function forceRemove(containerName: string, dockerHost: string | undefined): Promise<void> {
  try {
    await execFileAsync("docker", ["rm", "--force", containerName], { env: dockerEnv(dockerHost) });
  } catch {
    // ya no existe (--rm del propio `docker run` lo limpió primero): no es un error.
  }
}

/**
 * Ejecuta `cmd` en un contenedor Docker efímero (`--rm`) con el workspace
 * activo montado en `/workspace`. Si el comando se cuelga o excede
 * `timeoutMs`, se fuerza `docker kill` (SIGKILL, no interceptable) seguido de
 * `docker rm --force` como red de seguridad: ningún contenedor sobrevive a
 * esta función, ni siquiera uno que ignore SIGTERM.
 */
export async function runEphemeral(
  cmd: string,
  opts: EphemeralExecOptions
): Promise<EphemeralExecResult> {
  await assertDockerAvailable(opts.dockerHost);

  const containerName = `agentev4-eph-${randomUUID()}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const image = opts.image ?? DEFAULT_IMAGE;
  const envFlags = Object.entries(opts.env ?? {}).flatMap(([key, value]) => ["-e", `${key}=${value}`]);

  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "-v",
    `${opts.workspacePath}:/workspace`,
    "-w",
    "/workspace",
    ...envFlags,
    image,
    "sh",
    "-c",
    cmd
  ];

  const child = spawn("docker", args, { env: dockerEnv(opts.dockerHost) });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));

  const exitCode = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      void execFileAsync("docker", ["kill", containerName], { env: dockerEnv(opts.dockerHost) }).catch(
        () => undefined
      );
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  await forceRemove(containerName, opts.dockerHost);

  return { stdout, stderr, exitCode, timedOut, containerName };
}
