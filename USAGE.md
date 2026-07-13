# BeginningDB Cloud Files — VS Code Extension Usage Guide

> Practical reference for installing the `beginningdb-cloudfs` extension into VS Code, connecting it to a BeginningDB server, and editing cloud files day-to-day.

The extension turns VS Code into a client for a BeginningDB filesystem. It exposes two access modes:

1. **Virtual** — files live on the server and are read/written through the `bgdbfs://` URI scheme. Good for browsing and quick edits. Terminal, Git, debugger, and many language servers do not work against virtual workspaces.
2. **Mirror (default)** — the cloud folder is materialized to a local directory and opened as a normal `file://` workspace. Background sync keeps the local copy and the server in step. This is the right mode for serious development.

The extension does not talk to BeginningDB directly. It shells out to the `bgng` CLI for profile resolution, auth, and session refresh. You must have `bgng` available before the extension can connect.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install the extension](#2-install-the-extension)
3. [Install and verify `bgng`](#3-install-and-verify-bgng)
4. [Add a server](#4-add-a-server)
5. [Open a cloud folder](#5-open-a-cloud-folder)
6. [Daily commands](#6-daily-commands)
7. [Settings reference](#7-settings-reference)
8. [Status bar and sync log](#8-status-bar-and-sync-log)
9. [Workspace Trust and Restricted Mode](#9-workspace-trust-and-restricted-mode)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

- **VS Code** ≥ 1.100 (check `Code → About`).
- **Node.js** ≥ 22 on PATH (required by `bgng`; check `node --version`).
- The `bgng` CLI installed and reachable — see section 3.
- Connection details for the BeginningDB server you want to attach to:
  - Base URL (e.g. `http://127.0.0.1:8080` or your team's hub URL)
  - Tenant ID (integer)
  - Filesystem ID (string, e.g. `ide`)
  - Optional API token (required for non-local servers)

---

## 2. Install the extension

You should have received `beginningdb-cloudfs-0.1.0.vsix` alongside this guide.

### From the command line

```bash
code --install-extension /path/to/beginningdb-cloudfs-0.1.0.vsix
```

### From the VS Code UI

1. Open the Extensions view (`Ctrl/Cmd + Shift + X`).
2. Click the `…` menu in the Extensions panel header → **Install from VSIX…**.
3. Pick `beginningdb-cloudfs-0.1.0.vsix`.

Reload the window if VS Code prompts you. Confirm by opening the Command Palette (`Ctrl/Cmd + Shift + P`) and typing `BeginningDB:` — you should see seven commands listed (`Add Server`, `Sign In`, `Sign Out`, `Open Cloud Folder`, `Open Cloud Folder as Local Mirror`, `Sync Now`, `Show Sync Log`).

---

## 3. Install and verify `bgng`

The extension delegates auth and profile resolution to the `bgng` CLI. You need it on PATH or pointed to explicitly.

### Install from source

```bash
git clone <repo-url> beginning-db
cd beginning-db/apps/cli
npm install
npm run build
npm link
```

After `npm link`, two binaries are available:

- `bgng` — primary name
- `bgng-db` — alias

### Verify

```bash
bgng --version
bgng ide doctor --json
```

`ide doctor` is the canonical health check — it surfaces config issues the extension will hit. Run it any time the extension misbehaves.

### Point the extension at a non-PATH `bgng`

If `bgng` is not on PATH for the VS Code process, set the explicit path in Settings:

- Open Settings (`Ctrl/Cmd + ,`), search `beginningdb.bgngPath`, and enter the absolute path to the `bgng` executable.

Environment overrides (read by the extension if set in the shell that launched VS Code):

- `BEGINNINGDB_BGNG_PATH`
- `BGNG_IDE_CLI_PATH`

---

## 4. Add a server

A "server" is a saved profile pointing the extension at one BeginningDB filesystem. Profiles live in the `bgng` CLI's config, so the same profile is reusable from terminal and IDE.

1. Command Palette → **BeginningDB: Add Server** (or **Sign In** — same flow).
2. Enter prompts in order:
   - **Server name** — human-readable label (`local-dev`, `acme-staging`, etc.). A slug derived from this is the profile ID.
   - **Base URL** — defaults to `http://127.0.0.1:8080`.
   - **Tenant ID** — integer, defaults to `1`.
   - **Filesystem ID** — string, defaults to `ide`.
   - **API token** — leave blank for unauthenticated local servers; required otherwise. Stored via `bgng` (not in VS Code Secret Storage).

On success you'll see `BeginningDB server saved: <label>` and the profile shows up in `bgng ide profiles list --json`.

To remove a server: **BeginningDB: Sign Out** → pick the server.

---

## 5. Open a cloud folder

Once at least one server is registered, you can mount its filesystem.

### Mirror mode (default, recommended)

Command Palette → **BeginningDB: Open Cloud Folder as Local Mirror**.

1. Pick the server.
2. Pick a local folder to materialize into. **The contents are overwritten on first sync** — use an empty folder.
3. The extension downloads the remote tree (progress notification appears), then reopens VS Code on the local folder as a normal `file://` workspace.
4. Background sync runs every 15 seconds by default (configurable). Local edits push up; remote changes pull down.

Requires Workspace Trust (see section 9).

### Virtual mode

Command Palette → **BeginningDB: Open Cloud Folder**.

1. Pick the server.
2. VS Code opens a new workspace at `bgdbfs://<server-id>/`. Files are read on demand from the server.
3. Edits write back through the filesystem provider on save.

Caveats:

- File size is capped (`beginningdb.virtual.maxFileSizeMB`, default 50 MB).
- Terminal, integrated Git, run/debug, and many language servers will not work against `bgdbfs://`. Use mirror mode when you need those.

### Default mode

`beginningdb.defaultOpenMode` controls which mode is used when a command does not specify one. Default is `mirror`.

---

## 6. Daily commands

All accessible from the Command Palette by typing `BeginningDB:`.

| Command | When to use |
|---|---|
| **Add Server** / **Sign In** | First-time setup or adding another server |
| **Sign Out** | Remove a saved server |
| **Open Cloud Folder** | Mount a server as virtual `bgdbfs://` workspace |
| **Open Cloud Folder as Local Mirror** | Materialize and open as a normal local workspace |
| **Sync Now** | Force an immediate bidirectional sync (mirror mode) |
| **Show Sync Log** | Open the `BeginningDB Sync` output channel |

---

## 7. Settings reference

Search `beginningdb` in Settings (`Ctrl/Cmd + ,`).

| Setting | Default | Purpose |
|---|---|---|
| `beginningdb.defaultOpenMode` | `mirror` | `mirror` or `virtual` |
| `beginningdb.bgngPath` | `""` | Absolute path to `bgng`; empty means resolve from PATH / env overrides |
| `beginningdb.virtual.maxFileSizeMB` | `50` | Cap on virtual-mode file reads/writes |
| `beginningdb.sync.pollIntervalSeconds` | `15` | How often mirror mode polls the server for changes |

---

## 8. Status bar and sync log

- **Status bar item** (bottom-left, label `BeginningDB`) shows current sync state — idle, syncing, synced, paused, or error. Click it to open the sync log.
- **Sync log** is an Output channel named `BeginningDB Sync`. Open it via **BeginningDB: Show Sync Log** or `View → Output → BeginningDB Sync`.

The log is your primary debugging surface — every profile resolution, auth refresh, sync cycle, and error is written here.

---

## 9. Workspace Trust and Restricted Mode

- **Virtual mode** is allowed in Restricted Mode. You can browse and edit, but command execution is disabled.
- **Mirror mode** requires Workspace Trust. If a workspace is untrusted, the **Open Cloud Folder as Local Mirror** command will warn and exit without materializing.

Grant trust via the banner that appears at the top of an untrusted workspace, or `File → Trust Workspace`.

---

## 10. Troubleshooting

### "BeginningDB server saved" but **Open Cloud Folder** picker is empty

The extension and `bgng` use the same profile store, so the picker should reflect what `bgng ide profiles list --json` returns. If it does not:

1. Confirm `bgng` is the same binary the extension is using — check `beginningdb.bgngPath` setting and the `BEGINNINGDB_BGNG_PATH` / `BGNG_IDE_CLI_PATH` env vars in the shell that launched VS Code.
2. Reload the VS Code window (`Developer: Reload Window`).

### `bgng` cannot be found

Symptom: errors in the sync log mentioning `bgng` not found or `ENOENT`.

Fixes, in order:

1. `which bgng` — does the shell that launched VS Code have it?
2. If launching VS Code from a GUI on macOS/Linux, PATH may not include npm's global bin. Set `beginningdb.bgngPath` to the absolute path.
3. Run `bgng ide doctor --json` from a terminal and resolve anything it flags.

### Mirror sync is stuck or paused

1. Open the sync log — most failures are explicit (auth expired, network error, server 5xx).
2. Run **BeginningDB: Sync Now** to retry.
3. For auth failures, the extension will trigger a `bgng ide auth refresh <id>`. If that keeps failing, refresh manually: `bgng ide auth refresh <profile-id> --json`.
4. Check the status bar for the current state — if it says "paused", trust the workspace if needed and re-trigger sync.

### Files larger than 50 MB do not open in virtual mode

Raise `beginningdb.virtual.maxFileSizeMB`, or switch to mirror mode (no per-file cap).

### Reset everything

```bash
bgng ide profiles list --json     # see what's registered
bgng ide profiles remove <id>     # remove individually
```

Then re-add servers via **BeginningDB: Add Server**.

---

## Reporting issues

When filing a bug, include:

- `bgng --version`
- Output of `bgng ide doctor --json`
- Relevant lines from the `BeginningDB Sync` output channel
- VS Code version (`Code → About`)
- OS and architecture
