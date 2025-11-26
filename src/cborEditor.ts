/* eslint-disable no-mixed-spaces-and-tabs */
import * as vscode from "vscode";
import { Disposable, disposeAll } from "./dispose";
import { getNonce } from "./util";
import * as cbor from "cbor";
import { CborParser } from "./CborParser";

import * as edn from "@transmute/edn";

/**
 * Define the type of edits used in paw draw files.
 */
interface CborEdit {
  readonly color: string;
  readonly stroke: ReadonlyArray<[number, number]>;
}

interface CborDocumentDelegate {
  getFileData(): Promise<Uint8Array>;
}

/**
 * Define the document (the data model) used for paw draw files.
 */
class CborDocument extends Disposable implements vscode.CustomDocument {
  static async create(
    uri: vscode.Uri,
    backupId: string | undefined,
    delegate: CborDocumentDelegate,
  ): Promise<CborDocument | PromiseLike<CborDocument>> {
    // If we have a backup, read that. Otherwise read the resource from the workspace
    const dataFile =
      typeof backupId === "string" ? vscode.Uri.parse(backupId) : uri;
    const fileData = await CborDocument.readFile(dataFile);
    return new CborDocument(uri, fileData, delegate);
  }

  private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (uri.scheme === "untitled") {
      return new Uint8Array();
    }
    return new Uint8Array(await vscode.workspace.fs.readFile(uri));
  }

  private readonly _uri: vscode.Uri;

  private _documentData: Uint8Array;
  private _edits: Array<CborEdit> = [];
  private _savedEdits: Array<CborEdit> = [];

  private readonly _delegate: CborDocumentDelegate;

  private constructor(
    uri: vscode.Uri,
    initialContent: Uint8Array,
    delegate: CborDocumentDelegate,
  ) {
    super();
    this._uri = uri;
    this._documentData = initialContent;
    this._delegate = delegate;
  }

  public get uri() {
    return this._uri;
  }

  public get documentData(): Uint8Array {
    return this._documentData;
  }

  private readonly _onDidDispose = this._register(
    new vscode.EventEmitter<void>(),
  );
  /**
   * Fired when the document is disposed of.
   */
  public readonly onDidDispose = this._onDidDispose.event;

  private readonly _onDidChangeDocument = this._register(
    new vscode.EventEmitter<{
      readonly content?: Uint8Array;
      readonly edits: readonly CborEdit[];
    }>(),
  );
  /**
   * Fired to notify webviews that the document has changed.
   */
  public readonly onDidChangeContent = this._onDidChangeDocument.event;

  private readonly _onDidChange = this._register(
    new vscode.EventEmitter<{
      readonly label: string;
      undo(): void;
      redo(): void;
    }>(),
  );
  /**
   * Fired to tell VS Code that an edit has occurred in the document.
   *
   * This updates the document's dirty indicator.
   */
  public readonly onDidChange = this._onDidChange.event;

  /**
   * Called by VS Code when there are no more references to the document.
   *
   * This happens when all editors for it have been closed.
   */
  dispose(): void {
    this._onDidDispose.fire();
    super.dispose();
  }

  /**
   * Called when the user edits the document in a webview.
   *
   * This fires an event to notify VS Code that the document has been edited.
   */
  makeEdit(edit: CborEdit) {
    this._edits.push(edit);

    this._onDidChange.fire({
      label: "Stroke",
      undo: async () => {
        this._edits.pop();
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      },
      redo: async () => {
        this._edits.push(edit);
        this._onDidChangeDocument.fire({
          edits: this._edits,
        });
      },
    });
  }

  /**
   * Called by VS Code when the user saves the document.
   */
  async save(cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveAs(this.uri, cancellation);
    this._savedEdits = Array.from(this._edits);
  }

  /**
   * Called by VS Code when the user saves the document to a new location.
   */
  async saveAs(
    targetResource: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    const fileData = await this._delegate.getFileData();
    if (cancellation.isCancellationRequested) {
      return;
    }
    await vscode.workspace.fs.writeFile(targetResource, fileData);

    this._documentData = fileData;
  }

  /**
   * Called by VS Code when the user calls `revert` on a document.
   */
  async revert(_cancellation: vscode.CancellationToken): Promise<void> {
    const diskContent = await CborDocument.readFile(this.uri);
    this._documentData = diskContent;
    this._edits = this._savedEdits;
    this._onDidChangeDocument.fire({
      content: diskContent,
      edits: this._edits,
    });
  }

  /**
   * Called by VS Code to backup the edited document.
   *
   * These backups are used to implement hot exit.
   */
  async backup(
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination, cancellation);

    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // noop
        }
      },
    };
  }
}

