import { createToken, Lexer, CstParser } from "chevrotain";
import * as cbor from "cbor";

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

const True = createToken({ name: "True", pattern: /true/ });
const False = createToken({ name: "False", pattern: /false/ });
const Null = createToken({ name: "Null", pattern: /null/ });
const Undefined = createToken({ name: "Undefined", pattern: /undefined/ });

const HexBytes = createToken({
  name: "HexBytes",
  pattern: /h'[0-9a-fA-F\s]*'/,
});
const StringLiteral = createToken({
  name: "String",
  pattern: /"(?:[^\\"]|\\.)*"/,
});
const NumberLiteral = createToken({
  name: "Number",
  pattern:
    /-?(?:0|[1-9][0-9_]*)(?:\.[0-9_]+)?(?:[eE][+-]?[0-9_]+)?(?:_[0-9]+)?/,
});

const allTokens = [
  WhiteSpace,
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
  HexBytes,
  StringLiteral,
  NumberLiteral,
];

export const CborLexer = new Lexer(allTokens);

export class CborParser extends CstParser {
  public cbor!: () => any;
  public value!: () => any;
  public map!: () => any;
  public pair!: () => any;
  public array!: () => any;
  public tag!: () => any;

  constructor() {
    super(allTokens);

    this.cbor = this.RULE("cbor", () => {
      this.SUBRULE(this.value);
    });

    this.value = this.RULE("value", () => {
      this.OR([
        { ALT: () => this.SUBRULE(this.map) },
        { ALT: () => this.SUBRULE(this.array) },
        { ALT: () => this.CONSUME(StringLiteral) },
        { ALT: () => this.CONSUME(HexBytes) },
        { ALT: () => this.SUBRULE(this.tag) },
        { ALT: () => this.CONSUME(NumberLiteral) },
        { ALT: () => this.CONSUME(True) },
        { ALT: () => this.CONSUME(False) },
        { ALT: () => this.CONSUME(Null) },
        { ALT: () => this.CONSUME(Undefined) },
      ]);
    });

    this.map = this.RULE("map", () => {
      this.CONSUME(LBrace);
      this.MANY_SEP({
        SEP: Comma,
        DEF: () => this.SUBRULE(this.pair),
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
      this.MANY_SEP({
        SEP: Comma,
        DEF: () => this.SUBRULE(this.value),
      });
      this.CONSUME(RBracket);
    });

    this.tag = this.RULE("tag", () => {
      this.CONSUME(NumberLiteral);
      this.CONSUME(LParen);
      this.SUBRULE(this.value);
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
}

export function parseCborEdn(text: string): ParseResult {
  const lexResult = CborLexer.tokenize(text);

  parserInstance.input = lexResult.tokens;

  const cst = parserInstance.cbor();

  return {
    cst: cst,
    lexErrors: lexResult.errors,
    parseErrors: parserInstance.errors,
  };
}
const BaseCborVisitor = parserInstance.getBaseCstVisitorConstructor();

export class CborVisitor extends BaseCborVisitor {
  constructor() {
    super();
    this.validateVisitor();
  }

  cbor(ctx: any) {
    return this.visit(ctx.value);
  }

  value(ctx: any) {
    if (ctx.map) return this.visit(ctx.map);
    if (ctx.array) return this.visit(ctx.array);
    if (ctx.String) return JSON.parse(ctx.String[0].image);
    if (ctx.HexBytes) {
      const hexString = ctx.HexBytes[0].image.slice(2, -1).replace(/\s/g, "");
      return Buffer.from(hexString, "hex");
    }
    if (ctx.tag) return this.visit(ctx.tag);
    if (ctx.Number) {
      let raw = ctx.Number[0].image;
      raw = raw.replace(/_\d+$/, "");
      const cleanNumberString = raw.replace(/_/g, "");
      return Number(cleanNumberString);
    }
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
    const tagNumber = Number(ctx.Number[0].image);
    const content = this.visit(ctx.value);
    return new cbor.Tagged(tagNumber, content);
  }
}
