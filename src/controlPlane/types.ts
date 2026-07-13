import type { VfsBackendProfile } from '../backend/backendProfile';

export interface BgngDoctorResult {
  runtimeMetadata?: {
    cliContractVersion?: number;
    selectedTarget?: string;
    selectedProfileId?: string;
  };
  profileCount?: number;
  profiles?: unknown[];
}

export interface BearerResolvedAuth {
  kind: 'bearer';
  token: string;
}

export interface DelegatedVfsResolvedAuth {
  kind: 'delegated-vfs';
  token: string;
  expiresAt?: string;
  canRefresh?: boolean;
  strategy?: 'manual-token' | 'managed-session' | 'dispatch-session';
}

export type ControlPlaneResolvedAuth = BearerResolvedAuth | DelegatedVfsResolvedAuth;

export type ControlPlaneResolvedProfile = VfsBackendProfile & {
  auth: ControlPlaneResolvedAuth;
};

export interface ControlPlaneProfileListResult {
  profiles: VfsBackendProfile[];
}

export interface ControlPlaneErrorDetails {
  kind:
    | 'control-plane-unavailable'
    | 'control-plane-incompatible'
    | 'profile-resolution-failed'
    | 'auth-refresh-failed'
    | 'malformed-response';
  message: string;
  command?: string[];
  output?: string;
}

export class ControlPlaneError extends Error {
  constructor(readonly details: ControlPlaneErrorDetails) {
    super(details.message);
    this.name = 'ControlPlaneError';
  }
}
