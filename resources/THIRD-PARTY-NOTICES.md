# Third-party notices

MyMap application code and original demonstration illustrations are MIT licensed.

The bundled map data and city index have their own terms; see DATA-LICENSES.md.
The bundled Manrope and Noto Sans SC fonts are distributed under the SIL Open Font License 1.1.
sharp is Apache-2.0 and includes libvips and other libraries under the terms in its included third-party notice.
Electron includes Chromium, Node.js and SQLite; the Windows distribution includes Electron's license and Chromium third-party notices.

`licenses/` contains upstream license text for the actual distributed dependency closure; `licenses/index.json` records versions. It includes bundled renderer libraries and fonts even where they are installed as development dependencies. Build tools, test frameworks, unused platforms and their duplicate license copies are excluded; Electron's and Chromium's own notices remain in the runtime distribution.

Rebuild notices after dependency changes with `node scripts/collect-licenses.cjs`.
