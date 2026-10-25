# Third-party notices

MyMap application code and original demonstration illustrations are MIT licensed.

The bundled map data and city index have their own terms; see DATA-LICENSES.md.
The local Noto Serif SC font is distributed under the SIL Open Font License 1.1.
sharp is Apache-2.0 and includes libvips and other libraries under the terms in its included third-party notice.
Electron includes Chromium, Node.js and SQLite; the Windows distribution includes Electron's license and Chromium third-party notices.

`licenses/` contains the upstream license text collected from the exact installed dependency tree; `licenses/index.json` records versions. This collection also includes development dependencies for completeness. Only application runtime code, bundled renderer assets and required production dependencies are distributed by the application packager.

Rebuild notices after dependency changes with `node scripts/collect-licenses.cjs`.
