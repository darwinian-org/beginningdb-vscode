import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateVfsBackendProfile, type VfsBackendProfile } from '../backend/backendProfile';
import { resolveBgngLaunchSpec } from './platform';
import { validateResolvedProfile, type ConnectProfileInput } from './credentialProvider';
import {
  ControlPlaneError,
  type BgngDoctorResult,
  type ControlPlaneProfileListResult,
  type ControlPlaneResolvedProfile
} from './types';

const execFileAsync = promisify(execFile);
const CLI_CONTRACT_VERSION = 1;

export interface BgngCliOptions {
  executablePath?: string;
  bundledPath?: string;
  env?: NodeJS.ProcessEnv;
  exec?: (file: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;
}

export class BgngCli {
  constructor(private readonly options: BgngCliOptions = {}) {}

  async listProfiles(): Promise<ControlPlaneProfileListResult> {
    const json = await this.runJson(['ide', 'profiles', 'list', '--json'], 'profile-resolution-failed');
    const profiles = Array.isArray(asRecord(json).profiles)
      ? (asRecord(json).profiles as unknown[]).map(profile => validateVfsBackendProfile(profile))
      : [];
    return { profiles };
  }

  async resolveProfile(id: string): Promise<ControlPlaneResolvedProfile> {
    return validateResolvedProfile(
      await this.runJson(['ide', 'profiles', 'resolve', id, '--json'], 'profile-resolution-failed')
    );
  }

  async refreshAuth(id: string): Promise<ControlPlaneResolvedProfile> {
    return validateResolvedProfile(
      await this.runJson(['ide', 'auth', 'refresh', id, '--json'], 'auth-refresh-failed')
    );
  }

  async doctor(): Promise<BgngDoctorResult> {
    const json = await this.runJson(['ide', 'doctor', '--json'], 'control-plane-unavailable');
    const doctor = asRecord(json);
    const contractVersion = asRecord(doctor.runtimeMetadata).cliContractVersion;
    if (typeof contractVersion === 'number' && contractVersion !== CLI_CONTRACT_VERSION) {
      throw new ControlPlaneError({
        kind: 'control-plane-incompatible',
        message: `Unsupported bgng CLI contract version: ${contractVersion}`
      });
    }
    return doctor as BgngDoctorResult;
  }

  async connectDirect(input: ConnectProfileInput): Promise<VfsBackendProfile> {
    const args = [
      'ide',
      'connect',
      '--json',
      '--mode',
      'beginningdb.direct',
      '--id',
      input.id,
      '--label',
      input.label,
      '--base-url',
      input.baseUrl,
      '--tenant-id',
      String(input.tenantId),
      '--filesystem-id',
      input.filesystemId
    ];
    const json = await this.runJson(args, 'profile-resolution-failed');
    return validateVfsBackendProfile(json);
  }

  async login(profileId: string, token: string): Promise<void> {
    await this.run(['ide', 'login', '--profile', profileId, '--token', token], 'auth-refresh-failed');
  }

  async clearAuth(profileId: string): Promise<void> {
    await this.run(['ide', 'auth', 'clear', profileId], 'auth-refresh-failed');
  }

  private async runJson(args: string[], kind: 'control-plane-unavailable' | 'profile-resolution-failed' | 'auth-refresh-failed'): Promise<unknown> {
    const result = await this.run(args, kind);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new ControlPlaneError({
        kind: 'malformed-response',
        message: 'bgng returned malformed JSON',
        command: args,
        output: result.stdout
      });
    }
  }

  private async run(
    args: string[],
    kind: 'control-plane-unavailable' | 'profile-resolution-failed' | 'auth-refresh-failed'
  ): Promise<{ stdout: string; stderr: string }> {
    const launch = resolveBgngLaunchSpec({
      ...(this.options.executablePath ? { overridePath: this.options.executablePath } : {}),
      ...(this.options.bundledPath ? { bundledPath: this.options.bundledPath } : {}),
      ...(this.options.env ? { env: this.options.env } : {})
    });
    const exec = this.options.exec ?? defaultExec;

    try {
      return await exec(launch.file, [...launch.args, ...args], { env: this.options.env ?? process.env });
    } catch (error) {
      const message =
        error instanceof Error && 'stderr' in error
          ? String((error as { stderr?: string }).stderr || error.message)
          : error instanceof Error
            ? error.message
            : String(error);
      throw new ControlPlaneError({
        kind,
        message: `bgng command failed: ${message.trim() || args.join(' ')}`,
        command: args
      });
    }
  }
}

async function defaultExec(file: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) {
  const result = await execFileAsync(file, args, {
    env: options?.env,
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
