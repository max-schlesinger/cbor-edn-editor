# CBOR EDN Editor (Preview)

> **NOTE: This is a Pre-Release.**
> Features may change, and bugs might occur.
> Please report any issues in the [Issues](https://github.com/max-schlesinger/cbor-edn-editor/issues) section.

**CBOR EDN Editor** allows you to open, view, and edit binary CBOR files as human-readable **Extended Diagnostic Notation (EDN)** directly in VS Code.

## Features

- **Bidirectional Editing:** Open binary `.cbor` files, edit them as text, and save them back as binary.
- **Dual View:** See the EDN text and the resulting CBOR hex dump side-by-side.
- **Syntax Highlighting:** Custom highlighting for CBOR tags, byte strings (`h'...'`), numbers, and keywords.
- **Validation:** Real-time syntax checking. Errors are underlined in red if your EDN is invalid.
- **Export Options:** Convert your current file:
  - `Export as CBOR` (Binary)
  - `Export as EDN` (Text)

## Known Issues / Limitations

- **Syntax Checking:** The validation is currently experimental. It may not catch all edge cases or complex nested structures yet.
- **Large Files:** Very large files might cause performance problems during live updates.

## Installation/Usage

1. Download the latest `.vsix` file from **[Releases](https://github.com/max-schlesinger/cbor-edn-editor/releases)**.
2. In VS Code, open the Extensions view and select **Install from VSIX...**.

<img src="./docs/install-vsix.png" alt="install locally built vsix"/>

3. Choose the downloaded file.
4. **Open a File:** Simply click on any `.cbor` or `.edn` file. It will open in the custom editor.

## Credits & License

This extension is based on the [vscode-scitt-preview](https://github.com/transmute-industries/vscode-scitt-preview) repository by Transmute Industries.

Licensed under the MIT License.
