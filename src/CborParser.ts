import {
  createToken,
  Lexer,
  CstParser,
  tokenMatcher,
  IParserErrorMessageProvider,
  ILexerErrorMessageProvider,
} from "chevrotain";
import { Tag, Simple, encodedNumber } from "cbor2";
import * as ipaddr from "ipaddr.js";

const ErrorProvider: IParserErrorMessageProvider = {
  buildMismatchTokenMessage: (options) => {
    const expected = options.expected.LABEL || options.expected.name;
    const actual = options.actual.image;
    return `Expected ${expected} but found '${actual}'`; // the token did not match the expected token
  },
  buildNotAllInputParsedMessage: (options) => {
    return `Could not parse the entire input. Unexpected character at the end: '${options.firstRedundant.image}'`; // parser finished but there are still more tokens left in the input
  },
  buildNoViableAltMessage: (options) => {
    const actual = options.actual[0].image;
    return `Unexpected input: '${actual}'. Expected a value, tag, or structure here.`; // none of the alternatives could be matched
  },
  buildEarlyExitMessage: (options) => {
    return `Unexpected end of input. More data was expected.`; // finished the input but was expecting more tokens
  },
};

const LexerErrorProvider: ILexerErrorMessageProvider = {
  buildUnexpectedCharactersMessage: (
    fullText,
    startOffset,
    length,
    line,
    column,
  ) => {
    const char = fullText.substring(startOffset, startOffset + length);
    return `Unexpected character: '${char}' at line ${line}, column ${column}.`;
  },
  buildUnableToPopLexerModeMessage: (token) => {
    return `Unable to pop lexer mode at line ${token.startLine}, column ${token.startColumn}.`;
  },
};

const Comment = createToken({
  name: "Comment",
  pattern: /\/[^\/]*\/|#[^\r\n]*/,
  group: Lexer.SKIPPED,
});

const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /\s+/,
  group: Lexer.SKIPPED,
});

const LBrace = createToken({ name: "LBrace", pattern: /{/, label: "{" });
const RBrace = createToken({ name: "RBrace", pattern: /}/, label: "}" });
const LBracket = createToken({ name: "LBracket", pattern: /\[/, label: "[" });
const RBracket = createToken({ name: "RBracket", pattern: /]/, label: "]" });
const LParen = createToken({ name: "LParen", pattern: /\(/, label: "(" });
const RParen = createToken({ name: "RParen", pattern: /\)/, label: ")" });
const Colon = createToken({ name: "Colon", pattern: /:/, label: ":" });
const Comma = createToken({ name: "Comma", pattern: /,/, label: "," });
const Plus = createToken({ name: "Plus", pattern: /\+/, label: "+" });

const StreamStart = createToken({
  name: "StreamStart",
  pattern: /\(_/,
  label: "(_",
});
const EmbedStart = createToken({
  name: "EmbedStart",
  pattern: /<</,
  label: "<<",
});
const EmbedEnd = createToken({ name: "EmbedEnd", pattern: />>/, label: ">>" });

const True = createToken({ name: "True", pattern: /true/, label: "true" });
const False = createToken({ name: "False", pattern: /false/, label: "false" });
const Null = createToken({ name: "Null", pattern: /null/, label: "null" });
const Undefined = createToken({
  name: "Undefined",
  pattern: /undefined/,
  label: "undefined",
});
const SimpleKey = createToken({
  name: "SimpleKey",
  pattern: /simple(?=\s*\()/,
  label: "simple value",
});

const HexBytes = createToken({
  name: "HexBytes",
  pattern: /h'[0-9a-fA-F\s]*'/,
  label: "hex bytes h'...'",
});
const B64Bytes = createToken({
  name: "B64Bytes",
  pattern: /b64'[a-zA-Z0-9+/=\s]*'/,
  label: "base64 bytes b64'...'",
});
const StringLiteral = createToken({
  name: "String",
  pattern: /"(?:[^\\"]|\\.)*"|'(?:[^\\']|\\.)*'/,
  label: "text string",
});

