import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface FileBaseline {
  sha256: string;
  updatedAt: string;
  source: "pull" | "push";
}

export interface CognitiveBaseline {
  processId: number;
  step: number;
  files: Record<string, FileBaseline>;
}

export function computeNormalizedHash(content: string): string {
  // Normalize Windows CRLF to LF, and isolated CR to LF, just in case,
  // matching what fetch_actions_from_cognitive.py does by default.
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, "utf8");
  return computeNormalizedHash(content);
}

function getBaselinePath(processDir: string): string {
  return path.join(processDir, ".frida-rpa", "cognitive-baseline.json");
}

export async function readBaseline(processDir: string): Promise<CognitiveBaseline | null> {
  const baselinePath = getBaselinePath(processDir);
  try {
    const data = await fs.readFile(baselinePath, "utf8");
    const parsed = JSON.parse(data) as Partial<CognitiveBaseline>;
    if (typeof parsed.processId === "number" && typeof parsed.step === "number" && parsed.files) {
      return parsed as CognitiveBaseline;
    }
    return null;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    // Ignoring malformed baseline files (e.g. invalid JSON)
    return null;
  }
}

export async function writeBaseline(
  processDir: string,
  baseline: CognitiveBaseline
): Promise<void> {
  const baselinePath = getBaselinePath(processDir);
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2) + "\n", "utf8");
}

export async function updateBaselineFile(
  processDir: string,
  processId: number,
  step: number,
  fileName: string,
  contentOrHash: { hash?: string; content?: string },
  source: "pull" | "push"
): Promise<void> {
  let current = await readBaseline(processDir);
  if (!current || current.processId !== processId || current.step !== step) {
    current = {
      processId,
      step,
      files: {},
    };
  }

  let sha256: string;
  if (contentOrHash.hash) {
    sha256 = contentOrHash.hash;
  } else if (contentOrHash.content !== undefined) {
    sha256 = computeNormalizedHash(contentOrHash.content);
  } else {
    throw new Error("Must provide hash or content to update baseline");
  }

  current.files[fileName] = {
    sha256,
    updatedAt: new Date().toISOString(),
    source,
  };

  await writeBaseline(processDir, current);
}
