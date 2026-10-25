"""Rebuild distributable offline data using only Python 3's standard library.

Run from the project root: python scripts/prepare-data.py
Downloads happen here at development time, never in the application.
Sources / attribution: resources/DATA-LICENSES.md.
"""
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'resources'
ASSETS = ROOT / 'src/renderer/assets'
RES.mkdir(exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

SOURCES = {
    'land': 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
    'cities': 'https://download.geonames.org/export/dump/cities15000.zip',
    'regions': 'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
}

# Small editorial Chinese/pinyin additions for common destinations. Geographic
# coordinates and stable ids always come from GeoNames, not these aliases.
ALIASES = {
    '1816670': ('北京', 'beijing 北京市'), '1796236': ('上海', 'shanghai 上海市'),
    '1808926': ('杭州', 'hangzhou 杭州市'), '1815286': ('成都', 'chengdu 成都市'),
    '1814906': ('重庆', 'chongqing 重庆市'), '1809858': ('广州', 'guangzhou 广州市'),
    '1795565': ('深圳', 'shenzhen 深圳市'), '1804651': ('昆明', 'kunming 昆明市'),
    '1814093': ('大理', 'dali 大理市'), '1813253': ('丽江', 'lijiang 丽江市'),
    '1790630': ('西安', 'xian 西安市'), '1784658': ('郑州', 'zhengzhou 郑州市'),
    '1280737': ('拉萨', 'lasa lhasa 拉萨市'), '1792947': ('天津', 'tianjin 天津市'),
    '1791247': ('武汉', 'wuhan 武汉市'), '1799962': ('南京', 'nanjing 南京市'),
    '1857910': ('京都', 'kyoto 京都市'), '1850147': ('东京', 'tokyo 東京'),
    '2988507': ('巴黎', 'paris'), '2643743': ('伦敦', 'london'),
    '5128581': ('纽约', 'new york niuyue'), '2147714': ('悉尼', 'sydney'),
    '1880252': ('新加坡', 'singapore xinjiapo'), '1819729': ('香港', 'hong kong xianggang'),
    '1668341': ('台北', 'taipei taibei 臺北'), '1886760': ('苏州', 'suzhou 苏州市'),
    '1797929': ('青岛', 'qingdao 青岛市'), '1790645': ('厦门', 'xiamen 厦门市'),
}

# Guard editorial aliases against id/name mixups. These original spellings were
# checked directly in the downloaded GeoNames records, not inferred from ids.
EXPECTED_ORIGINAL = {
    '北京': 'Beijing', '上海': 'Shanghai', '杭州': 'Hangzhou', '成都': 'Chengdu',
    '重庆': 'Chongqing', '广州': 'Guangzhou', '深圳': 'Shenzhen', '昆明': 'Kunming',
    '大理': 'Dali', '丽江': 'Lijiang', '西安': "Xi'an", '郑州': 'Zhengzhou',
    '拉萨': 'Lhasa', '天津': 'Tianjin', '武汉': 'Wuhan', '南京': 'Nanjing',
    '京都': 'Kyoto', '东京': 'Tokyo', '巴黎': 'Paris', '伦敦': 'London',
    '纽约': 'New York City', '悉尼': 'Sydney', '新加坡': 'Singapore',
    '香港': 'Hong Kong', '台北': 'Taipei', '苏州': 'Suzhou', '青岛': 'Qingdao', '厦门': 'Xiamen',
}

downloads = {}
def fetch(name):
    url = SOURCES[name]
    print('Downloading', url, flush=True)
    raw = urllib.request.urlopen(url, timeout=180).read()
    downloads[name] = {'url': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    return raw

def round_coords(value):
    if isinstance(value, list) and value and isinstance(value[0], (float, int)):
        return [round(number, 4) for number in value]
    return [round_coords(item) for item in value]

land = json.loads(fetch('land'))
for feature in land['features']:
    feature['properties'] = {}
    feature['geometry']['coordinates'] = round_coords(feature['geometry']['coordinates'])
(ASSETS / 'world-land.json').write_text(json.dumps(land, separators=(',', ':')), encoding='utf-8')

regions = {}
for line in fetch('regions').decode('utf-8').splitlines():
    fields = line.split('\t')
    if len(fields) >= 2:
        regions[fields[0]] = fields[1]

cities_zip = zipfile.ZipFile(io.BytesIO(fetch('cities')))
records = cities_zip.read('cities15000.txt').decode('utf-8').splitlines()
cities = []
for record in records:
    f = record.split('\t')
    ident, original, ascii_name, alternate = f[:4]
    names = alternate.split(',')
    chinese = [name for name in names if re.search(r'[\u4e00-\u9fff]', name) and not re.search(r'[\u3040-\u30ff\uac00-\ud7af]', name)]
    custom = ALIASES.get(ident)
    if custom:
        assert EXPECTED_ORIGINAL[custom[0]] in (original, ascii_name), (
            'Editorial alias id/name mismatch', ident, custom[0], original, ascii_name)
    display = custom[0] if custom else next((name for name in chinese if len(name) <= 12), original)
    # Retain source aliases to support global search and transliterations.
    aliases = list(dict.fromkeys([original, ascii_name] + ([custom[1]] if custom else []) + chinese + names))
    cities.append({'id': 'geonames:' + ident, 'name': display, 'country': f[8],
                   'region': regions.get(f[8] + '.' + f[10], f[10]),
                   'lat': float(f[4]), 'lon': float(f[5]),
                   'aliases': ','.join(aliases), 'population': int(f[14] or 0)})
cities.sort(key=lambda city: (-city['population'], city['id']))
(RES / 'cities.json').write_text(json.dumps(cities, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
(RES / 'data-manifest.json').write_text(json.dumps({'retrieved': datetime.date.today().isoformat(), 'cityCount': len(cities), 'sources': downloads}, indent=2), encoding='utf-8')
print('Prepared', len(cities), 'cities and', len(land['features']), 'land features', flush=True)
