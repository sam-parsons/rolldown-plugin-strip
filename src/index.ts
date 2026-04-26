import remapping, { type SourceMapInput } from "@jridgewell/remapping";
import MagicString from "magic-string";

/**
 * When a configured call matches a line but the line is not only that call
 * (e.g. `fn().chain()`), stripping would break runtime. This policy controls
 * that case. Default at runtime is `"skip"` when the option is omitted.
 */
export type ChainedCallsPolicy = "skip" | "warn" | "error";

export interface StripOptions {
  functions?: string[];
  debugger?: boolean;
  labels?: string[];
  chainedCalls?: ChainedCallsPolicy;
}

// Virtual filename linking the removal-stage map to the LF-normalization map in `remapping` (not a real path).
const STRIP_INTERMEDIATE = "\0rolldown-plugin-strip/intermediate";

export type StripTransformMap = ReturnType<MagicString["generateMap"]> | ReturnType<typeof remapping>;

export interface StripPlugin {
  name: "rolldown-plugin-strip";
  apply: "build";
  enforce: "pre";
  transform: (code: string, id: string) => null | { code: string; map: StripTransformMap | null };
}

function stripDebuggerStatements(code: string): string {
  // Remove full lines that only contain a debugger statement.
  return code.replace(/^[ \t]*debugger\s*;?[ \t]*\r?\n?/gm, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns index of the `)` that closes the `(` at `openParenIndex`, or -1.
 * Does not parse strings; sufficient for typical strip targets on one line.
 */
function findClosingParen(line: string, openParenIndex: number): number {
  let depth = 0;
  for (let i = openParenIndex; i < line.length; i += 1) {
    const currentChar = line[i];
    if (currentChar === "(") {
      depth += 1;
    } else if (currentChar === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Checks whether a line starts with a configured function call and whether
 * that call is a whole removable statement.
 */
function analyzeCallExpressionLine(line: string, fn: string): { matched: boolean; safeRemove: boolean } {
  // Leading indentation only; the call must start immediately after it.
  const leadingWhitespaceMatch = /^[ \t]*/.exec(line);
  const leadingWhitespaceLength = leadingWhitespaceMatch ? leadingWhitespaceMatch[0].length : 0;
  if (!line.startsWith(fn, leadingWhitespaceLength)) {
    return { matched: false, safeRemove: false };
  }

  // A call expression must begin with `fn(` for the configured name `fn`.
  const openingParenIndex = leadingWhitespaceLength + fn.length;
  if (line[openingParenIndex] !== "(") {
    return { matched: false, safeRemove: false };
  }

  // Walk parentheses so nested calls inside arguments do not confuse the end.
  const closingParenIndex = findClosingParen(line, openingParenIndex);
  if (closingParenIndex === -1) {
    return { matched: true, safeRemove: false };
  }

  // Safe removal only if nothing meaningful remains after the call (optional `;`).
  const remainderAfterCall = line.slice(closingParenIndex + 1);
  if (/^[ \t]*(;[ \t]*)?$/.test(remainderAfterCall)) {
    return { matched: true, safeRemove: true };
  }
  return { matched: true, safeRemove: false };
}

/**
 * Strips configured function calls when they are whole statements.
 * For non-statement/chained matches, behavior is controlled by `chainedCalls`.
 */
function stripConfiguredCallExpressions(
  code: string,
  functions: string[],
  chainedCalls: ChainedCallsPolicy,
  moduleId: string
): string {
  const lines = code.split(/\r?\n/);
  const out: string[] = [];

  // Process each line independently so we can safely skip ambiguous chained cases.
  for (const line of lines) {
    let replaced = false;

    // Try each configured function against the current line.
    for (const fn of functions) {
      const { matched, safeRemove } = analyzeCallExpressionLine(line, fn);
      if (!matched) {
        continue;
      }

      // Whole-statement calls are safe to strip.
      if (safeRemove) {
        replaced = true;
        break;
      }

      // Matched but not safe: enforce policy for chained/non-statement calls.
      if (chainedCalls === "error") {
        throw new Error(
          `rolldown-plugin-strip: refusing to strip chained or non-statement call "${fn}" in ${moduleId}: ${line.trim()}`
        );
      }
      if (chainedCalls === "warn") {
        console.warn(
          `[rolldown-plugin-strip] skipping strip of chained or non-statement call "${fn}" in ${moduleId}: ${line.trim()}`
        );
      }
      break;
    }

    // Keep lines we did not strip.
    if (!replaced) {
      out.push(line);
    }
  }

  return out.join("\n");
}

/**
 * Finds the closing brace index for a `{` at `openBraceIndex`.
 * Returns -1 if no matching closing brace is found.
 */
function findMatchingBrace(code: string, openBraceIndex: number): number {
  let depth = 0;

  for (let i = openBraceIndex; i < code.length; i += 1) {
    const currentChar = code[i];
    if (currentChar === "{") {
      depth += 1;
    } else if (currentChar === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function stripConfiguredLabelsSequential(code: string, labels: string[]): { code: string; orderedRemovals: [number, number][] } {
  const orderedRemovals: [number, number][] = [];
  let output = code;

  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const blockPattern = new RegExp(`(^|\\n)([ \\t]*)${escaped}[ \\t]*:[^\\n\\r]*\\{`, "g");
    let blockMatch = blockPattern.exec(output);

    // Remove block-style labels such as `foo: { ... }` and `label: while (...) { ... }`.
    while (blockMatch) {
      const matchStart = blockMatch.index + blockMatch[1].length;
      const openBraceRelativeIndex = blockMatch[0].lastIndexOf("{");
      const openBraceIndex = blockMatch.index + openBraceRelativeIndex;
      const closeBraceIndex = findMatchingBrace(output, openBraceIndex);
      if (closeBraceIndex === -1) {
        break;
      }

      let removeEnd = closeBraceIndex + 1;
      if (output[removeEnd] === ";") {
        removeEnd += 1;
      }
      if (output[removeEnd] === "\r") {
        removeEnd += 1;
      }
      if (output[removeEnd] === "\n") {
        removeEnd += 1;
      }

      orderedRemovals.push([matchStart, removeEnd]);
      output = output.slice(0, matchStart) + output.slice(removeEnd);
      blockPattern.lastIndex = matchStart;
      blockMatch = blockPattern.exec(output);
    }

    // Remove single-line labeled statements such as `test: doThing();`.
    const statementPattern = new RegExp(`^[ \\t]*${escaped}[ \\t]*:[^\\n\\r]*\\r?\\n?`, "gm");
    output = output.replace(statementPattern, (match, offset: number) => {
      orderedRemovals.push([offset, offset + match.length]);
      return "";
    });
  }

  return { code: output, orderedRemovals };
}

/**
 * Removes statements prefixed with configured labels, including labeled blocks.
 */
function stripConfiguredLabels(code: string, labels: string[]): string {
  return stripConfiguredLabelsSequential(code, labels).code;
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  if (!ranges.length) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let [currentStart, currentEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const [start, end] = sorted[i];
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      out.push([currentStart, currentEnd]);
      currentStart = start;
      currentEnd = end;
    }
  }
  out.push([currentStart, currentEnd]);
  return out;
}

function afterLength(originalCode: string, removals: [number, number][]): number {
  const merged = mergeRanges(removals);
  const removed = merged.reduce((sum, [a, b]) => sum + (b - a), 0);
  return originalCode.length - removed;
}

function afterToOriginalIndex(originalCode: string, mergedRemovals: [number, number][], afterPos: number): number {
  const afterLen = afterLength(originalCode, mergedRemovals);
  if (afterPos < 0 || afterPos > afterLen) {
    throw new Error(`rolldown-plugin-strip: internal mapping error (afterPos ${afterPos}, len ${afterLen})`);
  }
  if (afterPos === afterLen) {
    return originalCode.length;
  }

  let orig = 0;
  let after = 0;
  let ri = 0;

  while (orig < originalCode.length) {
    while (ri < mergedRemovals.length && orig >= mergedRemovals[ri][1]) {
      ri += 1;
    }
    if (ri < mergedRemovals.length && orig >= mergedRemovals[ri][0] && orig < mergedRemovals[ri][1]) {
      orig = mergedRemovals[ri][1];
      continue;
    }
    if (after === afterPos) {
      return orig;
    }
    orig += 1;
    after += 1;
  }

  return originalCode.length;
}

function mapAfterRangeToOriginal(
  originalCode: string,
  removalsInOriginal: [number, number][],
  rangeAfter: [number, number]
): [number, number] {
  const merged = mergeRanges(removalsInOriginal);
  const [a, b] = rangeAfter;
  return [afterToOriginalIndex(originalCode, merged, a), afterToOriginalIndex(originalCode, merged, b)];
}

function findDebuggerRemovalRanges(code: string): [number, number][] {
  const re = /^[ \t]*debugger\s*;?[ \t]*\r?\n?/gm;
  const out: [number, number][] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(code))) {
    out.push([match.index, match.index + match[0].length]);
  }
  return out;
}

function computeLineStarts(code: string, lines: string[]): number[] {
  const starts: number[] = new Array(lines.length);
  starts[0] = 0;
  let offsetInOriginalFile = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    offsetInOriginalFile += lines[i].length;
    if (offsetInOriginalFile < code.length && code.slice(offsetInOriginalFile, offsetInOriginalFile + 2) === "\r\n") {
      offsetInOriginalFile += 2;
    } else if (offsetInOriginalFile < code.length && (code[offsetInOriginalFile] === "\n" || code[offsetInOriginalFile] === "\r")) {
      offsetInOriginalFile += 1;
    }
    starts[i + 1] = offsetInOriginalFile;
  }
  return starts;
}

function lineRemovalRange(
  lineStarts: number[],
  lines: string[],
  lineIndex: number,
  lineCount: number,
  codeLength: number
): [number, number] {
  const start = lineStarts[lineIndex];
  if (lineIndex < lineCount - 1) {
    return [start, lineStarts[lineIndex + 1]];
  }
  // Last line: include the newline (or CRLF) before it so we do not leave a trailing separator
  // after the previous kept line (matches `lines.filter(...).join("\n")` semantics).
  if (lineIndex > 0) {
    const afterPrevious = lineStarts[lineIndex - 1] + lines[lineIndex - 1].length;
    return [afterPrevious, codeLength];
  }
  return [start, codeLength];
}

function findFunctionRemovalRangesInCode(
  code: string,
  functions: string[],
  chainedCalls: ChainedCallsPolicy,
  moduleId: string
): [number, number][] {
  const ranges: [number, number][] = [];
  const lines = code.split(/\r?\n/);
  const lineStarts = computeLineStarts(code, lines);
  const lineCount = lines.length;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    const line = lines[lineIndex];
    let replaced = false;

    for (const fn of functions) {
      const { matched, safeRemove } = analyzeCallExpressionLine(line, fn);
      if (!matched) {
        continue;
      }
      if (safeRemove) {
        replaced = true;
        break;
      }
      if (chainedCalls === "error") {
        throw new Error(
          `rolldown-plugin-strip: refusing to strip chained or non-statement call "${fn}" in ${moduleId}: ${line.trim()}`
        );
      }
      if (chainedCalls === "warn") {
        console.warn(
          `[rolldown-plugin-strip] skipping strip of chained or non-statement call "${fn}" in ${moduleId}: ${line.trim()}`
        );
      }
      break;
    }

    if (replaced) {
      ranges.push(lineRemovalRange(lineStarts, lines, lineIndex, lineCount, code.length));
    }
  }

  return ranges;
}

function expandThroughRemoval(pos: number, removal: [number, number]): number {
  if (pos < removal[0]) {
    return pos;
  }
  return pos + (removal[1] - removal[0]);
}

function expandRangeThroughPriorRemovals(range: [number, number], priorRemovalsInOrder: [number, number][]): [number, number] {
  let [start, end] = range;
  for (let i = priorRemovalsInOrder.length - 1; i >= 0; i -= 1) {
    const removal = priorRemovalsInOrder[i];
    start = expandThroughRemoval(start, removal);
    end = expandThroughRemoval(end, removal);
  }
  return [start, end];
}

function normalizeLineEndingsToLfLikeStrip(code: string): string {
  return code.split(/\r?\n/).join("\n");
}

function buildNormalizeMagicString(codeAfterRemovals: string, normalized: string): MagicString {
  const msNorm = new MagicString(codeAfterRemovals);
  for (let i = codeAfterRemovals.length - 2; i >= 0; i -= 1) {
    if (codeAfterRemovals[i] === "\r" && codeAfterRemovals[i + 1] === "\n") {
      msNorm.overwrite(i, i + 2, "\n");
    }
  }
  if (msNorm.toString() !== normalized) {
    msNorm.overwrite(0, codeAfterRemovals.length, normalized);
  }
  return msNorm;
}

function runStripPipeline(code: string, options: StripOptions, moduleId: string): string {
  let stripped = code;
  if (options.debugger) {
    stripped = stripDebuggerStatements(stripped);
  }
  if (options.functions?.length) {
    stripped = stripConfiguredCallExpressions(stripped, options.functions, options.chainedCalls ?? "skip", moduleId);
  }
  if (options.labels?.length) {
    stripped = stripConfiguredLabels(stripped, options.labels);
  }
  return stripped;
}

export function strip(options: StripOptions = {}): StripPlugin {
  return {
    name: "rolldown-plugin-strip",
    apply: "build",
    enforce: "pre",
    transform(code: string, id: string) {
      const expected = runStripPipeline(code, options, id);
      if (expected === code) {
        return { code, map: null };
      }

      const dbgRanges = options.debugger ? findDebuggerRemovalRanges(code) : [];
      const dbgMerged = mergeRanges(dbgRanges);

      const d1 = options.debugger ? stripDebuggerStatements(code) : code;

      const fnRangesD1 = options.functions?.length
        ? findFunctionRemovalRangesInCode(d1, options.functions, options.chainedCalls ?? "skip", id)
        : [];
      const fnMergedD1 = mergeRanges(fnRangesD1);

      const d2 = options.functions?.length
        ? stripConfiguredCallExpressions(d1, options.functions, options.chainedCalls ?? "skip", id)
        : d1;

      const { orderedRemovals: labelOrderedInD2 } = options.labels?.length
        ? stripConfiguredLabelsSequential(d2, options.labels)
        : { orderedRemovals: [] as [number, number][] };

      const labelRangesD2Root = labelOrderedInD2.map((removal, index) =>
        expandRangeThroughPriorRemovals(removal, labelOrderedInD2.slice(0, index))
      );

      const fnRangesOrig = fnRangesD1.map((range) => mapAfterRangeToOriginal(code, dbgMerged, range));
      const labelRangesOrig = labelRangesD2Root.map((range) =>
        mapAfterRangeToOriginal(code, dbgMerged, mapAfterRangeToOriginal(d1, fnMergedD1, range))
      );

      const allRemovalRanges = mergeRanges([...dbgRanges, ...fnRangesOrig, ...labelRangesOrig]);

      const ms = new MagicString(code);
      // Descending by range start: apply removals from later offsets first (batch delete convention; offsets stay in original-file space).
      const sortedRemovalRangesDescending = [...allRemovalRanges].sort((a, b) => b[0] - a[0]);
      for (const [start, end] of sortedRemovalRangesDescending) {
        ms.remove(start, end);
      }

      const codeAfterRemovals = ms.toString();
      let finalCode = codeAfterRemovals;
      let map: StripTransformMap;

      if (options.functions?.length) {
        const normalized = normalizeLineEndingsToLfLikeStrip(codeAfterRemovals);
        if (normalized !== codeAfterRemovals) {
          const msNorm = buildNormalizeMagicString(codeAfterRemovals, normalized);
          const mapRemovals = JSON.parse(
            ms.generateMap({
              file: STRIP_INTERMEDIATE,
              source: id,
              hires: true,
              includeContent: false
            }).toString()
          ) as SourceMapInput;
          const mapNormalize = JSON.parse(
            msNorm.generateMap({
              file: id,
              source: STRIP_INTERMEDIATE,
              hires: true,
              includeContent: false
            }).toString()
          ) as SourceMapInput;
          map = remapping([mapNormalize, mapRemovals], () => null);
          finalCode = normalized;
        } else {
          map = ms.generateMap({
            file: id,
            source: id,
            hires: true,
            includeContent: false
          });
        }
      } else {
        map = ms.generateMap({
          file: id,
          source: id,
          hires: true,
          includeContent: false
        });
      }

      if (finalCode !== expected) {
        throw new Error("rolldown-plugin-strip: internal error — source map pipeline mismatch");
      }

      return { code: finalCode, map };
    }
  };
}
