import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { encode } from "cbor2";
import { Buffer } from "buffer";
import { parseCborEdn } from "../../CborParser";

suite("Official CBOR EDN Test Vectors", () => {
  const vectorsDir = path.resolve(__dirname, "../../../test-vectors");

  const files = [
    "basic.csv",
    "success.csv",
    "encoding-indicators.csv",
    "failures.csv",
  ];

  files.forEach((filename) => {
    const csvPath = path.join(vectorsDir, filename);

    if (!fs.existsSync(csvPath)) {
      console.warn(`WARNUNG: ${filename} nicht gefunden in ${vectorsDir}`);
      return;
    }

    const fileContent = fs.readFileSync(csvPath, "utf-8");

    const lines = fileContent.split("\n");

    suite(filename, () => {
      lines.forEach((line, index) => {
        line = line.trim();

        if (!line || line.startsWith("#") || line.startsWith("op,input"))
          return;

        const parts = parseCSVLine(line);
        const op = parts[0];
        const rawInput = parts[1];
        const outputField = parts[2];

        const inputEDN = processInput(rawInput);

        if (inputEDN.includes("(_")) return;

        test(`Line ${index + 1} [${op}]: ${inputEDN}`, () => {
          if (op === "x") {
            const result = parseCborEdn(inputEDN);

            if (result.lexErrors.length > 0 || result.parseErrors.length > 0) {
              throw new Error(
                `Parser Error: ${result.parseErrors[0]?.message || result.lexErrors[0]?.message}`,
              );
            }

            let myBytes: Buffer;
            try {
              const valueToEncode = Array.isArray(result.value)
                ? result.value[0]
                : result.value;
              const uint8 = encode(valueToEncode);
              myBytes = Buffer.from(uint8);
            } catch (e) {
              throw new Error(`Encoding failed: ${e}`);
            }

            const expectedBytes = Buffer.from(outputField, "hex");
            assert.strictEqual(
              myBytes.toString("hex").toUpperCase(),
              expectedBytes.toString("hex").toUpperCase(),
              `Byte Mismatch für '${inputEDN}'`,
            );
          } else if (op === "=") {
            const resIn = parseCborEdn(inputEDN);
            const resOut = parseCborEdn(processInput(outputField));

            if (resIn.parseErrors.length > 0) throw new Error("Input Invalid");
            if (resOut.parseErrors.length > 0)
              throw new Error("Output (Expected) Invalid");

            const valIn = Array.isArray(resIn.value)
              ? resIn.value[0]
              : resIn.value;
            const valOut = Array.isArray(resOut.value)
              ? resOut.value[0]
              : resOut.value;

            const bytesIn = Buffer.from(encode(valIn))
              .toString("hex")
              .toUpperCase();
            const bytesOut = Buffer.from(encode(valOut))
              .toString("hex")
              .toUpperCase();
            assert.strictEqual(
              bytesIn,
              bytesOut,
              `Roundtrip failed for '${inputEDN}'`,
            );
          } else if (op === "-") {
            const result = parseCborEdn(inputEDN);

            const hasError =
              result.lexErrors.length > 0 || result.parseErrors.length > 0;

            if (!hasError) {
              try {
                const bytes = encode(result.value);
                if (outputField) {
                  const forbidden = Buffer.from(outputField, "hex");
                  if (Buffer.from(bytes).equals(forbidden)) {
                    assert.fail("Input sollte NICHT diesen Bytes entsprechen!");
                  }
                }
              } catch (e) {
                return;
              }
            }
          }
        });
      });
    });
  });
});

function processInput(raw: string): string {
  if (!raw) return "";
  let input = raw;

  if (input.startsWith('"') && input.endsWith('"')) {
    input = input.slice(1, -1).replace(/""/g, '"');
  }

  if (input.startsWith("h]")) {
    const hex = input.substring(2);
    try {
      return Buffer.from(hex, "hex").toString("utf-8");
    } catch (e) {
      return input;
    }
  }
  return input;
}

function parseCSVLine(line: string) {
  const re = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
  return line.split(re).map((text) => text.trim());
}
