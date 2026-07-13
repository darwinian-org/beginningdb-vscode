# BeginningDB Cloud Files

BeginningDB Cloud Files is the Apache-2.0 Visual Studio Code extension for
browsing, editing, mirroring, and transferring files stored in BeginningDB.

The extension is normally installed by the `@beginningdb/cli` package:

```bash
npm install --global @beginningdb/cli
bgng ide install
```

The CLI downloads a version-pinned VSIX release and verifies its SHA-256 digest
before installation. Release assets and checksum files are also available from
this repository's GitHub Releases page.

To download and verify the public `v0.1.0` release manually:

```bash
mkdir beginningdb-vscode-v0.1.0
cd beginningdb-vscode-v0.1.0
gh release download v0.1.0 --repo iminds-io/beginningdb-vscode
shasum -a 256 -c beginningdb-cloudfs-0.1.0.vsix.sha256
```

The check must report `beginningdb-cloudfs-0.1.0.vsix: OK` before installation.

## Development

Requirements:

- Node.js 22 or newer
- pnpm 11.1.1
- `zip`, `unzip`, and `shasum` for reproducible packaging and release verification

Install and verify:

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run test:unit
pnpm run build
pnpm run package:vsix
pnpm run verify:vsix -- dist/beginningdb-cloudfs-0.1.0.vsix
```

## Security

Do not place BeginningDB bearer tokens or refresh credentials in settings,
source files, issue reports, or release artifacts. Report security issues
privately to the BeginningDB maintainers instead of opening a public issue with
sensitive details.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
