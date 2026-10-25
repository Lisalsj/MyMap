# MyMap architecture

MyMap is an offline Windows Electron application. React renders a local custom-protocol document; a sandboxed preload exposes typed, per-operation calls. The main process owns native dialogs, a single application window, trusted request origins and media protocols. A utility process owns SQLite and image processing.

## Data and assets

- Trip groups Visit, Entry and PhotoAttachment records. Place is reusable; editing a Visit can select or create another Place without changing other visits.
- Photo stores a content hash, metadata and library-relative paths. A Photo can be reused across trips without copying its original bytes again.
- Markdown is parsed as GFM for reference validation, photo retention and export; entity-encoded and reference-style image URLs use the same interpretation as the renderer.
- Dates of visits and trips are local date-only strings. EXIF camera-local date/time remains local, with an original timezone offset if present.
- Map polygons, city index, font, icons and demonstration illustrations are bundled. The runtime has no map provider, geocoding API, telemetry or update service.

## Reliability

Managed paths reject traversal and symlinks. Imports validate format and pixel limits, copy through temporary files, retain originals, generate oriented previews and deduplicate bytes. SQLite transactions protect relationships; the library lock prevents competing writers.

Soft deletion preserves records until explicit trash clearing. Remaining Markdown, cover and attachment references protect original photos. Complete backups contain a consistent SQLite snapshot and original files with hashes; restore validates into a new library before switching.

The journal save queue serializes edits and drains newer drafts received during a save. Navigation and exit flush pending text. A renderer-ready handshake prevents startup/close races; shutdown freezes input and waits for import, backup and restore work. Expected navigation interruption during requested shutdown is not reported as a startup failure.

## Distribution

electron-builder creates NSIS and self-extracting portable executables. Data remains outside program installation directories. The portable executable is convenient to distribute but extracts the runtime before starting; the installed version starts faster.

The Git repository contains source and redistributable assets. Personal libraries, build outputs, executable artifacts, credentials and internal work files are ignored. Executables and their SHA-256 sums are GitHub Release attachments.
