import type { Readable } from "node:stream";

/**
 * Five children write to one terminal under `pnpm backend`, and they all wrote
 * straight through with no attribution: reading which service said what meant
 * recognising its prose. Every line is now tagged with the service that
 * produced it and the moment it arrived, and a line arriving in two chunks
 * stays one line.
 */
export type LogLevel = "info" | "warn";

export interface ServiceLogOptions {
  readonly colour?: boolean;
  readonly now?: () => Date;
  readonly tagWidth?: number;
  readonly write?: (line: string) => void;
}

const RESET = "\u001B[0m";
const DIM = "\u001B[2m";
const RED = "\u001B[31m";

/**
 * Fixed, small, and stable per tag so a service keeps the same colour across
 * restarts. A random or rotating assignment would make the eye re-learn the
 * layout every run.
 */
const TAG_COLOURS = [
  "\u001B[36m",
  "\u001B[35m",
  "\u001B[32m",
  "\u001B[33m",
  "\u001B[34m",
] as const;

const tagColour = (tag: string): string => {
  const total = [...tag].reduce(
    (accumulator, character) => accumulator + character.codePointAt(0)!,
    0,
  );
  return TAG_COLOURS[total % TAG_COLOURS.length]!;
};

const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + " ".repeat(width - value.length);

const clock = (timestamp: Date): string =>
  [timestamp.getHours(), timestamp.getMinutes(), timestamp.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

export const formatServiceLine = (input: {
  readonly colour: boolean;
  readonly level: LogLevel;
  readonly message: string;
  readonly tag: string;
  readonly tagWidth: number;
  readonly timestamp: Date;
}): string => {
  const time = clock(input.timestamp);
  const tag = pad(input.tag, input.tagWidth);
  if (!input.colour) {
    // The level has to survive a pipe, a log file, and CI, where colour does
    // not exist at all.
    return input.level === "warn"
      ? `${time} ${tag} ! ${input.message}`
      : `${time} ${tag}   ${input.message}`;
  }
  const colour = input.level === "warn" ? RED : tagColour(input.tag);
  const marker = input.level === "warn" ? `${RED}!${RESET}` : " ";
  return `${DIM}${time}${RESET} ${colour}${tag}${RESET} ${marker} ${input.message}`;
};

/**
 * A pipe delivers bytes, not lines: a single write can arrive split across two
 * chunks, and two writes can arrive in one. Reassemble before tagging, or the
 * prefix lands in the middle of somebody's sentence.
 */
export const createLineReader = (
  emit: (line: string) => void,
): {
  readonly push: (chunk: string) => void;
  readonly flush: () => void;
} => {
  let pending = "";
  return {
    flush: () => {
      const remainder = pending.trimEnd();
      pending = "";
      if (remainder.length > 0) emit(remainder);
    },
    push: (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed.length > 0) emit(trimmed);
      }
    },
  };
};

export const colourSupported = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
  isTty: boolean = process.stdout.isTTY === true,
): boolean =>
  isTty &&
  environment.NO_COLOR === undefined &&
  environment.CI === undefined &&
  environment.TERM !== "dumb";

export interface ServiceLogger {
  readonly log: (level: LogLevel, message: string) => void;
  /** Tags every line a child writes, and flushes a partial line on exit. */
  readonly attach: (
    stream: Readable | null,
    level: LogLevel,
  ) => (() => void) | undefined;
}

export const createServiceLogger = (
  tag: string,
  options: ServiceLogOptions = {},
): ServiceLogger => {
  const colour = options.colour ?? colourSupported();
  const now = options.now ?? (() => new Date());
  const tagWidth = options.tagWidth ?? tag.length;
  const write =
    options.write ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });
  const log = (level: LogLevel, message: string): void => {
    write(
      formatServiceLine({
        colour,
        level,
        message,
        tag,
        tagWidth,
        timestamp: now(),
      }),
    );
  };
  return {
    attach: (stream, level) => {
      if (stream === null) return undefined;
      const reader = createLineReader((line) => log(level, line));
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => reader.push(chunk));
      stream.on("end", () => reader.flush());
      return reader.flush;
    },
    log,
  };
};
