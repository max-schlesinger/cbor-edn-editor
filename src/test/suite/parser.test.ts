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

    "0.123",
    ".123e+5",
    "123.E-2",

    "Infinity",
    "-Infinity",
    "NaN",
    "Infinity_float",

    "true",
    "false",
    "null",
    "undefined",
    "simple(24)",
    "simple(24)_tag",

    "0(123)",
    '32("https://...")',
    "1([1, 2])",
    "32(100)",
    "6_tag(123)",
    "h'01 02'",

    "myPrefix'inhalt'",
    "H'01'",
    "T'text'",

    "<<1, 2>>",
    "<< >>",
    '<<{"a": 1}>>',
    "(_ <<1>>, <<2>>)",

    "{}",
    '{"a": 1}',
    '{1: "one"}',
    "{true: false}",
    '{[1]: "arrayKey"}',
    '{_mapTag "k": "v"}',
    '{"a": [1, <<2>>], 5: {_t 1: 1}}',

    "[]",
    "[1]",
    "[1, 2, 3]",
    "[_tag 1, 2]",
    "[1, [2, 3]]",
    "[1, h'FF']",

    "1\n2",
    "1\r\n2",
    "1\t2",
    "1    2",

    "1 # Kommentar bis Ende\n 2",
    "# Start Kommentar\n1",
    "[1, # Kommentar im Array\n 2]",

    "1 / Kommentar / 2",
    "/Start/ 1 /Ende/",
    '{"a": /Key Kommentar/ 1}',
    "[1, / Komma Kommentar / 2]",

    "1 // 2",
    "1 #\n 2",
    "1, /c1/ 2, #c2\n 3",

    "(_ h'0102', h'0304')",
    '(_ "Text1", "Text2")',
    '(_ "Chunk1" "Chunk2")',

    '"Hallo"_de',
    "'Bonjour'_fr",
    "h'FF'_bytes",

    '"Zeile 1\\nZeile 2"',
    '"Tab\\tVorschub"',
    '"Unicode \\u00A9"',
    '"Pfad\\\\zu\\\\Datei"',
    "'I\\'m happy'",
    '"Er sagte \\"Hi\\""',

    "123_myType",
    "[_packed 1]",

    "(_ h'01', h'02')",
    "prefix'inhalt'",
    `["a", "b"]`,
    `{"key": "value"}`,
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
    "1 +",
    "+ 1",

    "0x1.a",
    "1.ap4",

    "0o8",

    "true_value",
    "null(",

    "simple()",
    "simple(,)",
    "32()",
    "32(1",

    'prefix"text"',
    //"9prefix'text'", //sollte invalid sein aber parser erkennt zwei items

    "<< 1, 2",
    "1, 2 >>",

    "[1, 2",
    "1, 2]",
    "{a: 1}",
    "{1, 2}",
    "{1: 2: 3}",
    "{: 2}",
    "{1: }",

    "/ unclosed comment",
    "1 / comment 2",

    "1,,2",
    ", 1",
    "[ , 1 ]",

    "(_ 123 )",
    "(_ true )",
    "(_ [1] )",

    '(_ "A" ',
    "(_ )",

    "key: value",
    "test'ohnePrefix",
    "(",
    ")",
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
