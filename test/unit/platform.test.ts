import { describe, expect, it } from 'vitest';
import { resolveBgngLaunchSpec } from '../../src/controlPlane/platform';

describe('resolveBgngLaunchSpec', () => {
  it('prefers an explicit override path', () => {
    expect(resolveBgngLaunchSpec({ overridePath: '/tmp/bgng' })).toEqual({
      file: '/tmp/bgng',
      args: []
    });
  });

  it('wraps JavaScript CLI paths with the current node executable', () => {
    expect(resolveBgngLaunchSpec({ overridePath: '/tmp/bgng.js' })).toEqual({
      file: process.execPath,
      args: ['/tmp/bgng.js']
    });
  });
});

