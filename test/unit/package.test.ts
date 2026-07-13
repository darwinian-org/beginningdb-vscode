import { describe, expect, it } from 'vitest';
import manifest from '../../package.json';

describe('extension manifest', () => {
  it('declares the BeginningDB cloud commands', () => {
    const commands = manifest.contributes.commands.map(command => command.command);

    expect(commands).toContain('beginningdb.addServer');
    expect(commands).toContain('beginningdb.openCloudFolder');
    expect(commands).toContain('beginningdb.openMirror');
    expect(commands).toContain('beginningdb.uploadToCloud');
    expect(commands).toContain('beginningdb.downloadToLocal');
    expect(commands).toContain('beginningdb.copyTo');
    expect(commands).toContain('beginningdb.moveTo');
    expect(commands).toContain('beginningdb.showTransfers');
  });

  it('declares limited virtual and untrusted workspace support', () => {
    expect(manifest.capabilities.virtualWorkspaces.supported).toBe('limited');
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited');
  });

  it('declares an explicit bgng path override setting', () => {
    expect(manifest.contributes.configuration.properties['beginningdb.bgngPath']).toBeDefined();
  });

  it('declares browser runtime metadata and HTTP credential settings', () => {
    expect(manifest.browser).toBe('dist/extension.browser.js');
    expect(manifest.engines).not.toHaveProperty('node');
    expect(manifest.contributes.configuration.properties['beginningdb.credentialsEndpoint']).toBeDefined();
    expect(manifest.contributes.configuration.properties['beginningdb.credentialsSecret']).toBeDefined();
  });

  it('is consumable as a packaged built-in extension', () => {
    expect(manifest).not.toHaveProperty('private', true);
    expect(manifest.name).toBe('beginningdb-cloudfs');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.main).toBe('./dist/extension.js');
    expect(manifest.browser).toBe('dist/extension.browser.js');
    expect(manifest.files).toContain('dist/**');
  });

  it('declares transfer menus, view, and settings', () => {
    expect(manifest.activationEvents).toContain('onCommand:beginningdb.uploadToCloud');
    expect(manifest.activationEvents).toContain('onView:beginningdb.transfer');

    expect(manifest.contributes.menus['explorer/context']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'beginningdb.uploadToCloud',
          when: expect.stringContaining('resourceScheme == file')
        }),
        expect.objectContaining({
          command: 'beginningdb.downloadToLocal',
          when: expect.stringContaining('resourceScheme == bgdbfs')
        })
      ])
    );
    expect(manifest.contributes.views.explorer).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'beginningdb.transfer',
          name: 'MindSpace Files'
        })
      ])
    );
    expect(manifest.contributes.configuration.properties['beginningdb.transfer.maxFileSizeMB']).toMatchObject({
      default: 100
    });
    expect(manifest.contributes.configuration.properties['beginningdb.transfer.defaultConflictPolicy']).toMatchObject({
      default: 'ask'
    });
  });
});