const HexFloat = createToken({
  name: "HexFloat",
  pattern:
    /[+-]?0x(?:\.[0-9a-fA-F]+|[0-9a-fA-F]+(?:\.[0-9a-fA-F]*)?)[pP][+-]?[0-9]+/,
  label: "hex float",
});
const HexInt = createToken({
  name: "HexInt",
  pattern: /[+-]?0x[0-9a-fA-F]+/,
  label: "hex integer",
});
const BinInt = createToken({
  name: "BinInt",
  pattern: /[+-]?0b[0-1]+/,
  label: "binary integer",
});
const OctInt = createToken({
  name: "OctInt",
  pattern: /[+-]?0o[0-7]+/,
  label: "octal integer",
});
const NonFin = createToken({
  name: "NonFin",
  pattern: /Infinity|-Infinity|NaN/,
  label: "Infinity or NaN",
});
const NumberLiteral = createToken({
  name: "Number",
  pattern:
    /[+-]?(?:(?:0|[1-9](?:_?[0-9]+)*)(?:\.(?:[0-9]+(?:_[0-9]+)*)?)?|\.[0-9]+(?:_[0-9]+)*)(?:[eE][+-]?[0-9]+(?:_[0-9]+)*)?/,
  label: "number",
});
const Spec = createToken({
  name: "Spec",
  pattern: /_[a-zA-Z0-9_]+/,
  label: "type specification (_...)",
});
const Ellipsis = createToken({
  name: "Ellipsis",
  pattern: /\.{3,}/,
  label: "ellipsis '...'",
});
const AppString = createToken({
  name: "AppString",
  pattern: /[a-zA-Z][a-zA-Z0-9]*'(?:[^\\']|\\.)*'/,
  label: "application string (tag'...')",
});
const Unexpected = createToken({
  name: "Unexpected",
  pattern: /./,
  label: "unexpected character",
});

const allTokens = [
  WhiteSpace,
  Comment,
  StreamStart,
  Ellipsis,
  EmbedStart,
  EmbedEnd,
  LBrace,
  RBrace,
  LBracket,
  RBracket,
  LParen,
  RParen,
  Colon,
  Comma,
  True,
  False,
  Null,
  Undefined,
  SimpleKey,
  HexBytes,
  B64Bytes,
  AppString,
  StringLiteral,
  Spec,
  HexFloat,
  HexInt,
  BinInt,
  OctInt,
  NonFin,
  NumberLiteral,
  Plus,
  Unexpected,
];

function parseHexFloat(text: string): number {
  const clean = text.toLowerCase().replace(/_/g, "");
  const sign = clean.startsWith("-") ? -1 : 1;
  const withoutSign = clean.replace(/^[+-]/, "");

  const [mantissaStr, expStr] = withoutSign.split("p");
  const exponent = expStr ? parseInt(expStr, 10) : 0;
  const parts = mantissaStr.replace("0x", "").split(".");

  let value = parseInt(parts[0], 16);

  if (parts.length > 1 && parts[1].length > 0) {
    value += parseInt(parts[1], 16) / Math.pow(16, parts[1].length);
  }

  return sign * value * Math.pow(2, exponent);
}

export const CborLexer = new Lexer(allTokens, {
  errorMessageProvider: LexerErrorProvider,
});

export class CborParser extends CstParser {
  public cbor!: () => any;
  public value!: () => any;
  public map!: () => any;
  public pair!: () => any;
  public array!: () => any;
  public tag!: () => any;
  public streamstring!: () => any;
  public embedded!: () => any;
  public string_concatenation!: () => any;
  public annotated_string!: () => any;
  public annotated_number!: () => any;
  public simple_value!: () => any;

