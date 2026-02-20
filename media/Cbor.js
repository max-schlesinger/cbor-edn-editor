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

    monaco.languages.setLanguageConfiguration("cbor-edn", {
      comments: {
        lineComment: "#",
        blockComment: ["/", "/"],
      },
      brackets: [
        ["{", "}"],
        ["[", "]"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      folding: {
        markers: {
          start: new RegExp("^\\s*[\\{\\[]"),
          end: new RegExp("[\\}\\]]$"),
        },
      },
      onEnterRules: [
        {
          beforeText: new RegExp("^\\s*[{\\[].*$"),
          action: { indentAction: monaco.languages.IndentAction.Indent },
        },
      ],
    });

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

          // Klammern/Trennzeichen
          [/[{}]/, "delimiter.bracket"],
          [/[\[\]]/, "delimiter.array"],
          [/[,]/, "delimiter.comma"],
          [/[:]/, "delimiter.colon"],

          // Kommentare
          [/#.*$/, "comment"],
          [/\//, "comment", "@comment"],
        ],
        comment: [
          [/[^/]+/, "comment"],
          [/\//, "comment", "@pop"],
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

    const CBOR_TAGS = {
      0: "Standard Date/Time String (RFC 3339)",
      1: "Epoch-based Date/Time (Timestamp)",
      2: "Positive Bignum",
      3: "Negative Bignum",
      4: "Decimal Fraction",
      5: "Bigfloat",
      21: "Expected conversion to base64url encoding",
      22: "Expected conversion to base64 encoding",
      23: "Expected conversion to base16 encoding",
      24: "Encoded CBOR data item (Byte String)",
      32: "URI (Uniform Resource Identifier)",
      33: "base64url",
      34: "base64",
      36: "MIME message",
      55799: "Self-Describe CBOR (Magic Number)",
    };

    monaco.languages.registerCodeActionProvider("cbor-edn", {
      provideCodeActions: function (model, range, context) {
        const actions = [];
        for (const marker of context.markers) {
          const key = `${marker.startLineNumber}:${marker.startColumn}`;

          const suggestion =
            typeof syntaxSuggestions !== "undefined"
              ? syntaxSuggestions.get(key)
              : null;

          if (suggestion) {
            actions.push({
              title: `Fix: Insert '${suggestion}'`,
              kind: "quickfix",
              diagnostics: [marker],

              command: {
                id: "cbor.applyQuickFix",
                title: "Apply Fix",
                arguments: [
                  {
                    startLineNumber: marker.startLineNumber,
                    startColumn: marker.startColumn,
                    endLineNumber: marker.startLineNumber,
                    endColumn: marker.startColumn,
                  },
                  suggestion,
                ],
              },
            });
          }
        }

        return {
          actions: actions,
          dispose: () => {},
        };
      },
    });

    let formatRequestId = 0;
    const formatPending = new Map();

    monaco.languages.registerDocumentFormattingEditProvider("cbor-edn", {
      provideDocumentFormattingEdits: function (model, options, token) {
        return new Promise((resolve) => {
          const reqId = formatRequestId++;
          formatPending.set(reqId, resolve);
          vscode.postMessage({
            type: "requestFormat",
            text: model.getValue(),
            requestId: reqId,
          });
        });
      },
    });
    monaco.languages.registerHoverProvider("cbor-edn", {
      provideHover: function (model, position) {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const text = word.word;
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const contents = [];
        const nextCharRange = new monaco.Range(
          position.lineNumber,
          word.endColumn,
          position.lineNumber,
          word.endColumn + 1,
        );
        const nextChar = model.getValueInRange(nextCharRange);

        if (nextChar === "(" && /^\d+$/.test(text)) {
          const tagId = parseInt(text);
          if (CBOR_TAGS[tagId]) {
            contents.push({ value: `**CBOR Tag ${tagId}**` });
            contents.push({ value: `${CBOR_TAGS[tagId]}` });
          } else {
            contents.push({ value: `**CBOR Tag ${tagId}**` });
            contents.push({ value: `(unknown Tag)` });
          }
        }

        if (text.startsWith("0x") || text.startsWith("0X")) {
          const dec = parseInt(text, 16);
          if (!isNaN(dec)) contents.push({ value: `Decimal: **${dec}**` });
        } else if (text.startsWith("0b") || text.startsWith("0B")) {
          const val = text.substring(2);
          const dec = parseInt(val, 2);
          if (!isNaN(dec)) contents.push({ value: `Decimal: **${dec}**` });
        } else if (text.startsWith("0o") || text.startsWith("0O")) {
          const val = text.substring(2);
          const dec = parseInt(val, 8);
          if (!isNaN(dec)) contents.push({ value: `Decimal: **${dec}**` });
        }
        if (contents.length === 0) return null;

        return {
          range: range,
          contents: contents,
        };
      },
    });
    const editor = monaco.editor.create(
      document.getElementById("editor-part"),
      {
        value: "",
        language: "cbor-edn",
        theme: "cbor-theme",
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        stickyScroll: {
          enabled: true,
        },
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        guides: {
          indentation: true,
          bracketPairs: true,
          highlightActiveBracketPair: true,
          highlightActiveIndentation: true,
        },
        bracketPairColorization: {
          enabled: true,
        },
      },
    );
    monaco.editor.registerCommand(
      "cbor.applyQuickFix",
      function (accessor, range, text) {
        editor.executeEdits("quick-fix-action", [
          {
            range: range,
            text: text,
            forceMoveMarkers: true,
          },
        ]);
        editor.focus();
      },
    );
    setTimeout(() => {
      editor.focus();
    }, 100);
    editor.onKeyDown((e) => {
      if ((e.ctrlKey || e.metaKey) && e.keyCode === monaco.KeyCode.KeyV) {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard
          .readText()
          .then((text) => {
            if (!text) return;

            const selection = editor.getSelection();
            editor.executeEdits("manual-paste", [
              {
                range: selection,
                text: text,
                forceMoveMarkers: true,
              },
            ]);
          })
          .catch((err) => {
            console.error(err);
          });
      }
    });

    let isEditable = true;

    editor.onDidChangeModelContent(() => {
      if (!isEditable) return;
      const value = editor.getValue();
      vscode.postMessage({
        type: "contentChange",
        text: value,
      });
    });
    const syntaxSuggestions = new Map();
    window.addEventListener("message", (event) => {
      const message = event.data;
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
          let val = editor.getValue();

          vscode.postMessage({
            type: "response",
            requestId: message.requestId,
            body: val,
          });
          break;

        case "updateHex":
          const hexContainer = document.getElementById("hex-part");
          if (hexContainer) {
            hexContainer.textContent = message.body.text;
          }
          break;

        case "formatResponse":
          const responseData = message.body;
          const resolve = formatPending.get(responseData.requestId);

          if (resolve) {
            formatPending.delete(responseData.requestId);
            resolve([
              {
                range: editor.getModel().getFullModelRange(),
                text: responseData.body,
              },
            ]);
          }
          break;

        case "syntaxError":
          const rawMarkers = message.body.markers || [];
          syntaxSuggestions.clear();

          const markers = rawMarkers.map((m) => {
            if (m.suggestion) {
              const key = `${m.startLineNumber}:${m.startColumn}`;
              syntaxSuggestions.set(key, m.suggestion);
            }
            return {
              startLineNumber: m.startLineNumber,
              startColumn: m.startColumn,
              endLineNumber: m.endLineNumber,
              endColumn: m.endColumn,
              message: m.message,

              severity: m.severity || monaco.MarkerSeverity.Error,
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
