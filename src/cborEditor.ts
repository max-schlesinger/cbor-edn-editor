/* eslint-disable no-mixed-spaces-and-tabs */
import * as vscode from "vscode";
import { Disposable, disposeAll } from "./dispose";
import { getNonce } from "./util";
import * as cbor from "cbor";
import { parseCborEdn } from "./CborParser";
import { decode, diagnose, encode } from "cbor2";

/**
 * Define the type of edits used in paw draw files.
 */
interface CborEdit {
  readonly text: string;
}

interface CborDocumentDelegate {
  getFileData(destination: vscode.Uri): Promise<Uint8Array>;
  //getFileData(): Promise<Uint8Array>;
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
  makeEdit(newText: string) {
    this._onDidChange.fire({
      label: "Edit",
      undo: async () => {},
      redo: async () => {},
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
    const fileData = await this._delegate.getFileData(targetResource);
    if (cancellation.isCancellationRequested) {
      return;
    }
    await vscode.workspace.fs.writeFile(targetResource, fileData);

    if (targetResource.toString() === this.uri.toString()) {
      this._documentData = fileData;
    }
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
        } catch {}
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
    this._context.subscriptions.push(
      vscode.commands.registerCommand("cbor-tools.saveAsEdn", async () => {
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

        if (!activeTab || !(activeTab.input instanceof vscode.TabInputCustom)) {
          vscode.window.showErrorMessage("Please open a CBOR file");
          return;
        }

        const uri = activeTab.input.uri;

        const panels = Array.from(this.webviews.get(uri));
        if (!panels.length) {
          vscode.window.showErrorMessage("No editor panel found");
          return;
        }
        const panel = panels[0];

        try {
          const ednText = await this.postMessageWithResponse<string>(
            panel,
            "getEdnText",
            {},
          );

          const saveUri = await vscode.window.showSaveDialog({
            defaultUri: uri.with({
              path: uri.path.replace(/\.(cbor|png)$/, ".edn"),
            }),
            filters: { "EDN Text": ["edn", "txt"] },
            saveLabel: "Export EDN",
          });

          if (saveUri) {
            const data = new TextEncoder().encode(ednText);

            await vscode.workspace.fs.writeFile(saveUri, data);

            vscode.window.showInformationMessage(
              `Exportiert: ${saveUri.fsPath}`,
            );
          }
        } catch (e: any) {
          console.error(e);
          vscode.window.showErrorMessage("Fehler: " + e.message);
        }
      }),
    );
    this._context.subscriptions.push(
      vscode.commands.registerCommand("cbor-tools.saveAsCbor", async () => {
        const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (!activeTab || !(activeTab.input instanceof vscode.TabInputCustom)) {
          return;
        }
        const uri = activeTab.input.uri;
        const panels = Array.from(this.webviews.get(uri));
        if (!panels.length) return;
        const panel = panels[0];

        try {
          const ednText = await this.postMessageWithResponse<string>(
            panel,
            "getEdnText",
            {},
          );

          const result = parseCborEdn(ednText);
          if (result.lexErrors.length > 0 || result.parseErrors.length > 0) {
            throw new Error(
              "Syntaxfehler! Kann nicht als CBOR gespeichert werden.",
            );
          }

          const cborBytes = cbor.encode(result.value);

          const saveUri = await vscode.window.showSaveDialog({
            defaultUri: uri.with({
              path: uri.path.replace(/\.(edn|txt)$/, ".cbor"),
            }),
            filters: { "CBOR Binary": ["cbor"] },
            saveLabel: "Export CBOR",
          });

          if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, cborBytes);
            vscode.window.showInformationMessage(
              `Exportiert als CBOR: ${saveUri.fsPath}`,
            );
          }
        } catch (e: any) {
          vscode.window.showErrorMessage("Fehler: " + e.message);
        }
      }),
    );
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
        getFileData: async (destination: vscode.Uri) => {
          console.log("\n--- [DEBUG] START SAVING ---");
          console.log("--- [DEBUG] Ziel-Datei:", destination.fsPath);

          const webviewsForDocument = Array.from(
            this.webviews.get(document.uri),
          );
          if (!webviewsForDocument.length) {
            console.error("--- [DEBUG] ERROR: Keine Webview gefunden");
            throw new Error("Could not find webview to save for");
          }
          const panel = webviewsForDocument[0];
          const fspath = destination.fsPath.toLowerCase();
          const isCborDestination = fspath.endsWith(".cbor");
          const isEdnDestination = fspath.endsWith(".edn");

          const ednText = await this.postMessageWithResponse<string>(
            panel,
            "getEdnText",
            { format: isCborDestination || isEdnDestination },
          );

          const result = parseCborEdn(ednText);
          const hasErrors =
            result.lexErrors.length > 0 || result.parseErrors.length > 0;

          if (hasErrors) {
            if (isCborDestination || isEdnDestination) {
              const firstError = result.lexErrors[0] || result.parseErrors[0];
              const msg = `Speichern fehlgeschlagen (Syntaxfehler): ${firstError.message}`;
              console.error("--- [DEBUG] SAVE BLOCKED:", msg);

              vscode.window.showErrorMessage(msg);
              throw new Error(msg);
            }
            console.log("--- [DEBUG] Backup trotz Fehler erstellt.");
            return new TextEncoder().encode(ednText);
          }

          console.log("--- [DEBUG] Parser erfolgreich (Validierung OK).");

          if (isCborDestination) {
            console.log("--- [DEBUG] Speichere als CBOR Binär.");
            const value = result.value;

            try {
              console.log("--- [DEBUG] Starte cbor.encode...");
              const cborBytes = cbor.encode(value);
              return new Uint8Array(cborBytes);
            } catch (e: any) {
              console.error("--- [DEBUG] ENCODING CRASH:", e);
              vscode.window.showErrorMessage(
                "Fehler beim Kodieren: " + e.message,
              );
              throw e;
            }
          } else {
            console.log("--- [DEBUG] Speichere als EDN Text.");
            return new TextEncoder().encode(ednText);
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
    console.log(
      "--- DEBUG: resolveCustomEditor gestartet",
      document.uri.toString(),
    );

    this.webviews.add(document.uri, webviewPanel);
    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    webviewPanel.webview.onDidReceiveMessage(async (e) => {
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
          const isEdnFile = document.uri.fsPath.toLowerCase().endsWith(".edn");

          if (isEdnFile) {
            const textContent = new TextDecoder().decode(document.documentData);
            this.postMessage(webviewPanel, "init", {
              value: textContent,
              editable,
            });

            try {
              const result = parseCborEdn(textContent);
              if (
                result.lexErrors.length === 0 &&
                result.parseErrors.length === 0
              ) {
                const buffer = cbor.encode(result.value);
                const hexString = await cbor.Commented.comment(buffer);
                this.postMessage(webviewPanel, "updateHex", {
                  text: hexString,
                });
              }
            } catch (err) {
              console.error("Hex-View Fehler:", err);
            }
          } else {
            try {
              const text = diagnose(document.documentData);
              const formattedText = this.prettyPrintEDN(text);

              this.postMessage(webviewPanel, "init", {
                value: formattedText,
                editable,
              });
              cbor.Commented.comment(document.documentData)
                .then((hexString) => {
                  this.postMessage(webviewPanel, "updateHex", {
                    text: hexString,
                  });
                })
                .catch((err) => console.error("Hex Fehler:", err));
            } catch (err: any) {
              console.error("Diagnose failed", err);
              this.postMessage(webviewPanel, "init", {
                value: "Fehler: " + err.message,
                editable: false,
              });
            }
          }
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

  private async updateDiagnostics(
    uri: vscode.Uri,
    text: string,
  ): Promise<void> {
    if (!text || text.trim().length === 0) {
      this.diagnostics.set(uri, []);
      return;
    }

    const result = parseCborEdn(text);
    const diagnostics: vscode.Diagnostic[] = [];
    const redMarkers: any[] = [];

    if (result.lexErrors.length > 0) {
      result.lexErrors.forEach((err: any) => {
        const line = err.line ? err.line - 1 : 0;
        const col = err.column ? err.column - 1 : 0;
        const length = err.length || 1;

        const range = new vscode.Range(line, col, line, col + length);
        const msg = `Lexer Error: ${err.message}`;

        diagnostics.push(
          new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error),
        );
        redMarkers.push({
          startLineNumber: line + 1,
          startColumn: col + 1,
          endLineNumber: line + 1,
          endColumn: col + 1 + length,
          message: msg,
          severity: 8,
        });
      });
    }

    if (result.parseErrors.length > 0) {
      result.parseErrors.forEach((err: any) => {
        const token = err.token;
        let range: vscode.Range;
        let startLine = 1,
          startCol = 1,
          endLine = 1,
          endCol = 2;

        if (token && token.startLine && token.startColumn) {
          const sl = token.startLine - 1;
          const sc = token.startColumn - 1;

          const el = token.endLine ? token.endLine - 1 : sl;
          let ec = token.endColumn ? token.endColumn : sc + 1;

          if (ec <= sc) ec = sc + 1;

          range = new vscode.Range(sl, sc, el, ec);

          startLine = token.startLine;
          startCol = token.startColumn;
          endLine = token.endLine || startLine;
          endCol = (token.endColumn || startCol) + 1;
        } else {
          range = new vscode.Range(0, 0, 0, 1);
        }

        const msg = `Syntax Error: ${err.message}`;
        diagnostics.push(
          new vscode.Diagnostic(range, msg, vscode.DiagnosticSeverity.Error),
        );

        redMarkers.push({
          startLineNumber: startLine,
          startColumn: startCol,
          endLineNumber: endLine,
          endColumn: endCol,
          message: msg,
          severity: 8,
        });
      });
    }
    this.diagnostics.set(uri, diagnostics);

    for (const panel of this.webviews.get(uri)) {
      this.postMessage(panel, "syntaxError", { markers: redMarkers });
    }

    if (result.lexErrors.length === 0 && result.parseErrors.length === 0) {
      try {
        const buffer = cbor.encode(result.value);
        const hexString = await cbor.Commented.comment(buffer);
        for (const panel of this.webviews.get(uri)) {
          this.postMessage(panel, "updateHex", { text: hexString });
        }
      } catch (e) {
        console.error("Hex-View Update fehlgeschlagen:", e);
      }
    }
  }
  private prettyPrintEDN(text: string): string {
    const output: string[] = [];
    let indentLevel = 0;
    const indent = "  ";
    let inString = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      if ((char === '"' || char === "'") && text[i - 1] !== "\\") {
        inString = !inString;
      }

      if (inString) {
        output.push(char);
        continue;
      }

      switch (char) {
        case "{":
        case "[":
          indentLevel++;
          output.push(char + "\n" + indent.repeat(indentLevel));
          break;

        case "}":
        case "]":
          indentLevel = Math.max(0, indentLevel - 1);
          output.push("\n" + indent.repeat(indentLevel) + char);
          break;

        case ",":
          output.push(char + "\n" + indent.repeat(indentLevel));
          if (text[i + 1] === " ") i++;
          break;

        case ":":
          output.push(": ");
          break;

        default:
          if (char !== "\n" && char !== "\r") {
            output.push(char);
          }
          break;
      }
    }

    return output.join("").trim();
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
                img-src ${webview.cspSource} blob: data:; 
                style-src ${webview.cspSource} 'unsafe-inline' https://unpkg.com; 
                script-src 'nonce-${nonce}' 'unsafe-eval' https://unpkg.com blob:;
                worker-src blob:;
                connect-src https://unpkg.com data: blob:;
                font-src https://unpkg.com data:;">
            
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleMainUri}" rel="stylesheet" />
            <title>CBOR EDN Editor</title>
            <style>
                html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
                #container { display: flex; width: 100%; height: 100%; }

                #editor-part { 
                    width: 60%;      
                    height: 100%; 
                    border-right: 1px solid var(--vscode-panel-border); 
                }

                #hex-part { 
                    width: 40%;       
                    height: 100%; 
                    font-family: 'Consolas', 'Courier New', monospace;
                    white-space: pre; 
                    overflow: auto;   
                    padding: 10px;
                    box-sizing: border-box;                    
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-size: var(--vscode-editor-font-size);
                }
            </style>
        </head>
        <body>
            <div id="container">
              <div id="editor-part"></div>
              <div id="hex-part"></div>
            </div>
            
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
        document.makeEdit(text);
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
