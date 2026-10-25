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
boundary dataset or a navigation map. There are no online tiles. A separate,
attributed administrative reference layer is described below.

## Historical city and province boundary reference

`src/renderer/assets/china-cities.topo.json` and `china-city-index.json` form a
separate **ODbL 1.0 boundary database**. MyMap program code remains MIT licensed;
the MIT license does not replace the geographic data licenses.

- Historical city / prefecture source: [geoBoundaries 3.0.0 CHN ADM2](https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM2/geoBoundaries-3_0_0-CHN-ADM2.topojson),
  representing **2017**, with [source metadata](https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM2/geoBoundaries-3_0_0-CHN-ADM2-metaData.json).
  Original providers: **OpenStreetMap, Wambacher**. Original license:
  [Open Data Commons Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  Attribution: **geoBoundaries; © OpenStreetMap contributors**,
  https://www.geoboundaries.org/ and https://www.openstreetmap.org/copyright.
- Whole municipality source: [geoBoundaries 3.0.0 CHN ADM1](https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM1/geoBoundaries-3_0_0-CHN-ADM1.topojson),
  representing **2017**, with [source metadata](https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM1/geoBoundaries-3_0_0-CHN-ADM1-metaData.json).
  Original providers: **OpenStreetMap, Wambacher**, under **ODbL 1.0**.
  The four municipality geometries are used identically in the city and province
  objects. Hong Kong uses the shared-arc union of the original **2017** Hong Kong
  Island, Kowloon and New Territories objects from the city source above, again
  in both objects. The six previously published region ids remain unchanged.
- Remaining province / Macau whole-region source:
  [geoBoundaries CHN ADM1, pinned commit 9469f09](https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/CHN/ADM1/geoBoundaries-CHN-ADM1.geojson),
  representing **2019**, 34 province-level features. Original providers:
  **geoBoundaries, Wikimedia Commons**; original source license: **Public Domain**.
  geoBoundaries attribution is retained. An upstream English province-label typo,
  "Guangzhou Province", is explicitly labeled 广东省.
- Chinese city labels and the point-to-boundary concordance use the existing
  **GeoNames CC BY 4.0** city snapshot described below. They do not replace its
  stable `geonames:` city identifiers or alter stored trips.
  Formal prefecture names and province membership are fixed in a **334-entry
  audited table keyed to the pinned source identities**. First Chinese aliases,
  historic seat names, Japanese variants and coarse province-point tests do not
  determine the formal labels. The audit corrects 37 labels and explicitly fixes
  Siping (四平市) to 吉林省. Names follow 2017: 哈密市, 那曲地区 and independent 莱芜市.
  Display labels are normalized to Simplified Chinese with OpenCC (`opencc-js`,
  `tw` → `cn`) at build time; original Traditional Chinese names remain search
  aliases, alongside their Simplified Chinese equivalents. OpenCC is a build
  dependency and is not needed by the offline application runtime.

Coverage and changes: the old layer's 340 objects include three Hong Kong
subregions, two Macau subregions and Zanda County. MyMap merges the three Hong
Kong objects using their original shared arcs, replaces the two partial Macau
objects with its 2019 whole-region outline, and adds complete 2017 Beijing,
Tianjin, Shanghai and Chongqing municipality polygons. The original
Zanda County arcs are merged into Ngari Prefecture (阿里地区), its administrative
parent, as confirmed by the [Xizang government](https://www.xizang.gov.cn/xwzx_406/qxxw/202402/t20240210_403584.html).
This restores a whole prefecture using existing source edges; it introduces no
new boundary geometry. The result is **334 prefecture regions plus 4 whole
municipalities and 2 whole SARs, or 340 city / prefecture reference regions**.
Taiwan is displayed only as a **province-level outline**; this release
does not claim Taiwan city boundary coverage. Provincial directly administered
counties or county-level cities absent from the source remain uncovered; MyMap
does not synthesize boundaries to fill them. **Laiwu remains a separate 2017
region**, rather than being silently merged into Jinan.

This is a generalized historical administrative reference, **not current
official boundary data**. 市级参考边界、四直辖市及香港采用 2017 年历史数据；澳门及
其余省域轮廓采用 2019 年概略数据。澳门精度较低，不能用于界线或导航判断。
台湾仅提供省域轮廓；莱芜保留历史独立边界。

Processing: merge the three Hong Kong objects and remove the two partial Macau
objects; assign Zanda and
Ngari's original polygon parts to one Ngari MultiPolygon feature (the city mesh
omits their shared internal arcs); add four same-year municipality geometries
and the whole Macau reference;
label and disambiguate cities with GeoNames names and point in
polygon checks; preserve shared TopoJSON arcs; simplify and quantize WGS84
longitude/latitude coordinates. All polygon exteriors use the clockwise winding
required by D3. No Voronoi cells or other synthetic city polygons are used.
Rendered province division lines are derived from the city topology's shared
arcs whose neighboring city regions have different audited province labels.
The modern GeoNames Taizhou (台州, 8400694) coastal point is outside the generalized
2017 polygon. An explicit city-name-plus-Zhejiang concordance links this stable
city id to that historical polygon; the source geometry is unchanged. The
label anchor is an interior point. The distinct Jiangsu Taizhou (泰州, 1793505)
retains its own polygon. Other matching is based on point-in-polygon checks.

The derivative boundary database stays under **ODbL 1.0**, including when bundled
with the MIT application. The full ODbL and CC BY texts and attribution notice
are in `resources/licenses/boundary-data/`. The complete conversion method is
[`scripts/prepare-boundaries.mjs`](https://github.com/Lisalsj/MyMap/blob/main/scripts/prepare-boundaries.mjs);
run `node scripts/prepare-boundaries.mjs` from the published source checkout.
The machine-readable derivative files are also in that source repository under
`src/renderer/assets/china-cities.topo.json` and `china-city-index.json`.
Only this build script downloads sources; the
application uses the resulting local assets entirely offline. The boundary
entry in `data-manifest.json` records exact input/output sizes, SHA-256 hashes,
source years, licenses, coverage and simplification settings.

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
