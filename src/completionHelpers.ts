import {
  CompletionItem,
  CompletionItemKind,
  CompletionParams,
  InsertTextFormat,
  TextEdit,
} from "vscode-languageserver/node";

export type SyntaxVariant = {
  raw: string;
  stripped: string;
  syntaxSource: "docs" | "readers";
};

export type FridaFunction = {
  name: string;
  shortDescription?: string;
  description?: string;
  syntax?: SyntaxVariant[];
  params?: string[];
  examples?: string[];
};

export type FridaReader = {
  keyword: string;
  name: string;
  functions: FridaFunction[];
};

export function inferVariantSuffix(raw: string, fnName: string, variantIndex: number): string {
  const fnPos = raw.toLowerCase().indexOf(fnName.toLowerCase());
  if (fnPos === -1) {
    return `(${variantIndex + 1})`;
  }
  const afterFn = raw.substring(fnPos + fnName.length).trim();
  const firstParam = afterFn.split(/\s+/).slice(0, 2).join(" ");
  if (firstParam && firstParam.length <= 30) {
    return `-- ${firstParam}`;
  }
  return `(${variantIndex + 1})`;
}

export function buildReaderFunctionItems(
  reader: FridaReader,
  params: CompletionParams,
  context: "after-keyword" | "partial-token" | "line-start",
  partial?: string,
  partialStartChar?: number,
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const functions = partial
    ? reader.functions.filter((fn) => fn.name.toLowerCase().startsWith(partial))
    : reader.functions;

  for (const fn of functions) {
    const variants = fn.syntax ?? [];
    if (variants.length === 0) {
      const fallback: CompletionItem = {
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: "(no documented syntax)",
        documentation: fn.description ?? fn.shortDescription ?? "",
        sortText: `3-${fn.name}`,
        insertTextFormat: InsertTextFormat.PlainText,
      };
      if (context === "partial-token" && partialStartChar !== undefined) {
        fallback.textEdit = TextEdit.replace(
          {
            start: { line: params.position.line, character: partialStartChar },
            end: params.position,
          },
          fn.name,
        );
      } else {
        fallback.insertText = fn.name;
      }
      items.push(fallback);
      continue;
    }

    for (let vi = 0; vi < variants.length; vi += 1) {
      const variant = variants[vi];
      const insertionText = context === "line-start" ? variant.raw : variant.stripped;
      const suffix = variants.length > 1 ? inferVariantSuffix(variant.raw, fn.name, vi) : "";
      const label = suffix ? `${fn.name} ${suffix}` : fn.name;
      const sourceRank = variant.syntaxSource === "docs" ? "1" : "2";
      const sortText = `${sourceRank}-${fn.name}-${String(vi).padStart(3, "0")}`;

      const item: CompletionItem = {
        label,
        kind: CompletionItemKind.Function,
        detail: variant.raw,
        documentation: fn.description ?? fn.shortDescription ?? "",
        sortText,
        insertTextFormat: InsertTextFormat.PlainText,
      };
      if (context === "partial-token" && partialStartChar !== undefined) {
        item.textEdit = TextEdit.replace(
          {
            start: { line: params.position.line, character: partialStartChar },
            end: params.position,
          },
          insertionText,
        );
      } else {
        item.insertText = insertionText;
      }
      items.push(item);
    }
  }

  return items;
}
