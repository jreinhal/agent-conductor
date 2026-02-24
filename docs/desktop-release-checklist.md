# Desktop Release Checklist

Date: 2026-02-22

## Goal

Ship desktop-first with zero CLI requirement for end users.

## End-User Experience

1. Download installer from release page.
2. Run installer.
3. Launch from app icon (Start menu / Applications).
4. Use app normally without terminal commands.

## Internal Release Flow (Team Only)

1. Build artifacts:
   - `npm run build`
   - `npm run dist`
2. Validate generated installers in `dist/`:
   - Windows `.exe` (NSIS)
   - macOS `.dmg` / `.zip`
   - Linux `.AppImage` / `.deb`
3. Smoke test install and first launch on each target OS.
4. Verify provider connection flows and routing/debate surfaces.
5. Publish release notes with:
   - new features
   - known limitations
   - upgrade/install guidance

## Go/No-Go Gates

- All critical UI panels open without visual bleed or clipped controls.
- `Plans & Billing` shows clear plan + billing mode + fee preview.
- Debate state is explicit (`running`, `waiting_user`, `paused`).
- Lint/tests pass for touched files.
- Installer smoke test passes on at least one machine per OS family.
