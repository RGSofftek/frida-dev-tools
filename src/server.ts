import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  InitializeParams,
  InitializeResult,
  Hover,
  MarkupKind,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "node:fs";
import { buildReaderFunctionItems, FridaFunction, FridaReader } from "./completionHelpers";

type CompletionIndex = {
  schemaVersion: number;
  readers: FridaReader[];
};

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let completionIndex: CompletionIndex = { schemaVersion: 2, readers: [] };

function loadIndex(path: string): void {
  try {
    const raw = fs.readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as CompletionIndex;
    if (parsed.schemaVersion !== 2) {
      connection.console.error(
        `Completion index schemaVersion ${parsed.schemaVersion} is not supported (expected 2). `
          + "Run 'npm run build:index' to regenerate.",
      );
      completionIndex = { schemaVersion: 2, readers: [] };
      return;
    }
    completionIndex = parsed;
  } catch (error) {
    connection.console.error(`Failed to load completion index: ${String(error)}`);
    completionIndex = { schemaVersion: 2, readers: [] };
  }
}

function keywordMap(): Map<string, FridaReader> {
  const map = new Map<string, FridaReader>();
  for (const reader of completionIndex.readers) {
    if (reader.keyword) {
      map.set(reader.keyword.toLowerCase(), reader);
    }
  }
  return map;
}

function mixReader(): FridaReader | undefined {
  return completionIndex.readers.find((r) => r.keyword === "" || r.name.toLowerCase().includes("mix"));
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const initOptions = (params.initializationOptions ?? {}) as { completionIndexPath?: string };
  if (initOptions.completionIndexPath) {
    loadIndex(initOptions.completionIndexPath);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: [" ", "."],
      },
      hoverProvider: true,
    },
  };
});

connection.onCompletion((params): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const lineText = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: params.position,
  });

  const prefixTrimmed = lineText.trimStart();
  if (!prefixTrimmed || prefixTrimmed.startsWith("#")) {
    return [];
  }

  const byKeyword = keywordMap();
  const tokens = prefixTrimmed.split(/\s+/).filter(Boolean);
  const hasTrailingSpace = /\s$/.test(prefixTrimmed);
  const items: CompletionItem[] = [];

  const firstTokenReader = tokens.length >= 1
    ? byKeyword.get(tokens[0].toLowerCase())
    : undefined;

  if (firstTokenReader && tokens.length === 1 && hasTrailingSpace) {
    return buildReaderFunctionItems(firstTokenReader, params as CompletionParams, "after-keyword");
  }

  if (firstTokenReader && tokens.length >= 2 && !hasTrailingSpace) {
    const partialToken = tokens[tokens.length - 1];
    const partial = partialToken.toLowerCase();
    const partialStart = lineText.lastIndexOf(partialToken);
    return buildReaderFunctionItems(
      firstTokenReader,
      params as CompletionParams,
      "partial-token",
      partial,
      partialStart,
    );
  }

  if (tokens.length <= 1) {
    for (const reader of completionIndex.readers) {
      if (reader.keyword) {
        items.push({
          label: reader.keyword,
          kind: CompletionItemKind.Module,
          detail: reader.name,
          documentation: `Reader keyword: ${reader.keyword}`,
        });
      }
    }
    const mix = mixReader();
    if (mix) {
      items.push(...buildReaderFunctionItems(mix, params as CompletionParams, "line-start"));
    }
  }

  return items;
});

connection.onHover((params): Hover | null => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return null;
  }

  const fullLine = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });

  const line = fullLine.trimStart();
  if (!line || line.startsWith("#")) {
    return null;
  }

  const match = /^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/.exec(line);
  const byKeyword = keywordMap();

  let fnName: string | undefined;
  let fn: FridaFunction | undefined;
  let prefix = "";

  if (match) {
    const maybeReader = byKeyword.get(match[1].toLowerCase());
    if (maybeReader) {
      prefix = maybeReader.keyword;
      fnName = match[2];
      fn = maybeReader.functions.find((f) => f.name.toLowerCase() === fnName?.toLowerCase());
    }
  }

  if (!fn) {
    const firstToken = /^([A-Za-z0-9_]+)/.exec(line)?.[1];
    if (!firstToken) {
      return null;
    }
    const mix = mixReader();
    if (!mix) {
      return null;
    }
    fn = mix.functions.find((f) => f.name.toLowerCase() === firstToken.toLowerCase());
    fnName = firstToken;
  }

  if (!fn || !fnName) {
    return null;
  }

  const syntaxBlock = (fn.syntax ?? [])
    .slice(0, 4)
    .map((variant) => variant.raw)
    .join("\n");
  const description = fn.description ?? fn.shortDescription ?? "";
  const title = prefix ? `**${prefix} ${fnName}**` : `**${fnName}**`;

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `${title}\n\n${description}\n\n${syntaxBlock ? `\`\`\`\n${syntaxBlock}\n\`\`\`` : ""}`,
    },
  };
});

documents.listen(connection);
connection.listen();
