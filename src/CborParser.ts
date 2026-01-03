import * as apgLib from "apg-lib";
import * as cbor from "cbor";

// @ts-ignore
const Grammar = require("./grammar");
const grammar = new Grammar();
const SEM_PRE = 200;
const SEM_POST = 201;
const SEM_OK = 0;
interface ParseResult {
  success: boolean;
  value?: any;
  error?: string;
  maxMatched?: number;
}

export function parseCborEdn(input: string): ParseResult {
  const parser = new apgLib.parser();
  parser.ast = new apgLib.ast();

  const stack: any[] = [];

  const push = (v: any) => stack.push(v);
  const pop = () => stack.pop();

  const callbacks: { [key: string]: any } = {};

  callbacks["tstr"] = (
    state: number,
    chars: number[],
    phraseIndex: number,
    phraseLength: number,
  ) => {
    if (state === SEM_POST) {
      const s = apgLib.utils.charsToString(chars, phraseIndex, phraseLength);
      try {
        push(JSON.parse(s));
      } catch (e) {
        push(s.slice(1, -1));
      }
    }
    return SEM_OK;
  };

  callbacks["sqstr"] = (
    state: number,
    chars: number[],
    phraseIndex: number,
    phraseLength: number,
  ) => {
    if (state === SEM_POST) {
      const s = apgLib.utils.charsToString(chars, phraseIndex, phraseLength);
      push(s.slice(1, -1));
    }
    return SEM_OK;
  };

  callbacks["number"] = (
    state: number,
    chars: number[],
    phraseIndex: number,
    phraseLength: number,
  ) => {
    if (state === SEM_POST) {
      const s = apgLib.utils.charsToString(chars, phraseIndex, phraseLength);
      const clean = s.replace(/_/g, "");
      if (clean.includes(".") || clean.toLowerCase().includes("p")) {
        push(parseFloat(clean));
      } else {
        const n = Number(clean);
        push(Number.isSafeInteger(n) ? n : BigInt(clean));
      }
    }
    return SEM_OK;
  };

  callbacks["uint"] = (
    state: number,
    chars: number[],
    phraseIndex: number,
    phraseLength: number,
  ) => {
    if (state === SEM_POST) {
      const s = apgLib.utils.charsToString(chars, phraseIndex, phraseLength);
      push(parseInt(s, 10));
    }
    return SEM_OK;
  };

  callbacks["simple"] = (
    state: number,
    chars: number[],
    phraseIndex: number,
    phraseLength: number,
  ) => {
    if (state === SEM_POST) {
      const val = apgLib.utils.charsToString(chars, phraseIndex, phraseLength);
      if (val === "true") push(true);
      else if (val === "false") push(false);
      else if (val === "null") push(null);
      else if (val === "undefined") push(undefined);
    }
    return SEM_OK;
  };

  callbacks["app-prefix"] = (
    state: number,
    chars: number[],
    phraseIndex: number,
    phraseLength: number,
  ) => {
    if (state === SEM_POST) {
      const prefix = apgLib.utils.charsToString(
        chars,
        phraseIndex,
        phraseLength,
      );
      push(prefix);
    }
    return SEM_OK;
  };

  callbacks["app-string"] = (state: number) => {
    if (state === SEM_PRE) {
      push("__MARKER_APPSTR__");
    } else if (state === SEM_POST) {
      const content = pop();
      const prefix = pop();
      const marker = pop();
      if (marker !== "__MARKER_APPSTR__") {
        push(content);
      } else {
        if (prefix === "h") push(Buffer.from(content, "hex"));
        else if (prefix === "b64") push(Buffer.from(content, "base64"));
        else push(content);
      }
    }
    return SEM_OK;
  };

  callbacks["array"] = (state: number) => {
    if (state === SEM_PRE) {
      push("__MARKER_ARRAY__");
    } else if (state === SEM_POST) {
      const items = [];
      while (stack.length > 0) {
        const item = pop();
        if (item === "__MARKER_ARRAY__") break;
        items.unshift(item);
      }
      push(items);
    }
    return SEM_OK;
  };

  callbacks["map"] = (state: number) => {
    if (state === SEM_PRE) {
      push("__MARKER_MAP__");
    } else if (state === SEM_POST) {
      const items = [];
      while (stack.length > 0) {
        const item = pop();
        if (item === "__MARKER_MAP__") break;
        items.unshift(item);
      }
      const map = new Map();
      for (let i = 0; i < items.length; i += 2) {
        map.set(items[i], items[i + 1]);
      }
      push(map);
    }
    return SEM_OK;
  };

  callbacks["tagged"] = (state: number) => {
    if (state === SEM_PRE) {
      push("__MARKER_TAG__");
    } else if (state === SEM_POST) {
      const content = pop();
      const tagNr = pop();
      const marker = pop();
      if (marker === "__MARKER_TAG__") push(new cbor.Tagged(tagNr, content));
      else push(content);
    }
    return SEM_OK;
  };

  if (grammar.rules) {
    grammar.rules.forEach((rule: any) => {
      const name = rule.name;
      const lower = rule.lower;

      const cb = callbacks[name] || callbacks[lower];
      if (cb) {
        parser.ast.callbacks[name] = cb;
        if (lower && lower !== name) parser.ast.callbacks[lower] = cb;
      }
    });
  }

  const inputChars = apgLib.utils.stringToChars(input);
  const result = parser.parse(grammar, 0, inputChars);

  if (result.success && result.length === inputChars.length) {
    parser.ast.translate({});
    const finalValue = stack[0];

    return { success: true, value: finalValue };
  } else {
    const msg = `Parser Error at index ${result.maxMatched}`;
    return { success: false, error: msg, maxMatched: result.maxMatched };
  }
}
