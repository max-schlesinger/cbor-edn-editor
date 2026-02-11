import { parserInstance } from "./CborParser";
import { IToken } from "chevrotain";

const BaseCborVisitor = parserInstance.getBaseCstVisitorConstructor();

class CborFormatterVisitor extends BaseCborVisitor {
  private output: string[] = [];
  private indentLevel = 0;

  private comments: IToken[] = [];
  private lastTokenEndOffset = 0;

  constructor(comments: IToken[]) {
    super();
    this.comments = comments;
    this.validateVisitor();
  }

  private push(str: string) {
    this.output.push(str);
  }

  private newline() {
    this.push("\n");
    this.push("  ".repeat(this.indentLevel));
  }

  private printCommentsBefore(ctx: any) {
    let startOffset = Infinity;

    for (const key in ctx) {
      if (Array.isArray(ctx[key]) && ctx[key].length > 0) {
        const tokenOrNode = ctx[key][0];
        if (
          tokenOrNode.startOffset !== undefined &&
          !isNaN(tokenOrNode.startOffset)
        ) {
          startOffset = Math.min(startOffset, tokenOrNode.startOffset);
        } else if (
          tokenOrNode.location &&
          !isNaN(tokenOrNode.location.startOffset)
        ) {
          startOffset = Math.min(startOffset, tokenOrNode.location.startOffset);
        }
      }
    }

    if (startOffset === Infinity) return;

    const relevantComments = this.comments.filter(
      (c) =>
        c.startOffset >= this.lastTokenEndOffset && c.startOffset < startOffset,
    );

    if (relevantComments.length > 0) {
      if (
        this.output.length > 0 &&
        !this.output[this.output.length - 1].endsWith("\n") &&
        !this.output[this.output.length - 1].endsWith("  ")
      ) {
        this.newline();
      }

      relevantComments.forEach((c) => {
        this.push(c.image);
        this.newline();
        this.lastTokenEndOffset = c.endOffset || c.startOffset + c.image.length;
      });
    }
  }

  private updateLastOffset(ctx: any) {
    for (const key in ctx) {
      if (Array.isArray(ctx[key])) {
        const lastItem = ctx[key][ctx[key].length - 1];
        if (lastItem.endOffset !== undefined) {
          this.lastTokenEndOffset = Math.max(
            this.lastTokenEndOffset,
            lastItem.endOffset + 1,
          );
        }
      }
    }
  }
  cbor(ctx: any) {
    if (ctx.value) {
      ctx.value.forEach((v: any, index: number) => {
        this.visit(v);
        if (index < ctx.value.length - 1) {
          this.push(",");
          this.newline();
        }
      });
    }
  }

  value(ctx: any) {
    this.printCommentsBefore(ctx);

    if (ctx.map) this.visit(ctx.map);
    else if (ctx.array) this.visit(ctx.array);
    else if (ctx.tag) this.visit(ctx.tag);
    else if (ctx.string_concatenation) this.visit(ctx.string_concatenation);
    else if (ctx.streamstring) this.visit(ctx.streamstring);
    else if (ctx.simple_value) this.visit(ctx.simple_value);
    else if (ctx.annotated_number) this.visit(ctx.annotated_number);
    else if (ctx.annotated_string) this.visit(ctx.annotated_string);
    else if (ctx.True) this.push("true");
    else if (ctx.False) this.push("false");
    else if (ctx.Null) this.push("null");
    else if (ctx.Undefined) this.push("undefined");

    this.updateLastOffset(ctx);
  }

  map(ctx: any) {
    this.push("{");
    if (ctx.Spec) this.push(ctx.Spec[0].image);

    if (ctx.pair) {
      this.indentLevel++;
      this.newline();
      ctx.pair.forEach((p: any, i: number) => {
        this.visit(p);
        if (i < ctx.pair.length - 1) {
          this.push(",");
          this.newline();
        }
      });
      this.indentLevel--;
      this.newline();
    }
    this.push("}");
  }

  pair(ctx: any) {
    this.printCommentsBefore(ctx);
    this.visit(ctx.value[0]);
    this.push(": ");
    this.visit(ctx.value[1]);
    this.updateLastOffset(ctx);
  }

  array(ctx: any) {
    this.push("[");
    if (ctx.Spec) this.push(ctx.Spec[0].image);

    if (ctx.value) {
      this.indentLevel++;
      this.newline();
      ctx.value.forEach((v: any, i: number) => {
        this.visit(v);
        if (i < ctx.value.length - 1) {
          this.push(",");
          this.newline();
        }
      });
      this.indentLevel--;
      this.newline();
    }
    this.push("]");
  }

  tag(ctx: any) {
    if (ctx.Number) this.push(ctx.Number[0].image);
    else if (ctx.HexInt) this.push(ctx.HexInt[0].image);
    else if (ctx.OctInt) this.push(ctx.OctInt[0].image);
    else if (ctx.BinInt) this.push(ctx.BinInt[0].image);

    if (ctx.Spec) this.push(ctx.Spec[0].image);

    this.push("(");
    this.visit(ctx.value);
    this.push(")");
  }

  annotated_string(ctx: any) {
    this.printCommentsBefore(ctx);
    if (ctx.String) this.push(ctx.String[0].image);
    else if (ctx.HexBytes) this.push(ctx.HexBytes[0].image);
    else if (ctx.B64Bytes) this.push(ctx.B64Bytes[0].image);
    else if (ctx.AppString) this.push(ctx.AppString[0].image);
    else if (ctx.embedded) this.visit(ctx.embedded);

    if (ctx.Spec) this.push(ctx.Spec[0].image);
    this.updateLastOffset(ctx);
  }

  annotated_number(ctx: any) {
    this.printCommentsBefore(ctx);
    const token =
      ctx.Number ||
      ctx.HexFloat ||
      ctx.HexInt ||
      ctx.OctInt ||
      ctx.BinInt ||
      ctx.NonFin;
    if (token) this.push(token[0].image);
    if (ctx.Spec) this.push(ctx.Spec[0].image);
    this.updateLastOffset(ctx);
  }

  simple_value(ctx: any) {
    this.push(ctx.SimpleKey[0].image + "(" + ctx.Number[0].image + ")");
  }

  streamstring(ctx: any) {
    this.push("(_ ");
    ctx.annotated_string.forEach((s: any) => {
      this.visit(s);
      this.push(", ");
    });
    this.push(")");
  }

  string_concatenation(ctx: any) {
    ctx.annotated_string.forEach((s: any, i: number) => {
      this.visit(s);
      if (i < ctx.annotated_string.length - 1) this.push(" + ");
    });
  }

  embedded(ctx: any) {
    this.push("<< ");
    this.visit(ctx.cbor);
    this.push(" >>");
  }

  public getResult() {
    return this.output.join("");
  }
}

export function formatCborEdn(cst: any, comments: IToken[] = []): string {
  const visitor = new CborFormatterVisitor(comments);
  visitor.visit(cst);
  return visitor.getResult();
}