  constructor() {
    super(allTokens, {
      recoveryEnabled: true,
      errorMessageProvider: ErrorProvider,
    });

    this.cbor = this.RULE("cbor", () => {
      this.MANY(() => {
        this.SUBRULE(this.value);
        this.OPTION(() => this.CONSUME(Comma));
      });
    });
    this.value = this.RULE("value", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.map) },
        { ALT: () => this.SUBRULE(this.array) },
        {
          GATE: () => this.looksLikeTag(),
          ALT: () => this.SUBRULE(this.tag),
        },
        { ALT: () => this.SUBRULE(this.string_concatenation) },
        { ALT: () => this.SUBRULE(this.streamstring) },

        { ALT: () => this.SUBRULE(this.simple_value) },
        { ALT: () => this.SUBRULE(this.annotated_number) },

        { ALT: () => this.CONSUME(True) },
        { ALT: () => this.CONSUME(False) },
        { ALT: () => this.CONSUME(Null) },
        { ALT: () => this.CONSUME(Undefined) },
      ]);
    });

    this.map = this.RULE("map", () => {
      this.CONSUME(LBrace);
      this.OPTION(() => this.CONSUME(Spec));
      this.MANY(() => {
        this.SUBRULE(this.pair);
        this.OPTION2(() => this.CONSUME(Comma));
      });

      this.CONSUME(RBrace);
    });

    this.pair = this.RULE("pair", () => {
      this.SUBRULE(this.value);
      this.CONSUME(Colon);
      this.SUBRULE2(this.value);
    });

    this.array = this.RULE("array", () => {
      this.CONSUME(LBracket);
      this.OPTION(() => this.CONSUME(Spec));

      this.MANY(() => {
        this.SUBRULE(this.value);
        this.OPTION2(() => this.CONSUME(Comma));
      });

      this.CONSUME(RBracket);
    });

    this.tag = this.RULE("tag", () => {
      this.OR([
        { ALT: () => this.CONSUME(NumberLiteral) },
        { ALT: () => this.CONSUME(HexInt) },
        { ALT: () => this.CONSUME(OctInt) },
        { ALT: () => this.CONSUME(BinInt) },
      ]);
      this.OPTION(() => this.CONSUME(Spec));
      this.CONSUME(LParen);
      this.SUBRULE(this.value);
      this.CONSUME(RParen);
    });

    this.streamstring = this.RULE("streamstring", () => {
      this.CONSUME(StreamStart);
      this.AT_LEAST_ONE(() => {
        this.SUBRULE(this.annotated_string);
        this.OPTION(() => this.CONSUME(Comma));
      });

      this.CONSUME(RParen);
    });

    this.embedded = this.RULE("embedded", () => {
      this.CONSUME(EmbedStart);
      this.SUBRULE(this.cbor);
      this.CONSUME(EmbedEnd);
    });

    this.string_concatenation = this.RULE("string_concatenation", () => {
      this.SUBRULE(this.annotated_string);
      this.MANY(() => {
        this.CONSUME(Plus);
        this.SUBRULE2(this.annotated_string);
      });
    });

    this.annotated_string = this.RULE("annotated_string", () => {
      this.OR([
        { ALT: () => this.CONSUME(StringLiteral) },
        { ALT: () => this.CONSUME(HexBytes) },
        { ALT: () => this.CONSUME(B64Bytes) },
        { ALT: () => this.CONSUME(AppString) },
        { ALT: () => this.SUBRULE(this.embedded) },
        { ALT: () => this.CONSUME(Ellipsis) },
      ]);
      this.OPTION(() => this.CONSUME(Spec));
    });

    this.annotated_number = this.RULE("annotated_number", () => {
      this.OR([
        { ALT: () => this.CONSUME(HexFloat) },
        { ALT: () => this.CONSUME(HexInt) },
        { ALT: () => this.CONSUME(OctInt) },
        { ALT: () => this.CONSUME(BinInt) },
        { ALT: () => this.CONSUME(NonFin) },
        { ALT: () => this.CONSUME(NumberLiteral) },
      ]);
      this.OPTION(() => this.CONSUME(Spec));
    });

    this.simple_value = this.RULE("simple_value", () => {
      this.CONSUME(SimpleKey);
      this.CONSUME(LParen);
      this.CONSUME(NumberLiteral);
      this.CONSUME(RParen);
      this.OPTION(() => this.CONSUME(Spec));
    });
    this.performSelfAnalysis();
  }

  private looksLikeTag(): boolean {
    const t1 = this.LA(1);
    const isNum =
      tokenMatcher(t1, NumberLiteral) ||
      tokenMatcher(t1, HexInt) ||
      tokenMatcher(t1, OctInt) ||
      tokenMatcher(t1, BinInt);

    if (!isNum) return false;
    const t2 = this.LA(2);
    if (tokenMatcher(t2, LParen)) return true;
    if (tokenMatcher(t2, Spec)) {
      const t3 = this.LA(3);
      if (tokenMatcher(t3, LParen)) return true;
    }

    return false;
  }
}

