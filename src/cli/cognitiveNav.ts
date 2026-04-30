import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CognitiveApp, CognitiveClient, CognitiveProcess } from "./cognitiveClient";

type MenuOption<T extends string> = {
  key: string;
  label: string;
  value: T;
};

async function promptMenu<T extends string>(
  rl: ReturnType<typeof createInterface>,
  title: string,
  options: Array<MenuOption<T>>,
): Promise<T> {
  output.write(`\n${title}\n`);
  for (const option of options) {
    output.write(`  ${option.key}) ${option.label}\n`);
  }
  const raw = (await rl.question("Select option: ")).trim().toLowerCase();
  if (raw === "exit" || raw === "quit") {
    return "exit" as T;
  }
  const match = options.find((opt) => opt.key.toLowerCase() === raw || opt.value === raw);
  if (!match) {
    output.write("Invalid option. Try again.\n");
    return promptMenu(rl, title, options);
  }
  return match.value;
}

async function chooseApp(rl: ReturnType<typeof createInterface>, apps: CognitiveApp[]): Promise<CognitiveApp | null> {
  if (apps.length === 0) {
    output.write("No apps available.\n");
    return null;
  }
  output.write("\nApps\n");
  apps.forEach((app, idx) => {
    output.write(`  ${idx + 1}) ${app.name} (${app.appId})\n`);
  });
  output.write("  r) refresh\n  q) exit\n");
  const raw = (await rl.question("Select app: ")).trim().toLowerCase();
  if (raw === "q" || raw === "exit" || raw === "quit") return null;
  if (raw === "r" || raw === "refresh") return chooseApp(rl, apps);
  const asIndex = Number(raw);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= apps.length) return apps[asIndex - 1];
  output.write("Invalid app selection.\n");
  return chooseApp(rl, apps);
}

async function chooseSuite(
  rl: ReturnType<typeof createInterface>,
  app: CognitiveApp,
): Promise<{ suiteId: string; suiteName: string } | null> {
  const suites = Object.entries(app.suites);
  if (suites.length === 0) {
    output.write(`No suites in app ${app.name}.\n`);
    return null;
  }
  output.write(`\nSuites for ${app.name}\n`);
  suites.forEach(([suiteId, suiteName], idx) => {
    output.write(`  ${idx + 1}) ${suiteName} (${suiteId})\n`);
  });
  output.write("  b) back\n");
  const raw = (await rl.question("Select suite: ")).trim().toLowerCase();
  if (raw === "b" || raw === "back") return null;
  const asIndex = Number(raw);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= suites.length) {
    const [suiteId, suiteName] = suites[asIndex - 1];
    return { suiteId, suiteName };
  }
  output.write("Invalid suite selection.\n");
  return chooseSuite(rl, app);
}

function printProcesses(processes: CognitiveProcess[]): void {
  output.write(`\nProcesses (${processes.length})\n`);
  for (const p of processes) {
    output.write(`- ${p.name} (${p.processId})\n`);
  }
}

export async function runCognitiveNavigation(client: CognitiveClient, email: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    output.write(`\nCognitive navigation for ${email}\n`);
    output.write("Type 'exit' at any prompt to quit navigation.\n");
    while (true) {
      const apps = await client.listApps();
      const app = await chooseApp(rl, apps);
      if (!app) break;

      let keepApp = true;
      while (keepApp) {
        const appAction = await promptMenu(rl, `App: ${app.name} (${app.appId})`, [
          { key: "1", label: "List suites", value: "list-suites" },
          { key: "2", label: "Create suite", value: "create-suite" },
          { key: "3", label: "Choose another app", value: "change-app" },
          { key: "q", label: "Exit navigation", value: "exit" },
        ]);
        if (appAction === "exit") return;
        if (appAction === "change-app") break;
        if (appAction === "create-suite") {
          output.write("Not implemented: suite creation requires metadata/linkage endpoints.\n");
          continue;
        }

        const selectedSuite = await chooseSuite(rl, app);
        if (!selectedSuite) continue;
        let keepSuite = true;
        while (keepSuite) {
          const suiteAction = await promptMenu(rl, `Suite: ${selectedSuite.suiteName} (${selectedSuite.suiteId})`, [
            { key: "1", label: "List processes", value: "list-processes" },
            { key: "2", label: "Create process", value: "create-process" },
            { key: "3", label: "Back to suites", value: "back-suites" },
            { key: "q", label: "Exit navigation", value: "exit" },
          ]);
          if (suiteAction === "exit") return;
          if (suiteAction === "back-suites") keepSuite = false;
          if (suiteAction === "create-process") {
            output.write("Not implemented: process creation requires metadata/linkage endpoints.\n");
            continue;
          }
          if (suiteAction === "list-processes") {
            const processes = await client.listProcesses(selectedSuite.suiteId);
            printProcesses(processes);
          }
        }
      }
    }
  } finally {
    rl.close();
  }
}
