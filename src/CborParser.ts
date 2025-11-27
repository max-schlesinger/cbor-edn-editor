import * as cbor from "cbor";

export class CborParser {
  private input: string;
  private pos: number;
  private line: number;
  private column: number;

  constructor(input: string) {
    this.input = input;
    this.pos = 0;
    this.line = 0;
    this.column = 0;
  }

  public static parse(input: string): any {
    const parser = new CborParser(input);
    const result = parser.parseValue();
    parser.skipWhiteSpace();
    if (parser.pos < parser.input.length) {
      throw parser.error("unexpected sign after the end of the data");
    }
    return result;
  }

  private peek(): string {
    return this.input[this.pos] || "";
  }

  private consume(): string {
    const char = this.input[this.pos++];
    if (char == "\n") {
      this.line++;
      this.column = 0;
    } else {
      this.column++;
    }
    return char;
  }

  private error(msg: string): Error {
    const e: any = new Error(
      `${msg} (Zeile ${this.line + 1}, Spalte ${this.column + 1})`,
    );
    e.line = this.line;
    e.column = this.column;
    return e;
  }

  private skipWhiteSpace() {
    while (/\s/.test(this.peek())) {
      this.consume();

      if (this.input.startsWith("//", this.pos)) {
        while (this.peek() !== "\n" && this.peek() !== "") {
          this.consume();
        }
        this.skipWhiteSpace();
      }
    }
  }

  private parseValue(): any {
    this.skipWhiteSpace();
    const char = this.peek();
    if (char === "") throw this.error("Error1 ");
    if (char === "{") return this.parseMap();
    if (char === "[") return this.parseArray();
    if (char === '"') return this.parseString();
    if (char === "h" && this.input[this.pos + 1] === "'")
      return this.parseByteString();
    if (/[0-9-]/.test(char)) return this.parseNumberOrTag();
    if (char === "t") return this.parseKeyword("true", true);
    if (char === "f") return this.parseKeyword("false", false);
    if (char === "n") return this.parseKeyword("null", null);
    if (char === "u") return this.parseKeyword("undefined", undefined);

    throw this.error(`Error2: '${char}'`);
  }

  private parseMap(): any {
    this.consume(); // {
    const result: any = {};
    this.skipWhiteSpace();

    if (this.peek() === "}") {
      this.consume();
      return result;
    }

    while (true) {
      const key = this.parseValue();
      this.skipWhiteSpace();
      if (this.consume() !== ":")
        throw this.error("Error3 (Doppelpunkt erwartet)");
      const value = this.parseValue();

      result[key] = value;

      const errorLine = this.line;
      const errorCol = this.column;

      this.skipWhiteSpace();

      if (this.peek() === "}") {
        this.consume();
        break;
      }

      if (this.peek() !== ",") {
        const e: any = new Error("Error4 (Komma erwartet)");
        e.line = errorLine;
        e.column = errorCol;
        throw e;
      }

      this.consume();
    }
    return result;
  }

  private parseArray(): any[] {
    this.consume(); // [
    const result: any = [];
    this.skipWhiteSpace();

    if (this.peek() === "]") {
      this.consume();
      return result;
    }

    while (true) {
      result.push(this.parseValue());

      const errorLine = this.line;
      const errorCol = this.column;

      this.skipWhiteSpace();

      if (this.peek() === "]") {
        this.consume();
        break;
      }

      if (this.peek() !== ",") {
        const e: any = new Error("Error5 (Komma erwartet)");

        e.line = errorLine;
        e.column = errorCol;
        throw e;
      }

      this.consume();
    }
    return result;
  }

  private parseString(): string {
    this.consume(); // "
    let result = "";
    while (true) {
      const char = this.consume();
      if (char === "\\") {
        const escape = this.consume();
        if (escape === '"') result += '"';
        else if (escape === "n") result += "\n";
        else if (escape === "\\") result += "\\";
        else result += escape;
      } else if (char === '"') {
        break;
      } else if (char === "") {
        throw this.error("Error6");
      } else {
        result += char;
      }
    }
    return result;
  }
  private parseByteString(): Buffer {
    this.consume();
    this.consume();
    let hex = "";
    while (true) {
      const char = this.consume();
      if (char === "'") break;
      if (/[0-9a-fA-F]/.test(char)) {
        hex += char;
      } else if (/\s/.test(char)) {
      } else {
        throw this.error("Error7");
      }
    }
    return Buffer.from(hex, "hex");
  }

  private parseNumberOrTag(): any {
    let numStr = "";
    while (/[0-9.\-_eE]/.test(this.peek())) {
      numStr += this.consume();
    }

    this.skipWhiteSpace();

    if (this.peek() === "(") {
      this.consume(); // (
      const content = this.parseValue();
      this.skipWhiteSpace();
      if (this.consume() !== ")") throw this.error("Error8");

      const tagNumber = parseInt(numStr, 10);
      return new cbor.Tagged(tagNumber, content);
    }

    const cleanNum = numStr.replace(/_\d+$/, "");

    const num = Number(cleanNum);
    if (isNaN(num)) throw this.error(`Error9: ${numStr}`);
    return num;
  }

  private parseKeyword(keyword: string, value: any): any {
    for (let i = 0; i < keyword.length; i++) {
      if (this.consume() !== keyword[i])
        throw this.error(`Error10 '${keyword}'`);
    }
    return value;
  }
}
