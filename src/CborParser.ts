import { createToken, Lexer, CstParser } from "chevrotain";
import * as cbor from "cbor";

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

const LBrace = createToken({ name: "LBrace", pattern: /{/ });
const RBrace = createToken({ name: "RBrace", pattern: /}/ });
const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
const RBracket = createToken({ name: "RBracket", pattern: /]/ });
const LParen = createToken({ name: "LParen", pattern: /\(/ });
const RParen = createToken({ name: "RParen", pattern: /\)/ });
const Colon = createToken({ name: "Colon", pattern: /:/ });
const Comma = createToken({ name: "Comma", pattern: /,/ });
const Plus = createToken({ name: "Plus", pattern: /\+/ });

const StreamStart = createToken({ name: "StreamStart", pattern: /\(_/ });
const EmbedStart = createToken({ name: "EmbedStart", pattern: /<</ });
const EmbedEnd = createToken({ name: "EmbedEnd", pattern: />>/ });

const True = createToken({ name: "True", pattern: /true/ });
const False = createToken({ name: "False", pattern: /false/ });
const Null = createToken({ name: "Null", pattern: /null/ });
const Undefined = createToken({ name: "Undefined", pattern: /undefined/ });
const SimpleKey = createToken({
  name: "SimpleKey",
  pattern: /simple(?=\s*\()/,
});

const HexBytes = createToken({
  name: "HexBytes",
  pattern: /h'[0-9a-fA-F\s]*'/,
});
const B64Bytes = createToken({
  name: "B64Bytes",
  pattern: /b64'[a-zA-Z0-9+/=\s]*'/,
});
const StringLiteral = createToken({
  name: "String",
  pattern: /"(?:[^\\"]|\\.)*"|'(?:[^\\']|\\.)*'/,
});

const HexFloat = createToken({
  name: "HexFloat",
  pattern: /[+-]?0x[0-9a-fA-F]+(\.[0-9a-fA-F]*)?[pP][+-]?\d+/,
});
const HexInt = createToken({ name: "HexInt", pattern: /[+-]?0x[0-9a-fA-F]+/ });
const BinInt = createToken({ name: "BinInt", pattern: /[+-]?0b[0-1]+/ });
const OctInt = createToken({ name: "OctInt", pattern: /[+-]?0o[0-7]+/ });
const NonFin = createToken({
  name: "NonFin",
  pattern: /Infinity|-Infinity|NaN/,
});
const NumberLiteral = createToken({
  name: "Number",
  pattern:
    /[+-]?(?:0|[1-9][0-9_]*)(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?(?:_[0-9]+)?/,
});
const Spec = createToken({ name: "Spec", pattern: /_[a-zA-Z0-9_]+/ });
const Ellipsis = createToken({ name: "Ellipsis", pattern: /\.{3,}/ });
const AppString = createToken({
  name: "AppString",
  pattern: /[a-zA-Z][a-zA-Z0-9]*'(?:[^\\']|\\.)*'/,
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
];

export const CborLexer = new Lexer(allTokens);

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
        { GATE: this.BACKTRACK(this.tag), ALT: () => this.SUBRULE(this.tag) },
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
      this.MANY(() => {
        this.CONSUME(StringLiteral);
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
    });
    this.performSelfAnalysis();
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
      const cleanNumberString = raw.replace(/_/g, "");
      tagNumber = Number(cleanNumberString);
    }

    const content = this.visit(ctx.value);
    return new cbor.Tagged(tagNumber, content);
  }

  annotated_string(ctx: any) {
    if (ctx.Ellipsis) return "...";
    if (ctx.String) {
      const raw = ctx.String[0].image;
      return JSON.parse(raw.startsWith("'") ? `"${raw.slice(1, -1)}"` : raw);
    }
    if (ctx.HexBytes) {
      const hex = ctx.HexBytes[0].image.slice(2, -1).replace(/\s/g, "");
      return Buffer.from(hex, "hex");
    }
    if (ctx.B64Bytes) {
      const b64 = ctx.B64Bytes[0].image.slice(4, -1).replace(/\s/g, "");
      return Buffer.from(b64, "base64");
    }
    if (ctx.AppString) {
      return ctx.AppString[0].image;
    }
    if (ctx.embedded) {
      return this.visit(ctx.embedded);
    }
    return "";
  }

  annotated_number(ctx: any) {
    const cleanSign = (str: string) =>
      str.startsWith("+") ? str.slice(1) : str;
    if (ctx.HexInt) {
      return parseInt(cleanSign(ctx.HexInt[0].image), 16);
    }
    if (ctx.OctInt) {
      const raw = cleanSign(ctx.OctInt[0].image);
      return parseInt(raw.replace("0o", ""), 8);
    }
    if (ctx.BinInt) {
      const raw = cleanSign(ctx.BinInt[0].image);
      return parseInt(raw.replace("0b", ""), 2);
    }
    if (ctx.HexFloat) {
      return parseFloat(cleanSign(ctx.HexFloat[0].image));
    }
    if (ctx.Number) {
      let raw = ctx.Number[0].image;
      raw = raw.replace(/_\d+$/, "");
      const cleanNumberString = raw.replace(/_/g, "");
      return Number(cleanNumberString);
    }
    if (ctx.NonFin) {
      return Number(ctx.NonFin[0].image);
    }
    return NaN;
  }

  string_concatenation(ctx: any) {
    return ctx.annotated_string.map((child: any) => this.visit(child)).join("");
  }

  streamstring(ctx: any) {
    if (!ctx.String) return "";
    return ctx.String.map((t: any) => {
      const raw = t.image;
      return JSON.parse(raw.startsWith("'") ? `"${raw.slice(1, -1)}"` : raw);
    }).join("");
  }

  embedded(ctx: any) {
    return this.visit(ctx.cbor);
  }
  simple_value(ctx: any) {
    const val = Number(ctx.Number[0].image);
    return new cbor.Simple(val);
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
