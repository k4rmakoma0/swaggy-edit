#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:-release}"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Run this script on macOS." >&2
  exit 1
fi
case "$profile" in
  release) npm run tauri -- build --bundles app ;;
  debug) npm run tauri -- build --debug --bundles app ;;
  *) echo "Usage: scripts/package-macos.sh [debug|release]" >&2; exit 1 ;;
esac
mkdir -p dist
# Replace only our generated bundle; merging bundles leaves stale code signatures.
python3 - <<'PYBUNDLE'
from pathlib import Path
import plistlib, shutil
bundle = Path('dist/Swaggy.app')
if bundle.exists():
    with (bundle / 'Contents/Info.plist').open('rb') as file:
        identifier = plistlib.load(file).get('CFBundleIdentifier')
    if identifier != 'dev.swaggy.editor':
        raise SystemExit('Refusing to replace a different application in dist/Swaggy.app')
    shutil.rmtree(bundle)
PYBUNDLE
# ditto preserves the bundle's native permissions and metadata.
ditto "target/$profile/bundle/macos/Swaggy.app" "dist/Swaggy.app"
codesign --force --deep --sign - "dist/Swaggy.app"
codesign --verify --deep --strict "dist/Swaggy.app"
echo "Created dist/Swaggy.app ($profile)."
