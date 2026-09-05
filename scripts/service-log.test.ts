import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  colourSupported,
  createLineReader,
  createServiceLogger,
  formatServiceLine,
} from "./service-log.ts";

const timestamp = new Date(2026, 8, 1, 9, 5, 3);

describe("service log formatting", () => {
  it("lines the message column up across tags of different lengths", () => {
    const line = (tag: string) =>
      formatServiceLine({
        colour: false,
        level: "info",
        message: "ready",
        tag,
        tagWidth: 11,
        timestamp,
      });
    expect(line("api")).toBe("09:05:03 api           ready");
    expect(line("replenisher")).toBe("09:05:03 replenisher   ready");
    // Reading down a column of five services only works if the column exists.
    expect(line("api").indexOf("ready")).toBe(
      line("replenisher").indexOf("ready"),
    );
  });

  it("marks a warning without relying on colour", () => {
    // Piped output, log files, and CI have no colour at all, so the level has
    // to survive as text.
    expect(
      formatServiceLine({
        colour: false,
        level: "warn",
        message: "treasury is exhausted",
        tag: "replenisher",
        tagWidth: 11,
        timestamp,
      }),
    ).toBe("09:05:03 replenisher ! treasury is exhausted");
  });

  it("keeps a tag's colour stable and paints warnings red", () => {
    const coloured = (tag: string, level: "info" | "warn") =>
      formatServiceLine({
        colour: true,
        level,
        message: "ready",
        tag,
        tagWidth: 8,
        timestamp,
      });
    // A colour that moved between runs would make the eye re-learn the layout
    // every restart.
    expect(coloured("api", "info")).toBe(coloured("api", "info"));
    expect(coloured("api", "info")).not.toBe(coloured("history", "info"));
    expect(coloured("api", "warn")).toContain("[31m");
  });
});

describe("service log line reassembly", () => {
  it("joins a line split across chunks and splits a chunk holding several", () => {
    const lines: string[] = [];
    const reader = createLineReader((line) => lines.push(line));
    reader.push("History indexed ");
    reader.push("through 46240529\nobserved head 46240531\n");
    // A pipe delivers bytes, not lines. Tagging each chunk would have put the
    // prefix in the middle of the first sentence.
    expect(lines).toEqual([
      "History indexed through 46240529",
      "observed head 46240531",
    ]);
  });

  it("emits a trailing partial line on flush and drops blank ones", () => {
    const lines: string[] = [];
    const reader = createLineReader((line) => lines.push(line));
    reader.push("\n\nworker ready");
    expect(lines).toEqual([]);
    // Without the flush, the last thing a dying child said would be lost.
    reader.flush();
    expect(lines).toEqual(["worker ready"]);
    reader.flush();
    expect(lines).toEqual(["worker ready"]);
  });

  it("does not leave a carriage return in the message", () => {
    const lines: string[] = [];
    createLineReader((line) => lines.push(line)).push("ready\r\n");
    expect(lines).toEqual(["ready"]);
  });
});

describe("service log colour detection", () => {
  it("stays plain wherever colour would be noise", () => {
    expect(colourSupported({}, true)).toBe(true);
    expect(colourSupported({}, false)).toBe(false);
    expect(colourSupported({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colourSupported({ CI: "true" }, true)).toBe(false);
    expect(colourSupported({ TERM: "dumb" }, true)).toBe(false);
  });
});

describe("service log attachment", () => {
  it("tags every line a child writes and flushes what it did not terminate", async () => {
    const written: string[] = [];
    const logger = createServiceLogger("funding", {
      colour: false,
      now: () => timestamp,
      tagWidth: 7,
      write: (line) => written.push(line),
    });
    const stream = new PassThrough();
    logger.attach(stream, "info");
    stream.write("worker ready at http://127.0.0.1:8790\n");
    stream.write("no terminator");
    stream.end();
    await new Promise((resolve) => stream.once("end", resolve));

    expect(written).toEqual([
      "09:05:03 funding   worker ready at http://127.0.0.1:8790",
      "09:05:03 funding   no terminator",
    ]);
  });

  it("ignores a child whose streams were inherited", () => {
    const logger = createServiceLogger("api", { colour: false });
    // Tests and standalone runs hand back children with no pipes; attaching to
    // them must not throw.
    expect(logger.attach(null, "info")).toBeUndefined();
  });
});
