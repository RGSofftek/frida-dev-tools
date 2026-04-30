import * as https from "node:https";

type JsonObject = Record<string, unknown>;

export interface CognitiveApp {
  appId: string;
  name: string;
  suites: Record<string, string>;
}

export interface CognitiveProcess {
  processId: string;
  name: string;
  appId?: string;
  suiteRefs: string[];
  raw: JsonObject;
}

export interface CognitiveSuite {
  suiteId: string;
  name: string;
  appId: string;
}

export class CognitiveClient {
  constructor(private readonly token: string, private readonly email: string) {}

  private generateId(): string {
    return `${Date.now()}`.slice(-7);
  }

  private request(method: "GET" | "POST", url: string, body?: JsonObject, contentType = "text/plain;charset=UTF-8"): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = https.request(
        url,
        {
          method,
          headers: {
            Authorization: this.token,
            "Content-Type": contentType,
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let chunks = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            chunks += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: chunks }));
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private parseJson(body: string): JsonObject {
    try {
      return JSON.parse(body) as JsonObject;
    } catch {
      return {};
    }
  }

  private normalizeError(status: number, body: string, name: string): Error {
    const parsed = this.parseJson(body);
    const message = String((parsed.error as { message?: string } | undefined)?.message ?? parsed.message ?? body);
    if (status === 401 || status === 403) {
      return new Error("Cognitive token was rejected. Run 'frida-rpa login' and retry.");
    }
    if (status >= 500) {
      return new Error(`${name} failed due to a Cognitive backend error (${status}). Retry or try again later.`);
    }
    return new Error(`${name} failed (${status}): ${message}`);
  }

  async listApps(): Promise<CognitiveApp[]> {
    const url = `https://us-central1-cognitive-testing.cloudfunctions.net/apps-getAdminAppsAndSuites?email=${encodeURIComponent(this.email)}`;
    const res = await this.request("GET", url, undefined, "text/plain");
    if (res.status !== 200) throw this.normalizeError(res.status, res.body, "apps list");
    const parsed = this.parseJson(res.body);
    return Object.entries(parsed).map(([appId, value]) => {
      const row = (value ?? {}) as { name?: unknown; suites?: unknown };
      const suites = typeof row.suites === "object" && row.suites !== null ? row.suites as Record<string, string> : {};
      return {
        appId,
        name: String(row.name ?? ""),
        suites,
      };
    });
  }

  async createApp(name: string): Promise<{ appId: string; name: string }> {
    const appId = `${Date.now()}`.slice(-7);
    const res = await this.request(
      "POST",
      "https://us-central1-cognitive-testing.cloudfunctions.net/apps-createApp",
      {
        appId: Number(appId),
        nombre: name,
        mail: this.email,
      },
    );
    if (res.status !== 200) throw this.normalizeError(res.status, res.body, "apps create");
    const parsed = this.parseJson(res.body);
    return { appId: String(parsed.ID ?? appId), name: String(parsed.Name ?? name) };
  }

  async listProcesses(suiteId?: string): Promise<CognitiveProcess[]> {
    const url = `https://us-central1-cognitive-testing.cloudfunctions.net/tests-getMyProcesses?mail=${encodeURIComponent(this.email)}`;
    const res = await this.request("GET", url, undefined, "text/plain");
    if (res.status !== 200) throw this.normalizeError(res.status, res.body, "processes list");
    const parsed = this.parseJson(res.body);
    const all = Object.entries(parsed).map(([processId, value]) => {
      const row = (value ?? {}) as JsonObject;
      const suites = Array.isArray(row.Suites) ? row.Suites.map((v) => String(v)) : [];
      return {
        processId,
        name: String(row.Name ?? row.nombre ?? processId),
        appId: row.Apps ? String(row.Apps) : undefined,
        suiteRefs: suites,
        raw: row,
      };
    });
    if (!suiteId) return all;
    const prefix = `${suiteId} - `;
    return all.filter((p) => p.suiteRefs.some((v) => v.startsWith(prefix)));
  }

  async createAzureScaffold(processId: string, initialActions = "Hello world"): Promise<void> {
    const mkDir = "https://us-central1-cognitive-testing.cloudfunctions.net/azure-createDirectory";
    const mkTxt = "https://us-central1-cognitive-testing.cloudfunctions.net/azure-createTxtFile";
    const base = `Processes/${processId}`;
    const paths = [base, `${base}/Steps`, `${base}/Steps/0`];
    for (const p of paths) {
      const res = await this.request("POST", mkDir, { path: p }, "application/json");
      if (res.status !== 200) throw this.normalizeError(res.status, res.body, `azure-createDirectory (${p})`);
    }
    const writeRes = await this.request("POST", mkTxt, {
      path: `${base}/Steps/0`,
      file: { name: "Actions.txt", content: initialActions },
    }, "application/json");
    if (writeRes.status !== 200) throw this.normalizeError(writeRes.status, writeRes.body, "azure-createTxtFile");
  }

  async createSuite(appId: string, name: string): Promise<CognitiveSuite> {
    const app = (await this.listApps()).find((row) => row.appId === appId);
    if (!app) {
      throw new Error(`App ${appId} not found.`);
    }
    const suiteId = this.generateId();
    await this.createAzureScaffold(suiteId, "Hello World");
    return { suiteId, name, appId };
  }

  async createProcess(suiteId: string, name: string): Promise<{ processId: string; name: string; suiteId: string }> {
    const apps = await this.listApps();
    const suiteExists = apps.some((app) => Object.prototype.hasOwnProperty.call(app.suites, suiteId));
    if (!suiteExists) {
      throw new Error(`Suite ${suiteId} not found.`);
    }
    const processId = this.generateId();
    await this.createAzureScaffold(processId, "Hello world");
    return { processId, name, suiteId };
  }
}
