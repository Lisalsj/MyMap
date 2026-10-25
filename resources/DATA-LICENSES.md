# MyMap offline data and original artwork

Retrieved / generated: **2026-10-25**. These files are bundled with MyMap; the
application does not download map tiles, geographic data, or image assets.

## Land and coastline outline

`src/renderer/assets/world-land.json` is derived from **Natural Earth 1:50m land**,
including major islands, in the official Natural Earth repository:

- [Dataset description](https://www.naturalearthdata.com/downloads/50m-physical-vectors/50m-land/)
- [Official source GeoJSON](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson)
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/)

Natural Earth data is **public domain**. MyMap removes unused properties and
rounds coordinates to four decimal places. The coastline is the outline of the
land polygons. This is a generalized geographic background, not an administrative
boundary dataset or a navigation map. There are no online tiles or third-party
administrative boundary layers.

## Cities and search aliases

`cities.json.gz` is derived from **GeoNames**, licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
Attribution: **GeoNames, https://www.geonames.org/**.

- [cities15000.zip](https://download.geonames.org/export/dump/cities15000.zip)
- [admin1CodesASCII.txt](https://download.geonames.org/export/dump/admin1CodesASCII.txt)
- [GeoNames format, coordinates, and license](https://download.geonames.org/export/dump/readme.txt)
- [About GeoNames](https://www.geonames.org/about.html)

Modifications: JSON conversion; stable ids prefixed with `geonames:`; region
codes resolved with the admin1 source; Chinese-character source aliases preferred
for display where available; a small, explicitly listed editorial supplement of
common Chinese names and pinyin added in `scripts/prepare-data.py`. Other names,
population counts, aliases and WGS84 latitude/longitude are from GeoNames. The
source alternate-names field does not preserve language tags, so some display
names outside China can retain another CJK-language spelling. Source original
names and transliterations remain searchable. The data is provided as-is and
does not cover every small settlement; MyMap also supports manual places.

The bundled snapshot contains **34,188 cities**, including **2,123 CN records**.
See `data-manifest.json` for retrieval date, source URLs, source sizes and SHA-256
checksums. Upstream sources change; rerunning the script may produce a newer
snapshot. The checked-in `cities.json.gz` is the sole authoritative city snapshot
in the repository and application distribution.

The application ships the same snapshot as `cities.json.gz`, using standard
gzip at level 9 with a zero modification time and no filename in the header.
Its UTF-8 JSON payload has `format: "mymap-cities"`, `version: 1`, a `columns`
array in the fixed order `id`, `name`, `country`, `region`, `lat`, `lon`,
`aliases`, `population`, and a `rows` array containing each city's values in
that order. This changes storage only: every city, field, alias, original
coordinate and source id is retained. The optional `cities.json` is a generated,
Git-ignored audit intermediate; it is not committed or distributed.
`data-manifest.json` records the compressed size and SHA-256, the generated
source JSON size and SHA-256, and `canonicalCitySha256`: SHA-256 of the decoded
`City[]` serialized with JavaScript `JSON.stringify` in the fixed column order.
The canonical checksum preserves a complete fidelity check without duplicating
the full snapshot in the repository.

When the generated `cities.json` audit intermediate exists, recompress it
without network access or changing that JSON by running
`python scripts/prepare-data.py --compress-existing`. This mode requires the
intermediate file. The full rebuild command still downloads the original
sources and writes both representations; only the gzip snapshot is committed.
Runtime loading
supports older resource directories with `cities.json` when the gzip file is
absent; a present but damaged or unsupported index is rejected. Manual place
entry remains available when city resources cannot be read.

## Demo landscapes and application icon

The four `demo/*.jpg` images and their editable SVG source files are **original,
fictional vector landscape illustrations created for MyMap**, not personal
photographs or reproductions of third-party art. Themes: Hangzhou lake, Yunnan
mountains, Kyoto autumn, and a lakeside morning. No claim of geographic accuracy
is made. `icon.svg`, `icon.png`, and `icon.ico` are original MyMap travel-pin and
mountain artwork. They are distributed under this project's **MIT license**.

Rebuild the artwork and the multi-resolution ICO with Node.js and the project's
`sharp` dependency: `node scripts/prepare-data.mjs`.

## Rebuilding geographic data

From the project root, run `python scripts/prepare-data.py` with Python 3.
It requires only the Python standard library and network access at build time.
No network is needed to use the resulting application. Geographic source data
uses longitude/latitude in WGS84; there is no GCJ-02 coordinate conversion.
