import * as path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

let client: LanguageClient | undefined;

function asGlobRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "___DOUBLE_STAR___")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/___DOUBLE_STAR___/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function shouldUseFrida(doc: vscode.TextDocument, patterns: string[]): boolean {
  if (doc.uri.scheme !== "file") {
    return false;
  }
  const normalized = doc.uri.fsPath.replace(/\\/g, "/");
  return patterns.some((pattern) => asGlobRegex(pattern).test(normalized));
}

async function applyLanguageForDocument(doc: vscode.TextDocument, patterns: string[]): Promise<void> {
  if (doc.languageId === "frida") {
    return;
  }
  if (!shouldUseFrida(doc, patterns)) {
    return;
  }
  await vscode.languages.setTextDocumentLanguage(doc, "frida");
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join("out", "server.js"));
  const indexPath = context.asAbsolutePath(path.join("resources", "frida.completion.json"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "frida" }],
    initializationOptions: {
      completionIndexPath: indexPath,
    },
  };

  client = new LanguageClient("fridaLanguageServer", "FRIDA Language Server", serverOptions, clientOptions);
  context.subscriptions.push(client);
  client.start();

  const config = vscode.workspace.getConfiguration();
  const patterns = config.get<string[]>("frida.filePatterns", []);

  for (const doc of vscode.workspace.textDocuments) {
    void applyLanguageForDocument(doc, patterns);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      void applyLanguageForDocument(doc, patterns);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("frida.rebuildCompletionIndex", async () => {
      void vscode.window.showInformationMessage(
        "Run `npm run build:index` from vscode-frida-extension to rebuild frida.completion.json."
      );
    })
  );
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
