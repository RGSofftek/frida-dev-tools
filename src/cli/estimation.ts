import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

export interface EstimateCommandOptions {
  action?: "generate" | "init" | "example";
  configPath?: string;
  outPath?: string;
  force?: boolean;
  json?: boolean;
}

interface ToolResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveToolRoot(): Promise<string> {
  return path.resolve(__dirname, "..", "..");
}

async function resolveEstimatorScriptPath(root: string): Promise<string> {
  const candidates = [
    path.join(root, "resources", "cli-tools", "estimation", "generate_estimation.py"),
    path.join(root, "estimation", "generate_estimation.py"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error("Could not locate estimation generator script.");
}

async function resolveExampleConfigTemplatePath(root: string): Promise<string> {
  const candidates = [
    path.join(root, "resources", "cli-tools", "estimation", "example_config.json"),
    path.join(root, "estimation", "example_config.json"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error("Could not locate default example config template.");
}

async function resolveSampleFlowImagePath(root: string): Promise<string | undefined> {
  const candidates = [
    path.join(root, "resources", "cli-tools", "estimation", "template", "flow_test.png"),
    path.join(root, "estimation", "template", "flow_test.png"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

async function runPython(cwd: string, args: string[]): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function writeToolOutput(result: ToolResult): void {
  if (result.stdout) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) process.stdout.write("\n");
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) process.stderr.write("\n");
  }
}

function normalizePath(inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
}

async function writeExampleConfigFromTemplate(templatePath: string, destinationPath: string): Promise<void> {
  const raw = await fs.readFile(templatePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const flowImagePath = await resolveSampleFlowImagePath(await resolveToolRoot());
  const understanding = parsed.understanding as Record<string, unknown> | undefined;
  if (understanding && flowImagePath) {
    understanding.flowchart_image = flowImagePath;
  }
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function runGenerate(
  scriptPath: string,
  configPath: string,
  outPath: string | undefined,
  json: boolean,
): Promise<number> {
  const args = [scriptPath, "--config", configPath];
  if (outPath) {
    args.push("--out", outPath);
  }

  const result = await runPython(process.cwd(), args);
  if (result.exitCode !== 0) {
    writeToolOutput(result);
    process.stderr.write(
      "Hint: install dependencies with `python -m pip install -r estimation/requirements.txt`.\n",
    );
    return 1;
  }

  if (json) {
    const payload = {
      ok: true,
      action: "generate",
      config: configPath,
      out: outPath ? normalizePath(outPath) : undefined,
      stdout: result.stdout.trim(),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  writeToolOutput(result);
  return 0;
}

export async function runEstimateCommand(options: EstimateCommandOptions): Promise<number> {
  const action = options.action ?? "example";
  const root = await resolveToolRoot();
  const scriptPath = await resolveEstimatorScriptPath(root);
  const templateConfigPath = await resolveExampleConfigTemplatePath(root);

  if (action === "init") {
    const destinationPath = normalizePath(options.outPath ?? "./estimation_mock.json");
    if (!options.force && await pathExists(destinationPath)) {
      throw new Error(`Config already exists: ${destinationPath}. Use --force to overwrite.`);
    }
    await writeExampleConfigFromTemplate(templateConfigPath, destinationPath);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, action: "init", config: destinationPath }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(`Created estimate config: ${destinationPath}\n`);
    }
    return 0;
  }

  if (action === "generate") {
    if (!options.configPath) {
      throw new Error("estimate generate requires --config <path>.");
    }
    const configPath = normalizePath(options.configPath);
    const outPath = options.outPath ? normalizePath(options.outPath) : undefined;
    return runGenerate(scriptPath, configPath, outPath, options.json === true);
  }

  // action === "example"
  const defaultConfigPath = normalizePath("./estimation_mock.json");
  const configPath = options.configPath ? normalizePath(options.configPath) : defaultConfigPath;
  const outPath = normalizePath(options.outPath ?? "./estimation_mock.pptx");

  if (!options.configPath) {
    const exists = await pathExists(defaultConfigPath);
    if (!exists || options.force) {
      await writeExampleConfigFromTemplate(templateConfigPath, defaultConfigPath);
      if (!options.json) {
        process.stdout.write(`Prepared example config: ${defaultConfigPath}\n`);
      }
    }
  }

  return runGenerate(scriptPath, configPath, outPath, options.json === true);
}