export const parserInstance = new CborParser();

export interface ParseResult {
  cst: any;
  lexErrors: any[];
  parseErrors: any[];
  value: any;
}

const BaseCborVisitor = parserInstance.getBaseCstVisitorConstructor();

export class CborVisitor extends BaseCborVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  cbor(ctx: any) {
    if (ctx.value) {
      return ctx.value.map((v: any) => this.visit(v));
    }
    return [];
  }
  value(ctx: any) {
    if (ctx.map) return this.visit(ctx.map);
    if (ctx.array) return this.visit(ctx.array);
    if (ctx.tag) return this.visit(ctx.tag);
    if (ctx.string_concatenation) return this.visit(ctx.string_concatenation);
    if (ctx.streamstring) return this.visit(ctx.streamstring);
    if (ctx.embedded) return this.visit(ctx.embedded);
    if (ctx.simple_value) return this.visit(ctx.simple_value);
    if (ctx.annotated_number) return this.visit(ctx.annotated_number);

    if (ctx.True) return true;
    if (ctx.False) return false;
    if (ctx.Null) return null;
    if (ctx.Undefined) return undefined;

    return null;
  }

  map(ctx: any) {
    const obj: any = {};
    if (ctx.pair) {
      ctx.pair.forEach((pairCtx: any) => {
        const entry = this.visit(pairCtx);
        obj[entry.key] = entry.value;
      });
    }
    return obj;
  }

  pair(ctx: any) {
    const key = this.visit(ctx.value[0]);
    const val = this.visit(ctx.value[1]);
    return { key, value: val };
  }

  array(ctx: any) {
    if (!ctx.value) return [];
    return ctx.value.map((v: any) => this.visit(v));
  }

  tag(ctx: any) {
    const cleanSign = (str: string) =>
      str.startsWith("+") ? str.slice(1) : str;
    let tagNumber = 0;

    if (ctx.HexInt) {
      tagNumber = parseInt(cleanSign(ctx.HexInt[0].image), 16);
    } else if (ctx.OctInt) {
      tagNumber = parseInt(cleanSign(ctx.OctInt[0].image).replace("0o", ""), 8);
    } else if (ctx.BinInt) {
      tagNumber = parseInt(cleanSign(ctx.BinInt[0].image).replace("0b", ""), 2);
    } else if (ctx.Number) {
      let raw = ctx.Number[0].image;
      raw = raw.replace(/_\d+$/, "");
      tagNumber = Number(raw);
    }

    const content = this.visit(ctx.value);
    return new Tag(tagNumber, content);
  }

  annotated_string(ctx: any) {
    if (ctx.Ellipsis) return new Tag(888, null);

    const toU8 = (buf: Buffer | number[]): Uint8Array => {
      return new Uint8Array(buf);
    };

    if (ctx.AppString) {
      const rawImage = ctx.AppString[0].image;
      const tickPos = rawImage.indexOf("'");
      const prefix = rawImage.substring(0, tickPos);
      const content = rawImage.substring(tickPos + 1, rawImage.length - 1);

      //
      if (prefix === "ip" || prefix === "IP") {
        try {
          let addr: ipaddr.IPv4 | ipaddr.IPv6;
          let prefixLen: number | null = null;
          let isCidr = false;

          // Check for CIDR notation
          if (content.includes("/")) {
            const cidr = ipaddr.parseCIDR(content);
            addr = cidr[0];
            prefixLen = cidr[1];
            isCidr = true;
          } else {
            addr = ipaddr.parse(content);
          }

          let bytes = addr.toByteArray();

          // Handle IPv4-mapped IPv6 addresses
          if (
            addr.kind() === "ipv6" &&
            (addr as ipaddr.IPv6).isIPv4MappedAddress()
          ) {
            if (
              content.startsWith("::") &&
              !content.toLowerCase().includes("ffff")
            ) {
              bytes[10] = 0;
              bytes[11] = 0;
            }
          }
          // If CIDR, zero out bits beyond the prefix length
          if (isCidr && prefixLen !== null) {
            for (let i = 0; i < bytes.length; i++) {
              const bitPos = i * 8;
              if (bitPos >= prefixLen) {
                bytes[i] = 0;
              } else if (bitPos + 8 > prefixLen) {
                const bitsToKeep = prefixLen - bitPos;
                const mask = 0xff << (8 - bitsToKeep);
                bytes[i] = bytes[i] & mask;
              }
            }
          }
          // Determine tag number
          const isV4 = addr.kind() === "ipv4";
          const tagNum = isV4 ? 52 : 54;

          // Return CIDR structure
          if (isCidr && prefixLen !== null) {
            const buf = Buffer.from(bytes);
            let trimLen = buf.length;
            while (trimLen > 0 && buf[trimLen - 1] === 0) trimLen--;
            const trimmedBytes = toU8(buf.subarray(0, trimLen));

            const arrayStructure = [prefixLen, trimmedBytes];

            if (prefix === "IP") {
              return new Tag(tagNum, arrayStructure);
            } else {
              return arrayStructure;
            }
          }
          // Return plain IP address
          if (prefix === "IP") {
            return new Tag(tagNum, toU8(bytes));
          } else {
            return toU8(bytes);
          }
        } catch (e) {
          return content;
        }
      }
      if (prefix === "dt" || prefix === "DT") {
        const date = new Date(content);
        const timestamp = date.getTime() / 1000;

        if (prefix === "dt") return timestamp;
        if (prefix === "DT") return new Tag(1, timestamp);
      }
      return rawImage;
    }
    if (ctx.String) {
      const raw = ctx.String[0].image;
      const isSingleQuote = raw.trim().startsWith("'");
      try {
        const cleanRaw = raw.replace(/\r?\n/g, "\\n");
        const value = new Function("return " + cleanRaw)();
        if (isSingleQuote) {
          return toU8(Buffer.from(value, "utf-8"));
        }
        return value;
      } catch (e) {
        return raw.slice(1, -1);
      }
    }

    if (ctx.HexBytes) {
      const hex = ctx.HexBytes[0].image.slice(2, -1).replace(/\s/g, "");
      return toU8(Buffer.from(hex, "hex"));
    }

    if (ctx.B64Bytes) {
      let b64 = ctx.B64Bytes[0].image.slice(4, -1).replace(/\s/g, "");
      if (b64.startsWith("'") || b64.startsWith('"')) b64 = b64.slice(1, -1);
      return toU8(Buffer.from(b64, "base64"));
    }

    if (ctx.embedded) return this.visit(ctx.embedded);
    return "";
  }
  annotated_number(ctx: any) {
    let val: number | bigint | null = null;
    let isFloat = false;

    if (ctx.HexFloat) {
      val = parseHexFloat(ctx.HexFloat[0].image);
      if (ctx.HexFloat[0].image.trim().startsWith("-")) val = -Math.abs(val);
      isFloat = true;
    } else if (ctx.HexInt) {
      let text = ctx.HexInt[0].image.replace(/_/g, "");
      const isNeg = text.trim().startsWith("-");
      text = text.replace(/^[+\-]/, "");
      val = BigInt(text);
      if (isNeg) val = -val;
    } else if (ctx.OctInt) {
      let text = ctx.OctInt[0].image.replace(/_/g, "");
      const isNeg = text.trim().startsWith("-");
      text = text.replace(/^[+\-]/, "").replace("0o", "");
      val = BigInt("0o" + text);
      if (isNeg) val = -val;
    } else if (ctx.BinInt) {
      let text = ctx.BinInt[0].image.replace(/_/g, "");
      const isNeg = text.trim().startsWith("-");
      text = text.replace(/^[+\-]/, "").replace("0b", "");
      val = BigInt("0b" + text);
      if (isNeg) val = -val;
    } else if (ctx.Number) {
      let raw = ctx.Number[0].image.replace(/_\d+$/, "").replace(/_/g, "");
      if (/[.eE]/.test(raw)) {
        val = Number(raw);
        isFloat = true;
      } else {
        val = BigInt(raw);
      }
    } else if (ctx.NonFin) {
      val = Number(ctx.NonFin[0].image);
      isFloat = true;
    }
    if (ctx.Spec && val !== null) {
      const spec = ctx.Spec[0].image;
      if (isFloat) {
        const numVal = Number(val);
        if (spec === "_1") return encodedNumber(numVal, "f16");
        if (spec === "_2") return encodedNumber(numVal, "f32");
        if (spec === "_3") return encodedNumber(numVal, "f64");
      } else {
        let numVal = val;
        if (
          typeof val === "bigint" &&
          val <= Number.MAX_SAFE_INTEGER &&
          val >= Number.MIN_SAFE_INTEGER
        )
          numVal = Number(val);
        if (spec === "_0") return encodedNumber(numVal, "i8");
        if (spec === "_1") return encodedNumber(numVal, "i16");
        if (spec === "_2") return encodedNumber(numVal, "i32");
        if (spec === "_3") return encodedNumber(numVal, "i64");
      }
    }

    if (isFloat && val !== null) {
      const num = Number(val);
      if (Object.is(num, -0)) return num;
      if (Number.isInteger(num)) {
        return encodedNumber(num, "f64");
      }
      return num;
    }

    return val;
  }
  string_concatenation(ctx: any) {
    const parts = ctx.annotated_string.map((child: any) => this.visit(child));

    if (parts.length === 1) return parts[0];
    const hasEllipsis = parts.some(
      (p: any) => p instanceof Tag && p.tag === 888,
    );

    if (hasEllipsis) {
      return new Tag(888, parts);
    }

    if (parts.every((p: any) => typeof p === "string")) {
      return parts.join("");
    }

    const buffers = parts.map((p: any) => {
      if (p instanceof Uint8Array) return Buffer.from(p);
      if (Buffer.isBuffer(p)) return p;
      if (typeof p === "string") return Buffer.from(p, "utf-8");
      return Buffer.alloc(0);
    });

    const buf = Buffer.concat(buffers);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  streamstring(ctx: any) {
    if (ctx.annotated_string) {
      const parts = ctx.annotated_string.map((child: any) => this.visit(child));
      if (parts.length > 0 && Buffer.isBuffer(parts[0])) {
        return Buffer.concat(parts);
      } else {
        return parts.join("");
      }
    }
    return "";
  }

  embedded(ctx: any) {
    return this.visit(ctx.cbor);
  }
  simple_value(ctx: any) {
    if (!ctx.Number || ctx.Number.length === 0) {
      return new Simple(0);
    }
    const val = Number(ctx.Number[0].image);
    return new Simple(val);
  }
}

export function parseCborEdn(text: string): ParseResult {
  const lexResult = CborLexer.tokenize(text);
  parserInstance.input = lexResult.tokens;

  const visitor = new CborVisitor();
  const cst = parserInstance.cbor();

  const value = visitor.visit(cst);

  return {
    cst: cst,
    lexErrors: lexResult.errors,
    parseErrors: parserInstance.errors,
    value: value,
  };
}
