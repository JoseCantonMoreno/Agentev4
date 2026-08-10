import { isAbsolute, relative, resolve } from "node:path";

export class PathEscapesWorkspaceError extends Error {
  constructor(requestedPath: string) {
    super(`La ruta "${requestedPath}" sale del workspace permitido.`);
    this.name = "PathEscapesWorkspaceError";
  }
}

/**
 * Resuelve `requestedPath` (relativo o absoluto) contra `workspacePath` y
 * rechaza cualquier resultado que caiga fuera de él (`../`, rutas absolutas
 * a otro disco, symlink-less traversal). Boundary de seguridad obligatorio
 * para toda tool de FileSystem: sin esto, un input como `../../.ssh/id_rsa`
 * escaparía del sandbox del workspace.
 */
export function resolveInWorkspace(workspacePath: string, requestedPath: string): string {
  const workspaceAbs = resolve(workspacePath);
  const resolved = resolve(workspaceAbs, requestedPath);
  const rel = relative(workspaceAbs, resolved);

  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new PathEscapesWorkspaceError(requestedPath);
  }

  return resolved;
}
