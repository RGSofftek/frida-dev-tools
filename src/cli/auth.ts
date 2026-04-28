import * as fs from "node:fs/promises";
import * as https from "node:https";
import * as os from "node:os";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  deleteCognitivePassword,
  hasCognitivePassword,
  normalizeCognitiveEmail,
  saveCognitivePassword,
} from "./credentialStore";

type PromptQuestion = (prompt: string) => Promise<string>;
type MaskedPromptInput = Readable & {
  isRaw?: boolean;
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};
type ReadlineController = {
  pause: () => unknown;
  resume: () => unknown;
};
type LoginVerifier = (email: string, password: string) => Promise<void>;
type PasswordSaver = (email: string, password: string) => Promise<void>;
type PasswordDeleter = (email: string) => Promise<void>;
type PasswordChecker = (email: string) => Promise<boolean>;
type SessionWriter = (email: string) => Promise<void>;
type SessionReader = () => Promise<SessionStoreResult | null>;
type SessionClearer = () => Promise<void>;

const COGNITIVE_FIREBASE_API_KEY = "AIzaSyAAA1Ov40AMxbl5waVkjVw0X7AMbxW1-YY";

export interface SessionStoreResult {
  email: string;
  createdAt: string;
  lastVerifiedAt: string;
  credentialStore?: string;
}

function sessionDir(): string {
  return path.join(os.homedir(), ".frida-rpa");
}

function sessionFile(): string {
  return path.join(sessionDir(), "session.json");
}

async function readSession(): Promise<SessionStoreResult | null> {
  try {
    const raw = await fs.readFile(sessionFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SessionStoreResult> & { expiresAt?: string };
    if (!parsed.email) {
      return null;
    }
    const nowIso = new Date().toISOString();
    const email = normalizeCognitiveEmail(parsed.email);
    if (!email) {
      return null;
    }
    return {
      email,
      createdAt: parsed.createdAt ?? nowIso,
      lastVerifiedAt: parsed.lastVerifiedAt ?? parsed.createdAt ?? parsed.expiresAt ?? nowIso,
      credentialStore: parsed.credentialStore,
    };
  } catch {
    return null;
  }
}

async function writeSession(email: string): Promise<void> {
  const now = Date.now();
  const session: SessionStoreResult = {
    email,
    createdAt: new Date(now).toISOString(),
    lastVerifiedAt: new Date(now).toISOString(),
    credentialStore: "windows-dpapi",
  };
  await fs.mkdir(sessionDir(), { recursive: true });
  await fs.writeFile(sessionFile(), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

function parseFirebaseError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body;
  } catch {
    return body;
  }
}

function formatLoginVerificationError(message: string): string {
  if (["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS"].includes(message)) {
    return "Cognitive login failed: invalid email or password.";
  }
  if (message === "USER_DISABLED") {
    return "Cognitive login failed: this account is disabled.";
  }
  return `Cognitive login verification failed: ${message}`;
}

function postJson(url: URL, payload: object): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 30000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ statusCode: response.statusCode ?? 0, body });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("request timed out"));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

