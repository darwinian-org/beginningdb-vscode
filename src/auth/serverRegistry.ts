import type { BeginningDbWorkspace } from '../beginningdb/workspace';
import {
  directProfilePathPrefix,
  type DirectBeginningDbProfile,
  validateVfsBackendProfile
} from '../backend/backendProfile';

const SERVERS_KEY = 'beginningdb.servers';

export interface ServerRegistryContext {
  globalState: {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void> | Promise<void>;
  };
  secrets: {
    get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
    store(key: string, value: string): Thenable<void> | Promise<void>;
    delete(key: string): Thenable<void> | Promise<void>;
  };
}

export interface SaveServerInput {
  id: string;
  label: string;
  baseUrl: string;
  tenantId: number;
  filesystemId: string;
  token: string;
}

export type StoredBeginningDbWorkspace = BeginningDbWorkspace & DirectBeginningDbProfile;

export class ServerRegistry {
  constructor(private readonly context: ServerRegistryContext) {}

  async saveServer(input: SaveServerInput): Promise<void> {
    const workspace = validateVfsBackendProfile({
      id: input.id,
      label: input.label,
      mode: 'beginningdb.direct',
      baseUrl: input.baseUrl,
      tenantId: input.tenantId,
      filesystemId: input.filesystemId,
      pathPrefix: directProfilePathPrefix(input.filesystemId)
    }) as StoredBeginningDbWorkspace;
    const servers = (await this.listServers()).filter(server => server.id !== input.id);
    servers.push(workspace);
    servers.sort((a, b) => a.label.localeCompare(b.label));

    await this.context.globalState.update(SERVERS_KEY, servers);
    await this.context.secrets.store(secretKey(input.id), input.token);
  }

  async listServers(): Promise<StoredBeginningDbWorkspace[]> {
    return this.context.globalState.get<StoredBeginningDbWorkspace[]>(SERVERS_KEY, []);
  }

  async getToken(serverId: string): Promise<string | undefined> {
    return this.context.secrets.get(secretKey(serverId));
  }

  async signOut(serverId: string): Promise<void> {
    await this.context.secrets.delete(secretKey(serverId));
  }

  async removeServer(serverId: string): Promise<void> {
    const next = (await this.listServers()).filter(server => server.id !== serverId);
    await this.context.globalState.update(SERVERS_KEY, next);
    await this.context.secrets.delete(secretKey(serverId));
  }

  async clearServers(): Promise<void> {
    const servers = await this.listServers();
    await this.context.globalState.update(SERVERS_KEY, []);
    await Promise.all(servers.map(server => this.context.secrets.delete(secretKey(server.id))));
  }

  async redactedDiagnostics(): Promise<string> {
    const servers = await this.listServers();
    return servers
      .map(server =>
        [
          `id=${server.id}`,
          `label=${server.label}`,
          `baseUrl=${server.baseUrl}`,
          `tenantId=${server.tenantId}`,
          `filesystemId=${server.filesystemId}`,
          'token=***'
        ].join(' ')
      )
      .join('\n');
  }
}

export function secretKey(serverId: string): string {
  return `beginningdb.server.${serverId}.token`;
}
