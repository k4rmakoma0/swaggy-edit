# Swaggy

An offline desktop workspace for editing and reading Swagger / OpenAPI specifications. Rust owns parsing, structural diagnostics, file loading, conflict detection, and atomic saving. Tauri hosts a platform-adaptive TypeScript interface and CodeMirror editor using the operating system's webview.

## Platform design

- **macOS**: native window controls and menu bar, SF system typography, a translucent sidebar, compact segmented controls, and native **Liquid Glass** on macOS 26+, with sidebar vibrancy on older releases. Supports light and dark appearance, reduced transparency, and increased contrast.
- **Windows**: a flat layout, Segoe UI, solid surfaces, square controls, blue accents, native title bar and dialogs. Windows does not use the macOS glass effect.
- **Linux**: a restrained desktop layout with Cantarell / Noto Sans, solid surfaces, and system window decorations.

The frontend is HTML/CSS/TypeScript; it is not a SwiftUI, WinUI, or GTK widget implementation. The native shell, menus, dialogs, and macOS material effect are provided by Tauri and the operating system. No Electron runtime or bundled Chromium is used.

## Features

- **Visualizar**: read-only API documentation.
- **Editar**: a full-width CodeMirror source editor.
- **Mixto**: resizable source and documentation panels side by side.
- JSON, YAML, and YML in UTF-8, up to 8 MiB.
- Swagger 2.0 and OpenAPI 3.0 / 3.1 / 3.2 browsing.
- Syntax highlighting, line numbers, folding, source search, undo/redo, and adjustable font size.
- Endpoint search by path, method, tag, summary, or operation ID.
- Expandable endpoints and data schemas directly in the API overview, including parameters, request bodies, responses, examples, and authentication definitions.
- Multiple accordions can stay open, with expanded sections preserved through live updates. Sidebar navigation expands and scrolls to the matching section.
- **Expandir todo / Contraer todo** in the documentation toolbar opens or closes all endpoints and schemas, including entries hidden by the current search. These controls remain available while scrolling; nested schema/JSON details retain their own disclosure controls.
- Local JSON Pointer `$ref` resolution and bounded expansion of recursive schemas.
- Inherited path parameters with operation-level overrides.
- Background Rust parsing with debounced live updates and stale-result protection.
- Native open/save dialogs, drag-and-drop, recent files, and CLI file arguments.
- Exact-source saving preserves comments and formatting. Explicit formatting and JSON ↔ YAML conversion warn before rewriting.
- Atomic saving and detection of external modifications before replacing the current file.
- Unsaved-change confirmation before replacing or closing a document.
- Persisted appearance, panel size, mode, editor font size, and recent paths. API contents are not persisted in preferences.

The UI is in Spanish; code and examples are in English. **Archivo → Abrir ejemplo Petstore** opens the included editable example.

## Development

Install a stable Rust toolchain and Node.js 24+ with npm. Follow the platform prerequisites in the [Tauri setup guide](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run tauri -- dev
```

`npm run dev` runs only the frontend server. Rust commands and file operations require the Tauri application. The release app needs no server, Node.js, or network connection.

### macOS

Xcode Command Line Tools are required.

```sh
bash scripts/package-macos.sh release
open dist/Swaggy.app
```

The bundle targets the current architecture and macOS 12+. Local builds are not Developer ID signed or notarized; public distribution requires those credentials. Native transparency requires Tauri's macOS private API option, so this configuration is intended for direct distribution, not Mac App Store submission.

### Windows

Install the MSVC Rust toolchain, Visual Studio C++ Build Tools, and WebView2 (included with current Windows installations).

```powershell
npm ci
npm run tauri -- build
```

The executable is `target/release/swaggy.exe`; installers are generated in `target/release/bundle`.

### Linux

On Ubuntu / Debian:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf
npm ci
npm run tauri -- build
```

The native binary is `target/release/swaggy`; packages are generated in `target/release/bundle`. File dialogs use the desktop's XDG portal; install a supported GTK/GNOME/KDE portal backend and `zenity` if dialogs are unavailable. Linux uses the system WebKitGTK runtime.

### CLI files

```sh
./target/release/swaggy examples/petstore.yaml
```

## Shortcuts

Use Command on macOS and Ctrl on Windows / Linux.

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl + O | Open |
| Cmd/Ctrl + N | New document |
| Cmd/Ctrl + S | Save |
| Cmd/Ctrl + Shift + S | Save as |
| Cmd/Ctrl + K | Search endpoints |
| Cmd/Ctrl + F | Find in the source editor |
| Cmd/Ctrl + 1 / 2 / 3 | View / Edit / Split |
| Cmd/Ctrl + Z | Undo in the source editor |

The main toolbar offers **Convertir a JSON / Convertir a YAML** in all three modes; both conversion directions are also available under **Archivo**. Conversion updates the language and suggested filename, can be undone/redone with its format intact, and warns before dropping YAML comments/anchors. The source panel's **···** menu provides formatting, format conversion, and font size. The divider supports dragging and keyboard arrow keys. Saving after format conversion opens a dialog with the matching extension.

## Validation and limitations

Swaggy has a custom documentation renderer. It does not embed Swagger UI or Swagger Editor. It checks JSON/YAML syntax and basic structural requirements: document version, info fields, paths, operation responses, duplicate operation IDs, and local references. **A clean status is not full OpenAPI conformance validation.**

External file/HTTP references are reported but never fetched. Bundle multi-file specifications before opening them. Local references support JSON Pointer fragments; JSON Schema anchors and external resource scopes are not implemented. Schema expansion is capped at eight levels, with the original JSON definition available. Less common operation fields remain available in the raw JSON. OpenAPI 3.2-specific constructs such as `additionalOperations` are preserved in source but do not have dedicated navigation.

Descriptions support sanitized Markdown. Remote images, embedded media, active HTML, and external links are disabled. Specifications cannot initiate API requests. There is no request execution, code generation, automatic API-version migration, or unsaved-document crash recovery. Formatting/conversion removes comments and expands YAML anchors. External-edit detection does not provide file locking against simultaneous writers.

Only macOS has been built and checked interactively in this workspace. Windows and Linux have platform-specific styles and a CI matrix, but require execution and visual validation on those systems. The GitHub Actions workflow has not been run here.

The installed development toolchain currently reports an upstream `picomatch` advisory through Vite/Vitest. It is used for development/build-time file matching and is not included in the shipped application. No patched `picomatch` release was available in the registry at verification time. Production dependencies pass `npm audit --omit=dev`.

## Checks

```sh
npm run build
npm test
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
npm run tauri -- build --no-bundle
```

- `src-tauri/src/document.rs`: bounded UTF-8 loading, change tracking, atomic saving.
- `src-tauri/src/spec.rs`: parsing, structural diagnostics, references, and document model.
- `src-tauri/src/main.rs`: native commands, application session, menu and close handling.
- `ui/main.ts`: UI composition and document workflow.
- `ui/editor.ts`: CodeMirror configuration.
- `ui/preview.ts`: sanitized documentation rendering.
- `ui/style.css`: platform-specific layouts, materials, appearance and accessibility.
- `examples/petstore.yaml`: local editable example, not a connected API.

References: [Tauri window effects](https://v2.tauri.app/reference/config/#windoweffect), [CodeMirror](https://codemirror.net/), [serde-saphyr](https://docs.rs/serde-saphyr/2.1.1/serde_saphyr/), and the [OpenAPI specification](https://spec.openapis.org/oas/latest.html).
