import { describe, expect, it } from 'vitest';
import { bytesFromBase64, bytesToBase64 } from '../../src/shared/base64';

describe('base64 helpers', () => {
  it('round-trips binary data without relying on Node Buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

    expect(bytesToBase64(bytes)).toBe('AAEC/f7/');
    expect(bytesFromBase64('AAEC/f7/')).toEqual(bytes);
  });

  it('handles padded strings', () => {
    expect(bytesFromBase64('aGk=')).toEqual(new TextEncoder().encode('hi'));
    expect(bytesToBase64(new TextEncoder().encode('hi'))).toBe('aGk=');
  });
});
