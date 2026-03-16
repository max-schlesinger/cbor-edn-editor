import * as vscode from "vscode";
import { CborEditorProvider } from "./cborEditor";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(CborEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand("cbor-edn-editor.Cbor.new", async () => {
      // helps to create multiple new files without name conflicts
      const timestamp = new Date().getTime();
      const newUri = vscode.Uri.parse(`untitled:new-${timestamp}.cbor`);

      try {
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
