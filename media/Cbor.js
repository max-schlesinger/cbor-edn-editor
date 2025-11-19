(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  console.log("Cbor.js: script loaded");

  class CborEditor {
    /** @type {HTMLTextAreaElement} */
    textarea;
    /** @type {boolean} */
    editable;

    constructor(element) {
      if (element === null || !(element instanceof HTMLTextAreaElement)) {
        throw new Error(
          "CborEditor hat kein gültiges <textarea> Element erhalten."
        );
      }
      this.textarea = element;
      this.editable = false;
    }

    _initListeners() {
      this.textarea.addEventListener("input", () => {
        if (!this.editable) {
          return;
        }
        const value = this.textarea.value;
        vscode.postMessage({
          type: "contentChange",
          body: value,
        });
      });
    }

    setEditable(editable) {
      this.editable = editable;
      this.textarea.readOnly = !editable;
    }

    setValue(text) {
      this.textarea.value = text ?? "";
    }

    getValue() {
      return this.textarea.value ?? "";
    }

    async reset(data) {
      if (data !== undefined) {
        this.setValue(data);
      }
    }
  }

  const editorElement = document.querySelector(".edn-preview");
  if (editorElement === null) {
    throw new Error("Konnte .edn-preview nicht finden.");
  }

  const editor = new CborEditor(editorElement);
  console.log("Cbor.js: editor instance created");

  // Handle messages from the extension
  window.addEventListener("message", async (e) => {
    const { type, body, requestId } = e.data;
    console.log("Cbor.js: message from host", e.data);

    switch (type) {
      case "init": {
        editor.setEditable(body.editable);
        editor._initListeners();

        if (body.untitled) {
          await editor.reset("");
        } else {
          await editor.reset(body.value);
        }
        return;
      }
      case "getEdnText": {
        const value = editor.getValue();
        vscode.postMessage({
          type: "response",
          requestId,
          body: value,
        });
        return;
      }
    }
  });

  // Signal to VS Code that the webview is initialized.
  vscode.postMessage({ type: "ready" });
})();
