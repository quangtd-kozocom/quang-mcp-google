import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { LOCAL_FILE_ROOT_ENV } from "../config/constants.js";

const disabledMessage =
  `Local file access is disabled. Set ${LOCAL_FILE_ROOT_ENV} to a directory, ` +
  "then keep local_path/save_path inside it.";

export function isPathInsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

async function localFileRoot(): Promise<string> {
  const root = process.env[LOCAL_FILE_ROOT_ENV];
  if (!root) throw new Error(disabledMessage);
  return realpath(root);
}

function candidatePath(root: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(join(root, path));
}

function assertInside(path: string, root: string): void {
  if (!isPathInsideRoot(path, root)) {
    throw new Error(`Local file path is outside ${LOCAL_FILE_ROOT_ENV}: ${path}`);
  }
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function safeReadPath(path: string): Promise<string> {
  const root = await localFileRoot();
  const resolved = await realpath(candidatePath(root, path));
  assertInside(resolved, root);
  return resolved;
}

export async function safeWritePath(path: string): Promise<string> {
  const root = await localFileRoot();
  const candidate = candidatePath(root, path);
  try {
    const existing = await realpath(candidate);
    assertInside(existing, root);
    return existing;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const parent = await realpath(dirname(candidate));
  const resolved = resolve(parent, basename(candidate));
  assertInside(resolved, root);
  return resolved;
}
