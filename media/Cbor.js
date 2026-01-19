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
            contents.push({ value: `(Unbekannter oder proprietärer Tag)` });
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

    function formatEdn(text) {
      const output = [];
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

        if (/\s/.test(char)) {
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
            if (output.length > 0 && output[output.length - 1] !== "\n") {
              output.push("\n" + indent.repeat(indentLevel) + char);
            } else {
              output.push(indent.repeat(indentLevel) + char);
            }
            break;

          case ",":
            output.push(char + "\n" + indent.repeat(indentLevel));
            break;

          case ":":
            output.push(": ");
            break;

          default:
            output.push(char);
            break;
        }
      }
      return output.join("").trim();
    }

    const editor = monaco.editor.create(
      document.getElementById("editor-part"),
      {
        value: "",
        language: "cbor-edn",
        theme: "cbor-theme",
        automaticLayout: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
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
            console.error("Paste fehlgeschlagen:", err);
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
          let val = editor.getValue();

          if (message.body.format === true) {
            val = formatEdn(val);
            const oldEditable = isEditable;
            isEditable = false;
            editor.setValue(val);
            isEditable = oldEditable;
          }
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