export async function verifyCognitiveLogin(email: string, password: string): Promise<void> {
  if (!password) {
    throw new Error("Password is required.");
  }
  const url = new URL("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword");
  url.searchParams.set("key", COGNITIVE_FIREBASE_API_KEY);
  const canonicalEmail = normalizeCognitiveEmail(email);
  const response = await postJson(url, {
    email: canonicalEmail,
    password,
    returnSecureToken: true,
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not verify Cognitive login: ${message}`);
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(formatLoginVerificationError(parseFirebaseError(response.body)));
  }

  const parsed = JSON.parse(response.body) as { idToken?: string; localId?: string };
  if (!parsed.idToken || !parsed.localId) {
    throw new Error("Cognitive login verification failed: unexpected response from authentication service.");
  }
}

export async function getStoredSession(
  passwordExists: PasswordChecker = hasCognitivePassword,
  loadSession: SessionReader = readSession,
): Promise<SessionStoreResult | null> {
  const session = await loadSession();
  if (!session) {
    return null;
  }
  if (session.credentialStore && !(await passwordExists(session.email))) {
    return null;
  }
  return session;
}

export async function ensureLoggedIn(): Promise<SessionStoreResult> {
  const session = await getStoredSession();
  if (!session) {
    throw new Error("Not logged in. Run 'frida-rpa login' first.");
  }
  return session;
}

export function createMaskedPrompt(
  readlineController?: ReadlineController,
  promptInput: MaskedPromptInput = input,
  promptOutput: NodeJS.WriteStream = output,
): PromptQuestion {
  return async (prompt: string): Promise<string> => {
    readlineController?.pause();
    try {
      return await readMaskedLine(prompt, promptInput, promptOutput);
    } finally {
      readlineController?.resume();
    }
  };
}

async function readMaskedLine(
  prompt: string,
  promptInput: MaskedPromptInput,
  promptOutput: NodeJS.WriteStream,
): Promise<string> {
  const canUseRawMode = promptInput.isTTY === true && typeof promptInput.setRawMode === "function";
  if (!canUseRawMode) {
    const rl = createInterface({ input: promptInput, output: promptOutput });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  return new Promise<string>((resolve, reject) => {
    let answer = "";
    const wasRaw = promptInput.isRaw === true;

    const cleanup = () => {
      promptInput.off("data", onData);
      promptInput.setRawMode?.(wasRaw);
    };

    const finish = () => {
      cleanup();
      promptOutput.write("\n");
      resolve(answer);
    };

    const cancel = () => {
      cleanup();
      promptOutput.write("\n");
      reject(new Error("Password prompt cancelled."));
    };

    const onData = (chunk: Buffer | string) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cancel();
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (answer.length > 0) {
            answer = answer.slice(0, -1);
            promptOutput.write("\b \b");
          }
          continue;
        }
        answer += char;
        promptOutput.write("*");
      }
    };

    promptOutput.write(prompt);
    promptInput.setRawMode?.(true);
    promptInput.resume();
    promptInput.on("data", onData);
  });
}

export async function handleLoginFlow(
  question?: PromptQuestion,
  maskedQuestion?: PromptQuestion,
  verifier: LoginVerifier = verifyCognitiveLogin,
  savePassword: PasswordSaver = saveCognitivePassword,
  saveSession: SessionWriter = writeSession,
  loadPrevSession: SessionReader = readSession,
  deletePreviousCredential: PasswordDeleter = deleteCognitivePassword,
): Promise<number> {
  const rl = question ? null : createInterface({ input, output });
  const ask = question ?? rl!.question.bind(rl);
  try {
    const rawEmail = await ask("Cognitive email: ");
    rl?.close();
    const askMasked = maskedQuestion ?? (rl ? createMaskedPrompt() : ask);
    const password = await askMasked("Cognitive password: ");
    const normalizedEmail = normalizeCognitiveEmail(rawEmail);
    if (!normalizedEmail) {
      throw new Error("Email is required.");
    }
    await verifier(normalizedEmail, password);
    const previous = await loadPrevSession();
    const prevEmail = previous?.email ? normalizeCognitiveEmail(previous.email) : "";
    if (prevEmail && prevEmail !== normalizedEmail) {
      await deletePreviousCredential(previous!.email);
    }
    await savePassword(normalizedEmail, password);
    await saveSession(normalizedEmail);
    process.stdout.write(`Saved local credentials for ${normalizedEmail}. They remain available until logout.\n`);
    return 0;
  } finally {
    rl?.close();
  }
}

export async function handleLogoutFlow(
  deletePassword: PasswordDeleter = deleteCognitivePassword,
  loadSession: SessionReader = readSession,
  clearSession: SessionClearer = async () => fs.rm(sessionFile(), { force: true }),
): Promise<number> {
  const session = await loadSession();
  try {
    if (session?.email) {
      try {
        await deletePassword(session.email);
      } catch {
        // Still clear session marker so stale metadata cannot survive a partial logout.
      }
    }
  } finally {
    await clearSession();
  }
  process.stdout.write("Cleared local FRIDA RPA credentials.\n");
  return 0;
}
