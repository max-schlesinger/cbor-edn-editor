import * as vscode from "vscode";
import { CborEditorProvider } from "./cborEditor";
export function activate(context: vscode.ExtensionContext) {
  console.log("cbor-edn-editor: activate called");
  // Register our custom editor providers
  context.subscriptions.push(CborEditorProvider.register(context));
}
