import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

const SERVICE_NAMESPACE = "frida-rpa-cognitive";

function sessionDir(): string {
  return path.join(os.homedir(), ".frida-rpa");
}

function credentialDir(): string {
  return path.join(sessionDir(), "credentials");
}

/** Canonical identity key for Cognitive email (trim + lowercase). */
export function normalizeCognitiveEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeAccountKey(email: string): string {
  return normalizeCognitiveEmail(email);
}

function credentialPath(email: string): string {
  const key = Buffer.from(`${SERVICE_NAMESPACE}:${normalizeAccountKey(email)}`, "utf8")
    .toString("base64url");
  return path.join(credentialDir(), `${key}.bin`);
}

async function runPowerShellWithInput(script: string, stdinData: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? 1}`));
        return;
      }
      resolve(stdout.trimEnd());
    });
    child.stdin.write(stdinData, "utf8");
    child.stdin.end();
  });
}

function assertWindowsPlatform(): void {
  if (process.platform !== "win32") {
    throw new Error("Secure credential persistence is currently implemented for Windows only.");
  }
}

export async function saveCognitivePassword(email: string, password: string): Promise<void> {
  assertWindowsPlatform();
  const normalized = normalizeAccountKey(email);
  if (!normalized) {
    throw new Error("Email is required for credential storage.");
  }
  if (!password) {
    throw new Error("Password is required for credential storage.");
  }
  const encrypted = await runPowerShellWithInput(
    "$raw = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $raw -AsPlainText -Force; ConvertFrom-SecureString -SecureString $secure",
    password,
  );
  await fs.mkdir(credentialDir(), { recursive: true });
  await fs.writeFile(credentialPath(normalized), `${encrypted}\n`, "utf8");
}

export async function getCognitivePassword(email: string): Promise<string | null> {
  assertWindowsPlatform();
  const normalized = normalizeAccountKey(email);
  if (!normalized) {
    return null;
  }
  const encrypted = await fs.readFile(credentialPath(normalized), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const payload = encrypted.trim();
  if (!payload) {
    return null;
  }
  const decrypted = await runPowerShellWithInput(
    "$blob = [Console]::In.ReadToEnd(); if (-not $blob) { return }; $secure = ConvertTo-SecureString -String $blob; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    payload,
  );
  return decrypted || null;
}

export async function hasCognitivePassword(email: string): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  const normalized = normalizeAccountKey(email);
  if (!normalized) {
    return false;
  }
  try {
    await fs.access(credentialPath(normalized));
    return true;
  } catch {
    return false;
  }
}

export async function deleteCognitivePassword(email: string): Promise<void> {
  assertWindowsPlatform();
  const normalized = normalizeAccountKey(email);
  if (!normalized) {
    return;
  }
  await fs.rm(credentialPath(normalized), { force: true });
}
