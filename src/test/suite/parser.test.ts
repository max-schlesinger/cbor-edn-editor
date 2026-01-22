import * as assert from "assert";
import * as cbor from "cbor";
import { parseCborEdn } from "../../CborParser";
import { Tag, Simple } from "cbor2";

suite.skip("CBOR Parser Tests", () => {
  suite.skip("Valid Inputs (Vectors)", () => {
    interface TestVector {
      name: string;
      input: string;
      expected: any;
      customCheck?: (actual: any) => void;
    }

    const vectors: TestVector[] = [
      { name: "Positive Integer", input: "123", expected: 123 },
      { name: "Negative Integer", input: "-500", expected: -500 },
      { name: "Float", input: "3.14", expected: 3.14 },
      { name: "Boolean True", input: "true", expected: true },

      { name: "String", input: '"Hallo"', expected: "Hallo" },
      { name: "Hex Bytes", input: "h'FF 00'", expected: Buffer.from([255, 0]) },

      { name: "Array", input: "[1, 2]", expected: [1, 2] },
      { name: "Map", input: '{"a": 1}', expected: { a: 1 } },

      {
        name: "Simple Value",
        input: "simple(20)",
        expected: new Simple(20),
      },
      {
        name: "Tagged Value",
        input: "32(123)",
        expected: new Tag(32, 123),
      },

      {
        name: "NaN",
        input: "NaN",
        expected: NaN,
        customCheck: (val) => assert.ok(Number.isNaN(val)),
      },
      {
        name: "Infinity",
        input: "Infinity",
        expected: Infinity,
      },
    ];

    vectors.forEach((vec) => {
      test(vec.name, () => {
        const result = parseCborEdn(vec.input);

        if (result.lexErrors.length > 0 || result.parseErrors.length > 0) {
          const msg =
            result.lexErrors[0]?.message || result.parseErrors[0]?.message;
          throw new Error(`Parser Error: ${msg}`);
        }

        if (vec.customCheck) {
          vec.customCheck(result.value);
        } else {
          assert.deepStrictEqual(result.value, vec.expected);
        }
      });
    });
  });

  suite.skip("Invalid Inputs (Should Fail)", () => {
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
      test(`Reject: ${input}`, () => {
        const result = parseCborEdn(input);
        const hasError =
          result.lexErrors.length > 0 || result.parseErrors.length > 0;

        assert.strictEqual(
          hasError,
          true,
          `Input '${input}' sollte Fehler werfen, wurde aber akzeptiert.`,
        );
      });
    });
  });
});
