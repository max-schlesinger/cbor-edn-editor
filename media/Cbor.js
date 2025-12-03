(function () {
  const vscode = acquireVsCodeApi();
  console.log("Cbor.js: initializing Monaco...");

  // @ts-ignore
  require.config({
    paths: { vs: "https://unpkg.com/monaco-editor@latest/min/vs" },
  });

  // @ts-ignore
  require(["vs/editor/editor.main"], function () {
    monaco.languages.register({ id: "cbor-edn" });

    monaco.languages.setMonarchTokensProvider("cbor-edn", {
      tokenizer: {
        root: [
          // Byte-Strings: h'...'
          [/h'([0-9a-fA-F\s]*)'/, "string.bytes"],

          // Tags: Zahl gefolgt von Klammer auf, z.B. 32(
          [/(\d+)(\()/, ["keyword.tag", "delimiter.parenthesis"]],

          // Strings
          [/"([^"\\]|\\.)*$/, "string.invalid"], // nicht geschlossener String
          [/"([^"\\]|\\.)*"/, "string"],

          // Zahlen
          [/-?\d+(\.\d+)?(_\d+)?/, "number"],

          // Keywords / Booleans
          [/\b(true|false|null|undefined)\b/, "keyword"],

          // Klammern und Trennzeichen
          [/[{}]/, "delimiter.bracket"],
          [/[\[\]]/, "delimiter.array"],
          [/[,]/, "delimiter.comma"],
          [/[:]/, "delimiter.colon"],

          // Kommentare
          [/\/\/.*$/, "comment"],
        ],
      },
    });

    monaco.editor.defineTheme("cbor-theme", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "string.bytes", foreground: "D2691E", fontStyle: "bold" },
        { token: "keyword.tag", foreground: "569CD6", fontStyle: "bold" },
        { token: "number", foreground: "B5CEA8" },
        { token: "string", foreground: "CE9178" },
        { token: "comment", foreground: "6A9955" },
      ],
      colors: {},
    });

    const editor = monaco.editor.create(
      document.getElementById("editor-part"),
      {
        value: "",
        language: "cbor-edn",
        theme: "cbor-theme",
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      },
    );

    let isEditable = true;

    editor.onDidChangeModelContent(() => {
      if (!isEditable) return;
      const value = editor.getValue();
      vscode.postMessage({
        type: "contentChange",
        text: value,
      });
    });

    window.addEventListener("message", (event) => {
      const message = event.data;
      console.log("LOG C: Nachricht im Frontend:", message.type);
      switch (message.type) {
        case "init":
          isEditable = false;
          editor.setValue(message.body.value || "");
          editor.updateOptions({ readOnly: !message.body.editable });
          isEditable = true;
          break;

        case "update":
          const currentPos = editor.getPosition();
          isEditable = false;
          editor.setValue(message.body.content || "");
          if (currentPos) editor.setPosition(currentPos);
          isEditable = true;
          break;

        case "getEdnText":
          vscode.postMessage({
            type: "response",
            requestId: message.requestId,
            body: editor.getValue(),
          });
          break;

        case "updateHex":
          const hexContainer = document.getElementById("hex-part");
          if (hexContainer) {
            hexContainer.textContent = message.body.text;
          }
          break;

        case "syntaxError":
          console.log("Nachricht empfangen:", message);
          const rawMarkers = message.body.markers || [];

          const markers = rawMarkers.map((m) => {
            return {
              startLineNumber: m.startLineNumber,
              startColumn: m.startColumn,
              endLineNumber: m.endLineNumber,
              endColumn: m.endColumn,
              message: m.message,

              severity: monaco.MarkerSeverity.Error,
            };
          });

          monaco.editor.setModelMarkers(
            editor.getModel(),
            "cbor-errors",
            markers,
          );
          break;
      }
    });

    vscode.postMessage({ type: "ready" });
  });
})();
