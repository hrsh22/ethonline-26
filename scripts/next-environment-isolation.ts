import fileSystem from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const applicationDirectory = resolve(process.cwd());
const nextEnvironmentFile = /^\.env(?:\.|$)/u;
const reportedEnvironmentFiles = new Set<string>();

const resolvedFileSystemPath = (candidate: unknown): string | undefined => {
  try {
    if (typeof candidate === "string") return resolve(candidate);
    if (candidate instanceof URL) return resolve(fileURLToPath(candidate));
    if (Buffer.isBuffer(candidate)) return resolve(candidate.toString("utf8"));
    return undefined;
  } catch {
    return undefined;
  }
};

const isUncheckedNextEnvironmentFile = (candidate: unknown): boolean => {
  const path = resolvedFileSystemPath(candidate);
  if (path === undefined || dirname(path) !== applicationDirectory)
    return false;
  const name = basename(path);
  return name !== ".env.example" && nextEnvironmentFile.test(name);
};

const missingEnvironmentFile = (candidate: unknown): NodeJS.ErrnoException => {
  const path =
    resolvedFileSystemPath(candidate) ?? "unchecked Next environment file";
  const cause = new Error(
    `ENOENT: no such file or directory, open '${path}'`,
  ) as NodeJS.ErrnoException;
  cause.code = "ENOENT";
  cause.errno = -2;
  cause.path = path;
  cause.syscall = "open";
  return cause;
};

const guardReadOperation = (owner: object, name: string): void => {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (descriptor === undefined || typeof descriptor.value !== "function") {
    throw new Error(`Node.js filesystem operation ${name} is unavailable`);
  }
  const operation = descriptor.value as (
    ...arguments_: readonly unknown[]
  ) => unknown;
  Object.defineProperty(owner, name, {
    ...descriptor,
    value: function guardedEnvironmentRead(
      this: unknown,
      ...arguments_: readonly unknown[]
    ): unknown {
      if (isUncheckedNextEnvironmentFile(arguments_[0])) {
        const path = resolvedFileSystemPath(arguments_[0]);
        const name = path === undefined ? ".env*" : basename(path);
        if (!reportedEnvironmentFiles.has(name)) {
          reportedEnvironmentFiles.add(name);
          console.error(
            `Blocked unchecked Next.js environment file read: ${name}`,
          );
        }
        throw missingEnvironmentFile(arguments_[0]);
      }
      return Reflect.apply(operation, this, arguments_);
    },
  });
};

for (const name of [
  "createReadStream",
  "open",
  "openSync",
  "readFile",
  "readFileSync",
] as const) {
  guardReadOperation(fileSystem, name);
}
for (const name of ["open", "readFile"] as const) {
  guardReadOperation(fileSystem.promises, name);
}
syncBuiltinESMExports();
