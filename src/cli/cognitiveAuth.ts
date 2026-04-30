import * as https from "node:https";
import { ensureLoggedIn } from "./auth";
import { getCognitivePassword } from "./credentialStore";

const AUTOMATION_API_KEY = "AIzaSyAAA1Ov40AMxbl5waVkjVw0X7AMbxW1-YY";
const COGNITIVE_API_KEY = "AIzaSyBhs_Z3-wh659Z39_OfKrTjglZaoAZQ4fE";

type JsonObject = Record<string, unknown>;

function postJson(url: URL, payload: JsonObject, headers?: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...(headers ?? {}),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function parseBody(body: string): JsonObject {
  try {
    return JSON.parse(body) as JsonObject;
  } catch {
    return {};
  }
}

function normalizeAuthError(statusCode: number, body: string, phase: string): Error {
  const parsed = parseBody(body);
  const raw = (parsed.error as { message?: string } | undefined)?.message ?? body;
  const msg = String(raw || "").toUpperCase();
  if (msg.includes("INVALID_PASSWORD") || msg.includes("EMAIL_NOT_FOUND") || msg.includes("INVALID_LOGIN_CREDENTIALS")) {
    return new Error("Stored credentials are invalid. Run 'frida-rpa logout' and then 'frida-rpa login'.");
  }
  if (statusCode === 401 || statusCode === 403) {
    return new Error("Cognitive authentication was rejected. Run 'frida-rpa login' again.");
  }
  return new Error(`Cognitive auth failed during ${phase} (HTTP ${statusCode}).`);
}

export interface CognitiveAuthResult {
  email: string;
  token: string;
}

export async function bootstrapCognitiveToken(): Promise<CognitiveAuthResult> {
  const session = await ensureLoggedIn();
  const password = await getCognitivePassword(session.email);
  if (!password) {
    throw new Error("Stored password is missing. Run 'frida-rpa login' again.");
  }

  const verifyPasswordUrl = new URL("https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword");
  verifyPasswordUrl.searchParams.set("key", AUTOMATION_API_KEY);
  const verifyPassword = await postJson(verifyPasswordUrl, {
    email: session.email,
    password,
    returnSecureToken: true,
  }, {
    Origin: "https://cognitivetesting.online",
  });
  if (verifyPassword.statusCode !== 200) {
    throw normalizeAuthError(verifyPassword.statusCode, verifyPassword.body, "verifyPassword");
  }

  const customTokenRes = await postJson(
    new URL("https://us-central1-cognitive-testing.cloudfunctions.net/auth-generateToken"),
    { uid: session.email },
    {
      "Content-Type": "text/plain;charset=UTF-8",
      Authorization: AUTOMATION_API_KEY,
      Origin: "https://cognitivetesting.online",
    },
  );
  if (customTokenRes.statusCode !== 200) {
    throw normalizeAuthError(customTokenRes.statusCode, customTokenRes.body, "auth-generateToken");
  }
  const customToken = customTokenRes.body.trim();
  if (!customToken) {
    throw new Error("Cognitive auth failed: empty custom token from auth-generateToken.");
  }

  const verifyCustomUrl = new URL("https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken");
  verifyCustomUrl.searchParams.set("key", COGNITIVE_API_KEY);
  const verifyCustom = await postJson(
    verifyCustomUrl,
    { token: customToken, returnSecureToken: true },
    { Origin: "https://cognitivetesting.online" },
  );
  if (verifyCustom.statusCode !== 200) {
    throw normalizeAuthError(verifyCustom.statusCode, verifyCustom.body, "verifyCustomToken");
  }
  const idToken = String(parseBody(verifyCustom.body).idToken ?? "").trim();
  if (!idToken) {
    throw new Error("Cognitive auth failed: verifyCustomToken did not return idToken.");
  }
  return { email: session.email, token: idToken };
}
