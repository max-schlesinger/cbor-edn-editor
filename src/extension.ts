import * as vscode from "vscode";
import { CborEditorProvider } from "./cborEditor";

export function activate(context: vscode.ExtensionContext) {
  console.log("cbor-edn-editor: activate called");
  context.subscriptions.push(CborEditorProvider.register(context));
  context.subscriptions.push(
    vscode.commands.registerCommand("cbor-edn-editor.Cbor.new", async () => {
      const newUri = vscode.Uri.parse("untitled:new.cbor");

      try {
        await vscode.workspace.openTextDocument(newUri);

        await vscode.commands.executeCommand(
          "vscode.openWith",
          newUri,
          CborEditorProvider.viewType,
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          "Could not create new CBOR file: " + error,
        );
      }
    }),
  );
}
