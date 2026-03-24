/**
 * Generates an interactive, HTML-formatted hex view of CBOR binary data.
 * * This function parses the raw CBOR buffer byte by byte and generates a visual representation
 * similar to `cbor.me`. It maintains a logical path (e.g., `root.m[0].k`) for each byte sequence
 * using a stack, which allows the frontend to bind the hex view to a parsed EDN text editor.
 * * @param buffer - The raw CBOR binary data to format.
 * @returns A string containing HTML `<div>` elements representing the formatted hex view.
 */
export function generateCborMeHexView(buffer: Uint8Array): string {
  const data = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  let offset = 0;
  let indent = 0;
  const lines: string[] = [];

  const stack: {
    type: "map" | "array" | "tag";
    itemsRemaining: number;
    index: number;
    isKey?: boolean;
  }[] = [];

  /**
   * Converts a Uint8Array into an uppercase hex string.
   */
  function toHex(arr: Uint8Array) {
    return Buffer.from(arr).toString("hex").toUpperCase();
  }

  /**
   * Appends a new formatted HTML line to the output array.
   * * @param hexStr - The hex representation of the parsed bytes.
   * @param comment - The meaning of the bytes.
   * @param currentIndent - The visual indentation level for this line.
   * @param path - The logical data path used for UI highlighting.
   */
  function addLine(
    hexStr: string,
    comment: string,
    currentIndent: number,
    path: string,
  ) {
    const leftPad = "  ".repeat(currentIndent);
    const leftCol = leftPad + hexStr;
    const padding = Math.max(1, 40 - leftCol.length);
    const safeComment = comment
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    lines.push(
      `<div class="hex-line" data-path="${path}">${leftCol}${" ".repeat(padding)}# ${safeComment}</div>`,
    );
  }

  while (offset < buffer.length) {
    let currentPath = "root";
    for (const frame of stack) {
      if (frame.type === "array") {
        currentPath += `[${frame.index}]`;
      } else if (frame.type === "map") {
        if (frame.isKey) {
          currentPath += `.m[${frame.index}].k`;
        } else {
          currentPath += `.m[${frame.index}].v`;
        }
      } else if (frame.type === "tag") {
        currentPath += `.tagContent`;
      }
    }

    const startOffset = offset;
    const initialByte = buffer[offset++];
    const majorType = initialByte >> 5; // first 3 bits indicate the major type
    const addInfo = initialByte & 0x1f; // last 5 bits indicate additional info or value

    let arg: number | bigint = addInfo;
    let byteCount = 0;

    // Determine the argument value and how many additional bytes to read based on the additional info
    if (addInfo === 24) {
      arg = buffer[offset];
      byteCount = 1;
    } else if (addInfo === 25) {
      arg = data.getUint16(offset);
      byteCount = 2;
    } else if (addInfo === 26) {
      arg = data.getUint32(offset);
      byteCount = 4;
    } else if (addInfo === 27) {
      arg = Number(data.getBigUint64(offset));
      byteCount = 8;
    }

    offset += byteCount;

    const headerBytes = buffer.subarray(startOffset, offset);
    const hexStr = toHex(headerBytes);
    let meaning = "";
    let itemsToRead = 0;

    switch (majorType) {
      case 0:
        meaning = `unsigned(${arg})`;
        break;
      case 1:
        meaning = `negative(${-1 - Number(arg)})`;
        break;
      case 2:
        meaning = `bytes(${arg})`;
        break;
      case 3:
        meaning = `text(${arg})`;
        break;
      case 4:
        meaning = `array(${addInfo === 31 ? "indefinite" : arg})`;
        itemsToRead = addInfo === 31 ? Infinity : Number(arg);
        break;
      case 5:
        meaning = `map(${addInfo === 31 ? "indefinite" : arg})`;
        itemsToRead = addInfo === 31 ? Infinity : Number(arg) * 2;
        break;
      case 6:
        meaning = `tag(${arg})`;
        itemsToRead = 1;
        break;
      case 7:
        if (addInfo === 20) meaning = "primitive(false)";
        else if (addInfo === 21) meaning = "primitive(true)";
        else if (addInfo === 22) meaning = "primitive(null)";
        else if (addInfo === 23) meaning = "primitive(undefined)";
        else if (addInfo === 25) meaning = "float16";
        else if (addInfo === 26)
          meaning = `primitive(${data.getFloat32(startOffset + 1)})`;
        else if (addInfo === 27)
          meaning = `primitive(${data.getFloat64(startOffset + 1)})`;
        else if (addInfo === 31) meaning = "break";
        else meaning = `simple(${arg})`;
        break;
    }

    addLine(hexStr, meaning, indent, currentPath);

    // For byte/string types, also display the payload in hex and its meaning
    if ((majorType === 2 || majorType === 3) && addInfo !== 31) {
      const payloadLen = Number(arg);
      const payloadBytes = buffer.subarray(offset, offset + payloadLen);
      offset += payloadLen;

      const payloadHex = toHex(payloadBytes);
      let payloadMeaning = "";
      if (majorType === 3) {
        payloadMeaning = `"${new TextDecoder().decode(payloadBytes).replace(/\n/g, "\\n")}"`;
      } else {
        payloadMeaning = `h'${payloadHex}'`;
      }
      addLine(payloadHex, payloadMeaning, indent + 1, currentPath);
    }

    let pushedFrame = false;
    const isBreak = majorType === 7 && addInfo === 31;

    if (stack.length > 0 && !isBreak) {
      const parent = stack[stack.length - 1];
      if (parent.itemsRemaining !== Infinity) parent.itemsRemaining--;
    }

    if (isBreak) {
      stack.pop();
      indent = Math.max(0, indent - 1);
    } else if (majorType === 4 && itemsToRead > 0) {
      stack.push({ type: "array", itemsRemaining: itemsToRead, index: 0 });
      pushedFrame = true;
      indent++;
    } else if (majorType === 5 && itemsToRead > 0) {
      stack.push({
        type: "map",
        itemsRemaining: itemsToRead,
        index: 0,
        isKey: true,
      });
      pushedFrame = true;
      indent++;
    } else if (majorType === 6) {
      stack.push({ type: "tag", itemsRemaining: 1, index: 0 });
      pushedFrame = true;
      indent++;
    }

    let poppedFrames = 0;
    while (stack.length > 0 && stack[stack.length - 1].itemsRemaining <= 0) {
      stack.pop();
      indent = Math.max(0, indent - 1);
      poppedFrames++;
    }

    if (stack.length > 0) {
      if (poppedFrames > 0 || (!pushedFrame && !isBreak)) {
        const parent = stack[stack.length - 1];
        if (parent.type === "map") {
          if (!parent.isKey) parent.index++;
          parent.isKey = !parent.isKey;
        } else if (parent.type === "array") {
          parent.index++;
        }
      }
    }
  }
  return lines.join("");
}
