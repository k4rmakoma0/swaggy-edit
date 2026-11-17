# Changelog

## 0.1.0 — 2026-11-17

- Native Tauri desktop shell with Rust document processing and platform-specific macOS, Windows, and Linux styling.
- Read-only, editor, and split modes with a CodeMirror source editor.
- JSON / YAML / YML support, live documentation, endpoint and schema accordions, and expand/collapse-all controls.
- Bidirectional YAML ↔ JSON conversion from the main toolbar and File menu, available in every mode.
- Conversion preserves API data, updates syntax and filename suggestions, and supports undo/redo of both text and format. YAML comments and anchors are rewritten after confirmation.
- Native open/save dialogs, atomic saving, external-modification detection, and unsaved-change protection.

Local macOS builds are verified. Windows and Linux still require native execution and visual validation. OpenAPI validation covers syntax and basic structure, not complete specification conformance. Public distribution signing/notarization is not configured.
