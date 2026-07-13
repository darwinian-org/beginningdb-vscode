const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1]! : 0;
    const third = hasThird ? bytes[index + 2]! : 0;

    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0b11) << 4) | (second >> 4)];
    output += hasSecond ? BASE64_ALPHABET[((second & 0b1111) << 2) | (third >> 6)] : '=';
    output += hasThird ? BASE64_ALPHABET[third & 0b111111] : '=';
  }
  return output;
}

export function bytesFromBase64(input: string): Uint8Array {
  const normalized = input.replace(/\s/g, '');
  if (normalized.length === 0) {
    return new Uint8Array();
  }
  if (normalized.length % 4 === 1) {
    throw new Error('Invalid base64 length');
  }

  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const padding = padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((padded.length / 4) * 3 - padding);
  let outputIndex = 0;

  for (let index = 0; index < padded.length; index += 4) {
    const first = decodeBase64Char(padded.charAt(index));
    const second = decodeBase64Char(padded.charAt(index + 1));
    const thirdChar = padded.charAt(index + 2);
    const fourthChar = padded.charAt(index + 3);
    const third = thirdChar === '=' ? 0 : decodeBase64Char(thirdChar);
    const fourth = fourthChar === '=' ? 0 : decodeBase64Char(fourthChar);

    output[outputIndex++] = (first << 2) | (second >> 4);
    if (outputIndex < output.length) {
      output[outputIndex++] = ((second & 0b1111) << 4) | (third >> 2);
    }
    if (outputIndex < output.length) {
      output[outputIndex++] = ((third & 0b11) << 6) | fourth;
    }
  }

  return output;
}

function decodeBase64Char(char: string): number {
  if (char === '-' || char === '+') {
    return 62;
  }
  if (char === '_' || char === '/') {
    return 63;
  }
  const value = BASE64_ALPHABET.indexOf(char);
  if (value < 0) {
    throw new Error(`Invalid base64 character: ${char}`);
  }
  return value;
}