/**
 * Provider for paw draw editors.
 *
 * Paw draw editors are used for `.Cbor` files, which are just `.png` files with a different file extension.
 *
 * This provider demonstrates:
 *
 * - How to implement a custom editor for binary files.
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Communication between VS Code and the custom editor.
 * - Using CustomDocuments to store information that is shared between multiple custom editors.
 * - Implementing save, undo, redo, and revert.
 * - Backing up a custom editor.
 */
export class CborEditorProvider
  implements vscode.CustomEditorProvider<CborDocument>
{
  private static newCborFileId = 1;
  private static readonly viewType = "cbor-tools.cbor";

  private readonly webviews = new WebviewCollection();
  private readonly diagnostics: vscode.DiagnosticCollection;

  constructor(private readonly _context: vscode.ExtensionContext) {
    this.diagnostics = vscode.languages.createDiagnosticCollection("cbor-edn");
    this._context.subscriptions.push(this.diagnostics);
  }

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    console.log("CborEditorProvider.register: called");
    vscode.commands.registerCommand("cbor-tools.Cbor.new", () => {
      console.log("cbor-tools.Cbor.new command executed");
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage(
          "Creating new Paw Draw files currently requires opening a workspace",
        );
        return;
      }

      const uri = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        `new-${CborEditorProvider.newCborFileId++}.cbor`,
      ).with({ scheme: "untitled" });

      vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        CborEditorProvider.viewType,
      );
    });

    return vscode.window.registerCustomEditorProvider(
      CborEditorProvider.viewType,
      new CborEditorProvider(context),
      {
        // For this demo extension, we enable `retainContextWhenHidden` which keeps the
        // webview alive even when it is not visible. You should avoid using this setting
        // unless is absolutely required as it does have memory overhead.
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: { backupId?: string },
    _token: vscode.CancellationToken,
  ): Promise<CborDocument> {
    const document: CborDocument = await CborDocument.create(
      uri,
      openContext.backupId,
      {
        getFileData: async () => {
          const webviewsForDocument = Array.from(
            this.webviews.get(document.uri),
          );
          if (!webviewsForDocument.length) {
            throw new Error("Could not find webview to save for");
          }
          const panel = webviewsForDocument[0];
          const ednText = await this.postMessageWithResponse<string>(
            panel,
            "getEdnText",
            {},
          );
          try {
            const value = CborParser.parse(ednText);
            console.log("Error ", value);
            console.log("getFileData: Parsed OK, encoding...");
            const cborBytes = cbor.encode(value);
            return new Uint8Array(cborBytes);
          } catch (e: any) {
            console.error(e);
            vscode.window.showErrorMessage("Syntax-Fehler: " + e.message);
            return document.documentData;
          }
        },
      },
    );

    const listeners: vscode.Disposable[] = [];
    listeners.push(
      document.onDidChange((e) => {
        this._onDidChangeCustomDocument.fire({ document, ...e });
      }),
    );
    listeners.push(
      document.onDidChangeContent((e) => {
        for (const webviewPanel of this.webviews.get(document.uri)) {
          this.postMessage(webviewPanel, "update", {
            edits: e.edits,
            content: e.content,
          });
        }
      }),
    );
    document.onDidDispose(() => disposeAll(listeners));
    return document;
  }

  async resolveCustomEditor(
    document: CborDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.webviews.add(document.uri, webviewPanel);
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage((e) => {
      if (e.type === "ready") {
        if (document.uri.scheme === "untitled") {
          this.postMessage(webviewPanel, "init", {
            untitled: true,
            editable: true,
          });
        } else {
          const editable = vscode.workspace.fs.isWritableFileSystem(
            document.uri.scheme,
          );

          cbor
            .diagnose(document.documentData)
            .then((text) => {
              const formattedText = this.prettyPrintEDN(text);
              this.postMessage(webviewPanel, "init", {
                value: formattedText,
                editable,
              });
            })
            .catch((err) => {
              console.error("Diagnose failed", err);
              this.postMessage(webviewPanel, "init", {
                value: "Fehler beim Lesen der CBOR Datei: " + err.message,
                editable: false,
              });
            });
        }
      } else {
        this.onMessage(document, e);
      }
    });
  }
  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<CborDocument>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  public saveCustomDocument(
    document: CborDocument,
    cancellation: vscode.CancellationToken,
  ): Thenable<void> {
    return document.save(cancellation);
  }

  public saveCustomDocumentAs(
    document: CborDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Thenable<void> {
    return document.saveAs(destination, cancellation);
  }

  public revertCustomDocument(
    document: CborDocument,
    cancellation: vscode.CancellationToken,
  ): Thenable<void> {
    return document.revert(cancellation);
  }

  public backupCustomDocument(
    document: CborDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken,
  ): Thenable<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  private updateDiagnostics(uri: vscode.Uri, text: string): void {
    const diagnostics: vscode.Diagnostic[] = [];

    if (!text || text.trim().length === 0) {
      this.diagnostics.set(uri, diagnostics);
      return;
    }
    try {
      const value = CborParser.parse(text);

      cbor.encode(value);
    } catch (e: any) {
      const line = typeof e.line === "number" ? e.line : 0;
      const col = typeof e.column === "number" ? e.column : 0;
      const range = new vscode.Range(
        new vscode.Position(line, col),
        new vscode.Position(line, col + 1),
      );

      diagnostics.push(
        new vscode.Diagnostic(
          range,
          e.message,
          vscode.DiagnosticSeverity.Error,
        ),
      );
    }

    this.diagnostics.set(uri, diagnostics);
  }

  private prettyPrintEDN(text: string): string {
    let output = "";
    let indentLevel = 0;
    const indent = "  ";
    let inString = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if (char === '"' && text[i - 1] !== "\\") {
        inString = !inString;
      }

      if (inString) {
        output += char;
        continue;
      }

      switch (char) {
        case "{":
        case "[":
          output += char + "\n" + indent.repeat(++indentLevel);
          break;
        case "}":
        case "]":
          output += "\n" + indent.repeat(--indentLevel) + char;
          break;
        case ",":
          output += char + "\n" + indent.repeat(indentLevel);

          if (text[i + 1] === " ") i++;
          break;
        case ":":
          output += ": ";
          break;
        default:
          output += char;
          break;
      }
    }
    return output.trim();
  }
  //#endregion

  /**
   * Get the static HTML used for in our editor's webviews.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "media", "Cbor.js"),
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "media", "Cbor.css"),
    );
    const nonce = getNonce();

    return /* html */ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="
                default-src 'none'; 
                img-src ${webview.cspSource} blob:; 
                style-src ${webview.cspSource} 'unsafe-inline' https://unpkg.com; 
                script-src 'nonce-${nonce}' 'unsafe-eval' https://unpkg.com;
                font-src https://unpkg.com;">
            
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleMainUri}" rel="stylesheet" />
            <title>CBOR EDN Editor</title>
            <style>
                html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
                #container { width: 100%; height: 100%; }
            </style>
        </head>
        <body>
            <div id="container"></div>
            
            <script nonce="${nonce}" src="https://unpkg.com/monaco-editor@latest/min/vs/loader.js"></script>
            
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
  }
  private _requestId = 1;
  private readonly _callbacks = new Map<number, (response: any) => void>();

  private postMessageWithResponse<R = unknown>(
    panel: vscode.WebviewPanel,
    type: string,
    body: any,
  ): Promise<R> {
    const requestId = this._requestId++;
    const p = new Promise<R>((resolve) =>
      this._callbacks.set(requestId, resolve),
    );
    panel.webview.postMessage({ type, requestId, body });
    return p;
  }

  private postMessage(
    panel: vscode.WebviewPanel,
    type: string,
    body: any,
  ): void {
    panel.webview.postMessage({ type, body });
  }

  private onMessage(document: CborDocument, message: any) {
    console.log("onMessage", message);
    switch (message.type) {
      case "contentChange": {
        const text: string = message.text;
        this.updateDiagnostics(document.uri, text);
        return;
      }

      case "stroke": {
        document.makeEdit(message as CborEdit);
        return;
      }

      case "response": {
        console.log("onMessage: response", message);
        const callback = this._callbacks.get(message.requestId);
        if (callback) {
          this._callbacks.delete(message.requestId);
          callback(message.body);
        } else {
          console.warn(
            "onMessage: no callback for requestId",
            message.requestId,
          );
        }
        return;
      }
    }
  }
}

/**
 * Tracks all webviews.
 */
class WebviewCollection {
  private readonly _webviews = new Set<{
    readonly resource: string;
    readonly webviewPanel: vscode.WebviewPanel;
  }>();

  /**
   * Get all known webviews for a given uri.
   */
  public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
    const key = uri.toString();
    for (const entry of this._webviews) {
      if (entry.resource === key) {
        yield entry.webviewPanel;
      }
    }
  }

  /**
   * Add a new webview to the collection.
   */
  public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
    const entry = { resource: uri.toString(), webviewPanel };
    this._webviews.add(entry);

    webviewPanel.onDidDispose(() => {
      this._webviews.delete(entry);
    });
  }
}
