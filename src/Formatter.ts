import { parserInstance } from "./CborParser";
import { IToken } from "chevrotain";

const BaseCborVisitor = parserInstance.getBaseCstVisitorConstructor();

/**
 * Visitor class responsible for formatting
 * Concrete Syntax Tree into a prettified string.
 * It handles indentation, line breaks, and the re-insertion of comments
 * based on their original source positions.
 */
class CborFormatterVisitor extends BaseCborVisitor {
  private output: string[] = [];
  private indentLevel = 0;

  private comments: IToken[] = [];
  private lastTokenEndOffset = 0;
  private lastPrintedLine = 0;

  /**
   * Initializes a new instance of the formatter visitor.
   * @param comments - An array of comment tokens extracted during lexing.
   */
  constructor(comments: IToken[]) {
    super();
    this.comments = comments;
    this.validateVisitor();
  }

  /**
   * Appends a string to the output buffer.
   * @param str - The string to append.
   */
  private push(str: string) {
    this.output.push(str);
  }

  /**
   * Adds a newline and the appropriate amount of indentation to the output.
   */
  private newline() {
    this.push("\n");
    this.push("  ".repeat(this.indentLevel));
  }

  /**
   * Calculates the length of the current line being constructed.
   * @returns The number of characters on the current line.
   */
  private getCurrentLineLength(): number {
    let length = 0;
    for (let i = this.output.length - 1; i >= 0; i--) {
      const chunk = this.output[i];
      const lastNewline = chunk.lastIndexOf("\n");
      if (lastNewline !== -1) {
        length += chunk.length - lastNewline - 1;
        break;
      }
      length += chunk.length;
    }
    return length;
  }

  /**
   * Searches the context for a specific opening token.
   * @param ctx - The current CST node context.
   * @param char - The character image to look for.
   * @returns The found token or undefined.
   */
  private findOpeningToken(ctx: any, char: string): IToken | undefined {
    for (const key in ctx) {
      const item = ctx[key][0];
      if (item && item.image === char && item.startLine !== undefined) {
        return item;
      }
    }
    return undefined;
  }

  /**
   * Identifies and prints comments that appear before the current CST node.
   * @param ctx - The current CST node context.
   */
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
    relevantComments.forEach((c) => {
      const lastChunk =
        this.output.length > 0 ? this.output[this.output.length - 1] : "";
      const targetLen = (c.startColumn || 1) - 1;
      if (lastChunk.trim() !== "") {
        this.push("\n");
        this.push(" ".repeat(Math.max(0, targetLen)));
      } else {
        this.output[this.output.length - 1] = " ".repeat(
          Math.max(0, targetLen),
        );
      }
      this.push(c.image);
      this.newline();
      this.lastTokenEndOffset = (c.endOffset || 0) + 1;
    });
  }

  /**
   * Updates the global offset and line counters based on the tokens in the current context.
   * @param ctx - The current CST node context.
   */
  private updateLastOffset(ctx: any) {
    for (const key in ctx) {
      if (Array.isArray(ctx[key])) {
        const lastItem = ctx[key][ctx[key].length - 1];
        if (lastItem.endOffset !== undefined) {
          this.lastTokenEndOffset = Math.max(
            this.lastTokenEndOffset,
            lastItem.endOffset + 1,
          );
          this.lastPrintedLine = Math.max(
            this.lastPrintedLine,
            lastItem.endLine || lastItem.startLine || 0,
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
    const openBrace = this.findOpeningToken(ctx, "{");
    this.push("{");
    if (openBrace) {
      this.lastPrintedLine = openBrace.startLine ?? 0;
      this.lastTokenEndOffset =
        (openBrace.endOffset || openBrace.startOffset) + 1;
      this.printTrailingCommentsForCurrentLine();
    }

    if (ctx.Spec) this.push(ctx.Spec[0].image);

    if (ctx.pair) {
      this.indentLevel++;
      this.newline();
      ctx.pair.forEach((p: any, i: number) => {
        this.visit(p);
        if (i < ctx.pair.length - 1) {
          this.push(",");
          const commaToken = ctx.Comma ? ctx.Comma[i] : undefined;
          if (commaToken) {
            this.lastPrintedLine = commaToken.startLine;
            this.lastTokenEndOffset = Math.max(
              this.lastTokenEndOffset,
              (commaToken.endOffset || commaToken.startOffset) + 1,
            );
          }
        }
        this.printTrailingCommentsForCurrentLine();
        if (i < ctx.pair.length - 1) {
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
    const openBracket = this.findOpeningToken(ctx, "[");
    this.push("[");
    if (openBracket) {
      this.lastPrintedLine = openBracket.startLine ?? 0;
      this.lastTokenEndOffset =
        (openBracket.endOffset || openBracket.startOffset) + 1;
      this.printTrailingCommentsForCurrentLine();
    }
    if (ctx.Spec) this.push(ctx.Spec[0].image);

    if (ctx.value) {
      this.indentLevel++;
      this.newline();

      ctx.value.forEach((v: any, i: number) => {
        this.visit(v);

        if (i < ctx.value.length - 1) {
          this.push(",");
          const commaToken = ctx.Comma ? ctx.Comma[i] : undefined;
          if (commaToken) {
            this.lastPrintedLine = commaToken.startLine;
            this.lastTokenEndOffset = Math.max(
              this.lastTokenEndOffset,
              (commaToken.endOffset || commaToken.startOffset) + 1,
            );
          }
        }
        this.printTrailingCommentsForCurrentLine();
        if (i < ctx.value.length - 1) {
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

  /**
   * Prints comments that exist on the same line as the last printed token
   */
  private printTrailingCommentsForCurrentLine() {
    const trailing = this.comments.filter(
      (c) =>
        c.startLine === this.lastPrintedLine &&
        c.startOffset >= this.lastTokenEndOffset,
    );
    trailing.forEach((c) => {
      const currentLen = this.getCurrentLineLength();
      const targetLen = (c.startColumn || 1) - 1;
      const padding = Math.max(1, targetLen - currentLen);
      this.push(" ".repeat(padding));
      this.push(c.image);
      this.lastTokenEndOffset =
        (c.endOffset || c.startOffset + c.image.length) + 1;
    });
  }
}

/**
 * Main entry point for formatting CBOR EDN.
 * @param cst - The Concrete Syntax Tree produced by the parser.
 * @param comments - Optional array of comment tokens to include in the output.
 * @returns The formatted and prettified EDN string.
 */
export function formatCborEdn(cst: any, comments: IToken[] = []): string {
  const visitor = new CborFormatterVisitor(comments);
  visitor.visit(cst);
  return visitor.getResult();
}
