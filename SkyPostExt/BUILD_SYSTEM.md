# SkyPost Build System

This build system manages packaging SkyPost for both Chrome and Firefox with their respective manifest versions.

## Structure

- `dist/` - Source code (used as base for both builds)
- `FIREFOX/` - Firefox-specific build (synced from dist/, with MV2 manifest)
- `manifests/` - Manifest templates
  - `manifest-v3.json` - Chrome/Safari manifest (Manifest V3)
  - `manifest-v2.json` - Firefox manifest (Manifest V2)

## Building

### Build Both Versions
```bash
./build.sh all
```

Outputs:
- `dist/skypost.zip` - Chrome Web Store package (MV3)
- `FIREFOX/skypost.xpi` - Firefox Add-ons package (MV2)

### Build Chrome Only
```bash
./build.sh chrome
```

### Build Firefox Only
```bash
./build.sh firefox
```

## Single Source Principle

- **Code is shared** - All `.js`, `.html`, and asset files are identical between Chrome and Firefox
- **Manifests differ** - Only the manifest changes based on browser requirements:
  - Chrome uses MV3 (required by Chrome Web Store)
  - Firefox uses MV2 (preferred for Firefox compatibility)

## Workflow

1. Make changes to code in `dist/` folder
2. Run `./build.sh all` to package both versions
3. Submit to respective stores:
   - Chrome Web Store: `dist/skypost.zip`
   - Firefox Add-ons: `FIREFOX/skypost.xpi`

## Syncing

The build script automatically syncs all code from `dist/` to `FIREFOX/` while preserving the correct manifest for each platform.

If you need to manually sync without building:
```bash
rsync -av --exclude='manifest.json' --exclude='*.zip' --exclude='*.xpi' dist/ FIREFOX/
```

## Version Management

Update version in both manifest templates:
- `manifests/manifest-v3.json` - version field
- `manifests/manifest-v2.json` - version field

Both builds will use the versions specified in their respective manifest files.
