import * as assert from "assert";
import { parseCborEdn } from "../../CborParser";

suite("CBOR Parser Regression Tests", () => {
  const validCases = [
    "",
    "123",
    "1, 2, 3",
    "1 2 3",
    "1, 2 3",
    "1, 2,",
    "   1,   2   ",
    "-500",
    "3.14",
    "+5",
    ".5",
    "100.",
    "1.5e10",
    "1E-5",
    "100_ms",
    "1.5_V",
    "-2.5e+3_volt",

    "0x1.ap4",
    "0xABCp-10",
    "-0x1p5",
    "0x1.p0",
    "0x.Ap0",
    "0x1p10_float",

    "0x1A",
    "0xff",
    "-0x10",
    "+0xCAFE",
    "0x10_byte",

    "0o755",
    "-0o123",
    "0o0",
    "0o7_perm",

    "0b101",
    "0b0",
    "-0b1111",
    "0b10_mask",

    "h'01 02'",
    "32(100)",
    "6_tag(123)",
    `["a", "b"]`,
    `{"key": "value"}`,
    "(_ h'01', h'02')",
    "prefix'inhalt'",
    '"Hallo" + "Welt"',
    '"Start" + ... + "Ende"',
    '"A" + "B" + "C"',
  ];

  validCases.forEach((input) => {
    test(`Sollte parsen: ${input}`, () => {
      const result = parseCborEdn(input);
      if (result.lexErrors.length > 0) {
        console.error(`Lexer Fehler bei '${input}':`, result.lexErrors);
      }
      if (result.parseErrors.length > 0) {
        console.error(`Parser Fehler bei '${input}':`, result.parseErrors);
      }
      assert.strictEqual(
        result.lexErrors.length,
        0,
        `Lexer Fehler gefunden bei: ${input}`,
      );
      assert.strictEqual(
        result.parseErrors.length,
        0,
        `Parser Fehler gefunden bei: ${input}`,
      );
    });
  });

  const invalidCases = [
    "1,,2",
    '"A" + ',
    '+ "A"',
    ",1",

    "0x1.a",
    "1.ap4",

    "0o8",

    "key: value",
    "test'ohnePrefix",
  ];

  invalidCases.forEach((input) => {
    test(`Sollte Fehler werfen: ${input}`, () => {
      const result = parseCborEdn(input);

      const hatFehler =
        result.lexErrors.length > 0 || result.parseErrors.length > 0;

      assert.strictEqual(
        hatFehler,
        true,
        `Erwartete Fehler, aber Input war valide: ${input}`,
      );
    });
  });
});
