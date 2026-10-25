// Rebuild the separate ODbL boundary database; application code remains MIT.
// Run: node scripts/prepare-boundaries.mjs (downloads occur only at build time).
// No raw geographic files are written. Sources, hashes and limitations are recorded
// in resources/data-manifest.json and resources/DATA-LICENSES.md.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { feature, merge, quantize } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, sphericalTriangleArea } from 'topojson-simplify'
import { geoArea, geoContains } from 'd3-geo'
import { Converter } from 'opencc-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS = path.join(ROOT, 'src/renderer/assets')
const RESOURCES = path.join(ROOT, 'resources')
const SOURCES = {
  prefectures: {
    url: 'https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM2/geoBoundaries-3_0_0-CHN-ADM2.topojson',
    bytes: 6385396,
    sha256: '66b46dbef906ff57e212ebc57872a877c7d2e03a0e84aa4fbb96ae68b8a573c7',
    year: '2017',
    license: 'ODbL-1.0',
    attribution: 'geoBoundaries; © OpenStreetMap contributors; Wambacher',
    metadata: 'https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM2/geoBoundaries-3_0_0-CHN-ADM2-metaData.json'
  },
  municipalities2017: {
    url: 'https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM1/geoBoundaries-3_0_0-CHN-ADM1.topojson',
    bytes: 4582705,
    sha256: '67cb081f05568c52b550a2615ff5d780fedc7ef1121b2910c63118563a135bfb',
    year: '2017', license: 'ODbL-1.0',
    attribution: 'geoBoundaries; © OpenStreetMap contributors; Wambacher',
    metadata: 'https://www.geoboundaries.org/data/geoBoundaries-3_0_0/CHN/ADM1/geoBoundaries-3_0_0-CHN-ADM1-metaData.json'
  },
  provinces: {
    url: 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/CHN/ADM1/geoBoundaries-CHN-ADM1.geojson',
    bytes: 270578,
    sha256: '3a00467a0db9b4136facb5f2f3d0edbfd96adb15651cfdf63991da9281030e85',
    year: '2019',
    license: 'Public Domain (source); geoBoundaries attribution retained',
    attribution: 'geoBoundaries; Wikimedia Commons',
    metadata: 'https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM1/'
  }
}
const PROVINCE_NAMES = {
  'Hainan Province': '海南省', 'Taiwan Province': '台湾省',
  'Guangxi Zhuang Autonomous Region': '广西壮族自治区', 'Fujian Province': '福建省',
  'Yunnan Province': '云南省', 'Guizhou Province': '贵州省', 'Jiangxi Province': '江西省',
  'Hunan Province': '湖南省', 'Zhejiang Province': '浙江省', 'Shanghai Municipality': '上海市',
  'Chongqing Municipality': '重庆市', 'Hubei Province': '湖北省', 'Sichuan Province': '四川省',
  'Anhui Province': '安徽省', 'Jiangsu Province': '江苏省', 'Henan Province': '河南省',
  'Tibet Autonomous Region': '西藏自治区', 'Shandong Province': '山东省', 'Qinghai Province': '青海省',
  'Ningxia Ningxia Hui Autonomous Region': '宁夏回族自治区', 'Shaanxi Province': '陕西省',
  'Tianjin Municipality': '天津市', 'Shanxi Province': '山西省', 'Beijing Municipality': '北京市',
  'Gansu Province': '甘肃省', 'Hebei Province': '河北省', 'Liaoning Province': '辽宁省',
  'Jilin Province': '吉林省', 'Xinjiang Uyghur Autonomous Region': '新疆维吾尔自治区',
  'Inner Mongolia Autonomous Region': '内蒙古自治区', 'Heilongjiang Province': '黑龙江省',
  'Macau Special Administrative Region': '澳门特别行政区',
  'Hong Kong Special Administrative Region': '香港特别行政区',
  // This is an upstream label typo, resolved explicitly rather than guessed.
  'Guangzhou Province': '广东省'
}
// Audited against the fixed 2017 source identities; never use a first Han alias
// or a coarse province polygon to decide a formal city name / province.
const AUDITED_PREFECTURES = new Map([
  ["CHN-ADM2-1590546715-B1", {"sourceName":"Qiqihar City","province":"黑龙江省","name":"齐齐哈尔市"}],
  ["CHN-ADM2-1590546715-B2", {"sourceName":"Xianyang City","province":"陕西省","name":"咸阳市"}],
  ["CHN-ADM2-1590546715-B3", {"sourceName":"Qinzhou City","province":"广西壮族自治区","name":"钦州市"}],
  ["CHN-ADM2-1590546715-B4", {"sourceName":"Yiyang City","province":"湖南省","name":"益阳市"}],
  ["CHN-ADM2-1590546715-B5", {"sourceName":"Yulin City","province":"广西壮族自治区","name":"玉林市"}],
  ["CHN-ADM2-1590546715-B6", {"sourceName":"Yancheng City","province":"江苏省","name":"盐城市"}],
  ["CHN-ADM2-1590546715-B7", {"sourceName":"Loudi City","province":"湖南省","name":"娄底市"}],
  ["CHN-ADM2-1590546715-B8", {"sourceName":"Harbin City","province":"黑龙江省","name":"哈尔滨市"}],
  ["CHN-ADM2-1590546715-B9", {"sourceName":"Guyuan City","province":"宁夏回族自治区","name":"固原市"}],
  ["CHN-ADM2-1590546715-B10", {"sourceName":"Haibei Tibetan Autonomous Prefecture","province":"青海省","name":"海北藏族自治州"}],
  ["CHN-ADM2-1590546715-B11", {"sourceName":"Haidong City","province":"青海省","name":"海东市"}],
  ["CHN-ADM2-1590546715-B12", {"sourceName":"Haikou City","province":"海南省","name":"海口市"}],
  ["CHN-ADM2-1590546715-B13", {"sourceName":"Golog Tibetan Autonomous Prefecture","province":"青海省","name":"果洛藏族自治州"}],
  ["CHN-ADM2-1590546715-B14", {"sourceName":"Guang'an City","province":"四川省","name":"广安市"}],
  ["CHN-ADM2-1590546715-B15", {"sourceName":"Guangyuan City","province":"四川省","name":"广元市"}],
  ["CHN-ADM2-1590546715-B16", {"sourceName":"Guangzhou City","province":"广东省","name":"广州市"}],
  ["CHN-ADM2-1590546715-B17", {"sourceName":"Guigang City","province":"广西壮族自治区","name":"贵港市"}],
  ["CHN-ADM2-1590546715-B18", {"sourceName":"Guilin City","province":"广西壮族自治区","name":"桂林市"}],
  ["CHN-ADM2-1590546715-B19", {"sourceName":"Guiyang City","province":"贵州省","name":"贵阳市"}],
  ["CHN-ADM2-1590546715-B20", {"sourceName":"Chengdu City","province":"四川省","name":"成都市"}],
  ["CHN-ADM2-1590546715-B21", {"sourceName":"Chenzhou City","province":"湖南省","name":"郴州市"}],
  ["CHN-ADM2-1590546715-B22", {"sourceName":"Chaozhou City","province":"广东省","name":"潮州市"}],
  ["CHN-ADM2-1590546715-B23", {"sourceName":"Chengde City","province":"河北省","name":"承德市"}],
  ["CHN-ADM2-1590546715-B24", {"sourceName":"Changde City","province":"湖南省","name":"常德市"}],
  ["CHN-ADM2-1590546715-B25", {"sourceName":"Changji Hui Autonomous Prefecture","province":"新疆维吾尔自治区","name":"昌吉回族自治州"}],
  ["CHN-ADM2-1590546715-B26", {"sourceName":"Bengbu City","province":"安徽省","name":"蚌埠市"}],
  ["CHN-ADM2-1590546715-B27", {"sourceName":"Benxi City","province":"辽宁省","name":"本溪市"}],
  ["CHN-ADM2-1590546715-B28", {"sourceName":"Bijie City","province":"贵州省","name":"毕节市"}],
  ["CHN-ADM2-1590546715-B29", {"sourceName":"Binzhou City","province":"山东省","name":"滨州市"}],
  ["CHN-ADM2-1590546715-B30", {"sourceName":"Bortala Mongol Autonomous Prefecture","province":"新疆维吾尔自治区","name":"博尔塔拉蒙古自治州"}],
  ["CHN-ADM2-1590546715-B31", {"sourceName":"Baoji City","province":"陕西省","name":"宝鸡市"}],
  ["CHN-ADM2-1590546715-B32", {"sourceName":"Baoshan","province":"云南省","name":"保山市"}],
  ["CHN-ADM2-1590546715-B33", {"sourceName":"Baotou City","province":"内蒙古自治区","name":"包头市"}],
  ["CHN-ADM2-1590546715-B34", {"sourceName":"Bayannur City","province":"内蒙古自治区","name":"巴彦淖尔市"}],
  ["CHN-ADM2-1590546715-B35", {"sourceName":"Bayingolin Mongol Autonomous Prefecture","province":"新疆维吾尔自治区","name":"巴音郭楞蒙古自治州"}],
  ["CHN-ADM2-1590546715-B36", {"sourceName":"Bazhong City","province":"四川省","name":"巴中市"}],
  ["CHN-ADM2-1590546715-B37", {"sourceName":"Anshun City","province":"贵州省","name":"安顺市"}],
  ["CHN-ADM2-1590546715-B38", {"sourceName":"Anyang City","province":"河南省","name":"安阳市"}],
  ["CHN-ADM2-1590546715-B39", {"sourceName":"Baicheng City","province":"吉林省","name":"白城市"}],
  ["CHN-ADM2-1590546715-B40", {"sourceName":"Baise City","province":"广西壮族自治区","name":"百色市"}],
  ["CHN-ADM2-1590546715-B41", {"sourceName":"Baishan City","province":"吉林省","name":"白山市"}],
  ["CHN-ADM2-1590546715-B42", {"sourceName":"Baiyin","province":"甘肃省","name":"白银市"}],
  ["CHN-ADM2-1590546715-B43", {"sourceName":"Baoding City","province":"河北省","name":"保定市"}],
  ["CHN-ADM2-1590546715-B44", {"sourceName":"Anshan City","province":"辽宁省","name":"鞍山市"}],
  ["CHN-ADM2-1590546715-B45", {"sourceName":"Liangshan Yi Autonomous Prefecture","province":"四川省","name":"凉山彝族自治州"}],
  ["CHN-ADM2-1590546715-B46", {"sourceName":"Ningde City","province":"福建省","name":"宁德市"}],
  ["CHN-ADM2-1590546715-B47", {"sourceName":"Pu'er City","province":"云南省","name":"普洱市"}],
  ["CHN-ADM2-1590546715-B48", {"sourceName":"Yongzhou City","province":"湖南省","name":"永州市"}],
  ["CHN-ADM2-1590546715-B49", {"sourceName":"Yueyang City","province":"湖南省","name":"岳阳市"}],
  ["CHN-ADM2-1590546715-B50", {"sourceName":"Dingxi","province":"甘肃省","name":"定西市"}],
  ["CHN-ADM2-1590546715-B51", {"sourceName":"Dongguan City","province":"广东省","name":"东莞市"}],
  ["CHN-ADM2-1590546715-B52", {"sourceName":"Xuancheng City","province":"安徽省","name":"宣城市"}],
  ["CHN-ADM2-1590546715-B53", {"sourceName":"Shangqiu City","province":"河南省","name":"商丘市"}],
  ["CHN-ADM2-1590546715-B54", {"sourceName":"Bozhou City","province":"安徽省","name":"亳州市"}],
  ["CHN-ADM2-1590546715-B55", {"sourceName":"Jiaxing City","province":"浙江省","name":"嘉兴市"}],
  ["CHN-ADM2-1590546715-B56", {"sourceName":"Sanmenxia City","province":"河南省","name":"三门峡市"}],
  ["CHN-ADM2-1590546715-B57", {"sourceName":"Sanming City","province":"福建省","name":"三明市"}],
  ["CHN-ADM2-1590546715-B58", {"sourceName":"Tianshui","province":"甘肃省","name":"天水市"}],
  ["CHN-ADM2-1590546715-B59", {"sourceName":"Tieling City","province":"辽宁省","name":"铁岭市"}],
  ["CHN-ADM2-1590546715-B60", {"sourceName":"Xiaogan City","province":"湖北省","name":"孝感市"}],
  ["CHN-ADM2-1590546715-B61", {"sourceName":"Xilingol League","province":"内蒙古自治区","name":"锡林郭勒盟"}],
  ["CHN-ADM2-1590546715-B62", {"sourceName":"Xingtai City","province":"河北省","name":"邢台市"}],
  ["CHN-ADM2-1590546715-B63", {"sourceName":"Jincheng City","province":"山西省","name":"晋城市"}],
  ["CHN-ADM2-1590546715-B64", {"sourceName":"Taiyuan City","province":"山西省","name":"太原市"}],
  ["CHN-ADM2-1590546715-B65", {"sourceName":"Dali","province":"云南省","name":"大理白族自治州"}],
  ["CHN-ADM2-1590546715-B66", {"sourceName":"Chizhou City","province":"安徽省","name":"池州市"}],
  ["CHN-ADM2-1590546715-B67", {"sourceName":"Huai'an City","province":"江苏省","name":"淮安市"}],
  ["CHN-ADM2-1590546715-B68", {"sourceName":"Kunming","province":"云南省","name":"昆明市"}],
  ["CHN-ADM2-1590546715-B69", {"sourceName":"Laibin City","province":"广西壮族自治区","name":"来宾市"}],
  ["CHN-ADM2-1590546715-B70", {"sourceName":"Shiyan City","province":"湖北省","name":"十堰市"}],
  ["CHN-ADM2-1590546715-B71", {"sourceName":"Zhuzhou City","province":"湖南省","name":"株洲市"}],
  ["CHN-ADM2-1590546715-B72", {"sourceName":"Linyi City","province":"山东省","name":"临沂市"}],
  ["CHN-ADM2-1590546715-B73", {"sourceName":"Lishui City","province":"浙江省","name":"丽水市"}],
  ["CHN-ADM2-1590546715-B74", {"sourceName":"Jieyang City","province":"广东省","name":"揭阳市"}],
  ["CHN-ADM2-1590546715-B75", {"sourceName":"Huaihua City","province":"湖南省","name":"怀化市"}],
  ["CHN-ADM2-1590546715-B76", {"sourceName":"Chuxiong Yi Autonomous Prefecture","province":"云南省","name":"楚雄彝族自治州"}],
  ["CHN-ADM2-1590546715-B77", {"sourceName":"Chuzhou City","province":"安徽省","name":"滁州市"}],
  ["CHN-ADM2-1590546715-B79", {"sourceName":"Huizhou City","province":"广东省","name":"惠州市"}],
  ["CHN-ADM2-1590546715-B80", {"sourceName":"Huludao City","province":"辽宁省","name":"葫芦岛市"}],
  ["CHN-ADM2-1590546715-B81", {"sourceName":"Hulunbuir","province":"内蒙古自治区","name":"呼伦贝尔市"}],
  ["CHN-ADM2-1590546715-B82", {"sourceName":"Huzhou City","province":"浙江省","name":"湖州市"}],
  ["CHN-ADM2-1590546715-B83", {"sourceName":"Ili Kazakh Autonomous Prefecture","province":"新疆维吾尔自治区","name":"伊犁哈萨克自治州"}],
  ["CHN-ADM2-1590546715-B84", {"sourceName":"Jiamusi City","province":"黑龙江省","name":"佳木斯市"}],
  ["CHN-ADM2-1590546715-B85", {"sourceName":"Jixi","province":"黑龙江省","name":"鸡西市"}],
  ["CHN-ADM2-1590546715-B86", {"sourceName":"Kaifeng City","province":"河南省","name":"开封市"}],
  ["CHN-ADM2-1590546715-B87", {"sourceName":"Karamay City","province":"新疆维吾尔自治区","name":"克拉玛依市"}],
  ["CHN-ADM2-1590546715-B88", {"sourceName":"Kashgar Prefecture","province":"新疆维吾尔自治区","name":"喀什地区"}],
  ["CHN-ADM2-1590546715-B89", {"sourceName":"Liaoyuan City","province":"吉林省","name":"辽源市"}],
  ["CHN-ADM2-1590546715-B90", {"sourceName":"Suizhou City","province":"湖北省","name":"随州市"}],
  ["CHN-ADM2-1590546715-B91", {"sourceName":"Suqian City","province":"江苏省","name":"宿迁市"}],
  ["CHN-ADM2-1590546715-B92", {"sourceName":"Xiamen City","province":"福建省","name":"厦门市"}],
  ["CHN-ADM2-1590546715-B93", {"sourceName":"Xi'an","province":"陕西省","name":"西安市"}],
  ["CHN-ADM2-1590546715-B94", {"sourceName":"Xiangtan City","province":"湖南省","name":"湘潭市"}],
  ["CHN-ADM2-1590546715-B95", {"sourceName":"Xiangxi Tujia and Miao Autonomous Prefecture","province":"湖南省","name":"湘西土家族苗族自治州"}],
  ["CHN-ADM2-1590546715-B96", {"sourceName":"Xiangyang City","province":"湖北省","name":"襄阳市"}],
  ["CHN-ADM2-1590546715-B97", {"sourceName":"Xianning City","province":"湖北省","name":"咸宁市"}],
  ["CHN-ADM2-1590546715-B98", {"sourceName":"Zhangzhou City","province":"福建省","name":"漳州市"}],
  ["CHN-ADM2-1590546715-B99", {"sourceName":"Zhanjiang City","province":"广东省","name":"湛江市"}],
  ["CHN-ADM2-1590546715-B100", {"sourceName":"Zhaoqing City","province":"广东省","name":"肇庆市"}],
  ["CHN-ADM2-1590546715-B101", {"sourceName":"Zhaotong","province":"云南省","name":"昭通市"}],
  ["CHN-ADM2-1590546715-B102", {"sourceName":"Zhengzhou City","province":"河南省","name":"郑州市"}],
  ["CHN-ADM2-1590546715-B103", {"sourceName":"Xuzhou City","province":"江苏省","name":"徐州市"}],
  ["CHN-ADM2-1590546715-B104", {"sourceName":"Ya'an City","province":"四川省","name":"雅安市"}],
  ["CHN-ADM2-1590546715-B105", {"sourceName":"Yan'an City","province":"陕西省","name":"延安市"}],
  ["CHN-ADM2-1590546715-B106", {"sourceName":"Yanbian Korean Autonomous Prefecture","province":"吉林省","name":"延边朝鲜族自治州"}],
  ["CHN-ADM2-1590546715-B107", {"sourceName":"Xinxiang City","province":"河南省","name":"新乡市"}],
  ["CHN-ADM2-1590546715-B108", {"sourceName":"Xinyang City","province":"河南省","name":"信阳市"}],
  ["CHN-ADM2-1590546715-B109", {"sourceName":"Huangshi","province":"湖北省","name":"黄石市"}],
  ["CHN-ADM2-1590546715-B110", {"sourceName":"Suining City","province":"四川省","name":"遂宁市"}],
  ["CHN-ADM2-1590546715-B111", {"sourceName":"Fushun City","province":"辽宁省","name":"抚顺市"}],
  ["CHN-ADM2-1590546715-B112", {"sourceName":"Fuxin City","province":"辽宁省","name":"阜新市"}],
  ["CHN-ADM2-1590546715-B113", {"sourceName":"Nanping City","province":"福建省","name":"南平市"}],
  ["CHN-ADM2-1590546715-B114", {"sourceName":"Nantong City","province":"江苏省","name":"南通市"}],
  ["CHN-ADM2-1590546715-B115", {"sourceName":"Nanyang City","province":"河南省","name":"南阳市"}],
  ["CHN-ADM2-1590546715-B116", {"sourceName":"Neijiang City","province":"四川省","name":"内江市"}],
  ["CHN-ADM2-1590546715-B118", {"sourceName":"Ngari Prefecture","province":"西藏自治区","name":"阿里地区"}],
  ["CHN-ADM2-1590546715-B119", {"sourceName":"Ngawa Tibetan and Qiang Autonomous Prefecture","province":"四川省","name":"阿坝藏族羌族自治州"}],
  ["CHN-ADM2-1590546715-B120", {"sourceName":"Jining City","province":"山东省","name":"济宁市"}],
  ["CHN-ADM2-1590546715-B121", {"sourceName":"Jinzhong City","province":"山西省","name":"晋中市"}],
  ["CHN-ADM2-1590546715-B122", {"sourceName":"Jiujiang City","province":"江西省","name":"九江市"}],
  ["CHN-ADM2-1590546715-B123", {"sourceName":"Linfen Shi","province":"山西省","name":"临汾市"}],
  ["CHN-ADM2-1590546715-B124", {"sourceName":"Linxia Hui Autonomous Prefecture","province":"甘肃省","name":"临夏回族自治州"}],
  ["CHN-ADM2-1590546715-B125", {"sourceName":"Lianyungang City","province":"江苏省","name":"连云港市"}],
  ["CHN-ADM2-1590546715-B126", {"sourceName":"Liaocheng City","province":"山东省","name":"聊城市"}],
  ["CHN-ADM2-1590546715-B127", {"sourceName":"Liaoyang City","province":"辽宁省","name":"辽阳市"}],
  ["CHN-ADM2-1590546715-B128", {"sourceName":"Lijiang City","province":"云南省","name":"丽江市"}],
  ["CHN-ADM2-1590546715-B129", {"sourceName":"Lincang","province":"云南省","name":"临沧市"}],
  ["CHN-ADM2-1590546715-B130", {"sourceName":"Mianyang City","province":"四川省","name":"绵阳市"}],
  ["CHN-ADM2-1590546715-B131", {"sourceName":"Mudanjiang City","province":"黑龙江省","name":"牡丹江市"}],
  ["CHN-ADM2-1590546715-B132", {"sourceName":"Nagqu Prefecture","province":"西藏自治区","name":"那曲地区"}],
  ["CHN-ADM2-1590546715-B133", {"sourceName":"Nanchang","province":"江西省","name":"南昌市"}],
  ["CHN-ADM2-1590546715-B134", {"sourceName":"Nanchong City","province":"四川省","name":"南充市"}],
  ["CHN-ADM2-1590546715-B135", {"sourceName":"Nanjing City","province":"江苏省","name":"南京市"}],
  ["CHN-ADM2-1590546715-B136", {"sourceName":"Nanning City","province":"广西壮族自治区","name":"南宁市"}],
  ["CHN-ADM2-1590546715-B137", {"sourceName":"Lu'an City","province":"安徽省","name":"六安市"}],
  ["CHN-ADM2-1590546715-B138", {"sourceName":"Sanya City","province":"海南省","name":"三亚市"}],
  ["CHN-ADM2-1590546715-B139", {"sourceName":"Huangnan Tibetan Autonomous Prefecture","province":"青海省","name":"黄南藏族自治州"}],
  ["CHN-ADM2-1590546715-B140", {"sourceName":"Hechi City","province":"广西壮族自治区","name":"河池市"}],
  ["CHN-ADM2-1590546715-B141", {"sourceName":"Hefei City","province":"安徽省","name":"合肥市"}],
  ["CHN-ADM2-1590546715-B142", {"sourceName":"Rizhao City","province":"山东省","name":"日照市"}],
  ["CHN-ADM2-1590546715-B143", {"sourceName":"Shaoguan City","province":"广东省","name":"韶关市"}],
  ["CHN-ADM2-1590546715-B144", {"sourceName":"Shaoxing City","province":"浙江省","name":"绍兴市"}],
  ["CHN-ADM2-1590546715-B145", {"sourceName":"Shaoyang City","province":"湖南省","name":"邵阳市"}],
  ["CHN-ADM2-1590546715-B146", {"sourceName":"Shenyang City","province":"辽宁省","name":"沈阳市"}],
  ["CHN-ADM2-1590546715-B147", {"sourceName":"Wuhan City","province":"湖北省","name":"武汉市"}],
  ["CHN-ADM2-1590546715-B148", {"sourceName":"Tonghua City","province":"吉林省","name":"通化市"}],
  ["CHN-ADM2-1590546715-B149", {"sourceName":"Tongliao City","province":"内蒙古自治区","name":"通辽市"}],
  ["CHN-ADM2-1590546715-B150", {"sourceName":"Suzhou City","province":"安徽省","name":"宿州市"}],
  ["CHN-ADM2-1590546715-B151", {"sourceName":"Dandong City","province":"辽宁省","name":"丹东市"}],
  ["CHN-ADM2-1590546715-B152", {"sourceName":"Danzhou City","province":"海南省","name":"儋州市"}],
  ["CHN-ADM2-1590546715-B153", {"sourceName":"Daqing City","province":"黑龙江省","name":"大庆市"}],
  ["CHN-ADM2-1590546715-B154", {"sourceName":"Datong City","province":"山西省","name":"大同市"}],
  ["CHN-ADM2-1590546715-B155", {"sourceName":"Daxing'anling Prefecture","province":"黑龙江省","name":"大兴安岭地区"}],
  ["CHN-ADM2-1590546715-B156", {"sourceName":"Dazhou City","province":"四川省","name":"达州市"}],
  ["CHN-ADM2-1590546715-B157", {"sourceName":"Yantai City","province":"山东省","name":"烟台市"}],
  ["CHN-ADM2-1590546715-B158", {"sourceName":"Huangshan City","province":"安徽省","name":"黄山市"}],
  ["CHN-ADM2-1590546715-B159", {"sourceName":"Hangzhou City","province":"浙江省","name":"杭州市"}],
  ["CHN-ADM2-1590546715-B160", {"sourceName":"Hanzhong City","province":"陕西省","name":"汉中市"}],
  ["CHN-ADM2-1590546715-B161", {"sourceName":"Quzhou City","province":"浙江省","name":"衢州市"}],
  ["CHN-ADM2-1590546715-B162", {"sourceName":"Yuxi","province":"云南省","name":"玉溪市"}],
  ["CHN-ADM2-1590546715-B163", {"sourceName":"Xishuangbanna Dai Autonomous Prefecture","province":"云南省","name":"西双版纳傣族自治州"}],
  ["CHN-ADM2-1590546715-B164", {"sourceName":"Yichun City","province":"黑龙江省","name":"伊春市"}],
  ["CHN-ADM2-1590546715-B165", {"sourceName":"Taizhou City","province":"浙江省","name":"台州市"}],
  ["CHN-ADM2-1590546715-B166", {"sourceName":"Yinchuan City","province":"宁夏回族自治区","name":"银川市"}],
  ["CHN-ADM2-1590546715-B167", {"sourceName":"Yingkou City","province":"辽宁省","name":"营口市"}],
  ["CHN-ADM2-1590546715-B168", {"sourceName":"Yingtan City","province":"江西省","name":"鹰潭市"}],
  ["CHN-ADM2-1590546715-B169", {"sourceName":"Heyuan City","province":"广东省","name":"河源市"}],
  ["CHN-ADM2-1590546715-B170", {"sourceName":"Jinan City","province":"山东省","name":"济南市"}],
  ["CHN-ADM2-1590546715-B171", {"sourceName":"Tongling City","province":"安徽省","name":"铜陵市"}],
  ["CHN-ADM2-1590546715-B172", {"sourceName":"Tacheng Prefecture","province":"新疆维吾尔自治区","name":"塔城地区"}],
  ["CHN-ADM2-1590546715-B173", {"sourceName":"Hainan Tibetan Autonomous Prefecture","province":"青海省","name":"海南藏族自治州"}],
  ["CHN-ADM2-1590546715-B174", {"sourceName":"Hami","province":"新疆维吾尔自治区","name":"哈密市"}],
  ["CHN-ADM2-1590546715-B175", {"sourceName":"Shuozhou City","province":"山西省","name":"朔州市"}],
  ["CHN-ADM2-1590546715-B176", {"sourceName":"Ningbo City","province":"浙江省","name":"宁波市"}],
  ["CHN-ADM2-1590546715-B177", {"sourceName":"Nujiang Lisu Autonomous Prefecture","province":"云南省","name":"怒江傈僳族自治州"}],
  ["CHN-ADM2-1590546715-B178", {"sourceName":"Nyingchi City","province":"西藏自治区","name":"林芝市"}],
  ["CHN-ADM2-1590546715-B179", {"sourceName":"Jingmen City","province":"湖北省","name":"荆门市"}],
  ["CHN-ADM2-1590546715-B180", {"sourceName":"Hinggan League","province":"内蒙古自治区","name":"兴安盟"}],
  ["CHN-ADM2-1590546715-B181", {"sourceName":"Honghe Hani and Yi Autonomous Prefecture","province":"云南省","name":"红河哈尼族彝族自治州"}],
  ["CHN-ADM2-1590546715-B182", {"sourceName":"Quanzhou","province":"福建省","name":"泉州市"}],
  ["CHN-ADM2-1590546715-B183", {"sourceName":"Huanggang City","province":"湖北省","name":"黄冈市"}],
  ["CHN-ADM2-1590546715-B184", {"sourceName":"Hezhou City","province":"广西壮族自治区","name":"贺州市"}],
  ["CHN-ADM2-1590546715-B185", {"sourceName":"Yulin City","province":"陕西省","name":"榆林市"}],
  ["CHN-ADM2-1590546715-B186", {"sourceName":"Chongzuo City","province":"广西壮族自治区","name":"崇左市"}],
  ["CHN-ADM2-1590546715-B188", {"sourceName":"Qujing","province":"云南省","name":"曲靖市"}],
  ["CHN-ADM2-1590546715-B189", {"sourceName":"Langfang City","province":"河北省","name":"廊坊市"}],
  ["CHN-ADM2-1590546715-B190", {"sourceName":"Jingdezhen City","province":"江西省","name":"景德镇市"}],
  ["CHN-ADM2-1590546715-B191", {"sourceName":"Jinzhou City","province":"辽宁省","name":"锦州市"}],
  ["CHN-ADM2-1590546715-B192", {"sourceName":"Ji'an City","province":"江西省","name":"吉安市"}],
  ["CHN-ADM2-1590546715-B193", {"sourceName":"Jiangmen City","province":"广东省","name":"江门市"}],
  ["CHN-ADM2-1590546715-B194", {"sourceName":"Suzhou City","province":"江苏省","name":"苏州市"}],
  ["CHN-ADM2-1590546715-B195", {"sourceName":"Lanzhou","province":"甘肃省","name":"兰州市"}],
  ["CHN-ADM2-1590546715-B196", {"sourceName":"Haixi Mongol and Tibetan Autonomous Prefecture","province":"青海省","name":"海西蒙古族藏族自治州"}],
  ["CHN-ADM2-1590546715-B197", {"sourceName":"Wuwei","province":"甘肃省","name":"武威市"}],
  ["CHN-ADM2-1590546715-B198", {"sourceName":"Cangzhou City","province":"河北省","name":"沧州市"}],
  ["CHN-ADM2-1590546715-B199", {"sourceName":"Yunfu City","province":"广东省","name":"云浮市"}],
  ["CHN-ADM2-1590546715-B200", {"sourceName":"Yushu Tibetan Autonomous Prefecture","province":"青海省","name":"玉树藏族自治州"}],
  ["CHN-ADM2-1590546715-B201", {"sourceName":"Yangjiang City","province":"广东省","name":"阳江市"}],
  ["CHN-ADM2-1590546715-B202", {"sourceName":"Chamdo City","province":"西藏自治区","name":"昌都市"}],
  ["CHN-ADM2-1590546715-B203", {"sourceName":"Changchun City","province":"吉林省","name":"长春市"}],
  ["CHN-ADM2-1590546715-B204", {"sourceName":"Dêqên Tibetan Autonomous Prefecture","province":"云南省","name":"迪庆藏族自治州"}],
  ["CHN-ADM2-1590546715-B205", {"sourceName":"Deyang City","province":"四川省","name":"德阳市"}],
  ["CHN-ADM2-1590546715-B206", {"sourceName":"Dezhou City","province":"山东省","name":"德州市"}],
  ["CHN-ADM2-1590546715-B207", {"sourceName":"Hegang City","province":"黑龙江省","name":"鹤岗市"}],
  ["CHN-ADM2-1590546715-B208", {"sourceName":"Heihe City","province":"黑龙江省","name":"黑河市"}],
  ["CHN-ADM2-1590546715-B209", {"sourceName":"Heze City","province":"山东省","name":"菏泽市"}],
  ["CHN-ADM2-1590546715-B211", {"sourceName":"Jinhua City","province":"浙江省","name":"金华市"}],
  ["CHN-ADM2-1590546715-B212", {"sourceName":"Jiuquan","province":"甘肃省","name":"酒泉市"}],
  ["CHN-ADM2-1590546715-B213", {"sourceName":"Longyan City","province":"福建省","name":"龙岩市"}],
  ["CHN-ADM2-1590546715-B214", {"sourceName":"Lüliang City","province":"山西省","name":"吕梁市"}],
  ["CHN-ADM2-1590546715-B215", {"sourceName":"Qitaihe","province":"黑龙江省","name":"七台河市"}],
  ["CHN-ADM2-1590546715-B216", {"sourceName":"Tai'an City","province":"山东省","name":"泰安市"}],
  ["CHN-ADM2-1590546715-B217", {"sourceName":"Tongren City","province":"贵州省","name":"铜仁市"}],
  ["CHN-ADM2-1590546715-B218", {"sourceName":"Turpan/Tulufan","province":"新疆维吾尔自治区","name":"吐鲁番市"}],
  ["CHN-ADM2-1590546715-B219", {"sourceName":"Ulanqab City","province":"内蒙古自治区","name":"乌兰察布市"}],
  ["CHN-ADM2-1590546715-B220", {"sourceName":"Ürümqi","province":"新疆维吾尔自治区","name":"乌鲁木齐市"}],
  ["CHN-ADM2-1590546715-B221", {"sourceName":"Xinzhou City","province":"山西省","name":"忻州市"}],
  ["CHN-ADM2-1590546715-B222", {"sourceName":"Zunyi City","province":"贵州省","name":"遵义市"}],
  ["CHN-ADM2-1590546715-B223", {"sourceName":"Zhongwei City","province":"宁夏回族自治区","name":"中卫市"}],
  ["CHN-ADM2-1590546715-B224", {"sourceName":"Zhoukou City","province":"河南省","name":"周口市"}],
  ["CHN-ADM2-1590546715-B225", {"sourceName":"Zhuhai City","province":"广东省","name":"珠海市"}],
  ["CHN-ADM2-1590546715-B226", {"sourceName":"Zhumadian City","province":"河南省","name":"驻马店市"}],
  ["CHN-ADM2-1590546715-B227", {"sourceName":"Zibo City","province":"山东省","name":"淄博市"}],
  ["CHN-ADM2-1590546715-B228", {"sourceName":"Zigong City","province":"四川省","name":"自贡市"}],
  ["CHN-ADM2-1590546715-B229", {"sourceName":"Yichang City","province":"湖北省","name":"宜昌市"}],
  ["CHN-ADM2-1590546715-B230", {"sourceName":"Yichun City","province":"江西省","name":"宜春市"}],
  ["CHN-ADM2-1590546715-B231", {"sourceName":"Zhenjiang City","province":"江苏省","name":"镇江市"}],
  ["CHN-ADM2-1590546715-B232", {"sourceName":"Wuzhong City","province":"宁夏回族自治区","name":"吴忠市"}],
  ["CHN-ADM2-1590546715-B233", {"sourceName":"Shijiazhuang City","province":"河北省","name":"石家庄市"}],
  ["CHN-ADM2-1590546715-B234", {"sourceName":"Shigatse","province":"西藏自治区","name":"日喀则市"}],
  ["CHN-ADM2-1590546715-B235", {"sourceName":"Shenzhen City","province":"广东省","name":"深圳市"}],
  ["CHN-ADM2-1590546715-B236", {"sourceName":"Ordos City","province":"内蒙古自治区","name":"鄂尔多斯市"}],
  ["CHN-ADM2-1590546715-B237", {"sourceName":"Panjin City","province":"辽宁省","name":"盘锦市"}],
  ["CHN-ADM2-1590546715-B238", {"sourceName":"Dalian City","province":"辽宁省","name":"大连市"}],
  ["CHN-ADM2-1590546715-B239", {"sourceName":"Dehong Dai and Jingpo Autonomous Prefecture","province":"云南省","name":"德宏傣族景颇族自治州"}],
  ["CHN-ADM2-1590546715-B240", {"sourceName":"Jilin City","province":"吉林省","name":"吉林市"}],
  ["CHN-ADM2-1590546715-B241", {"sourceName":"Longnan City","province":"甘肃省","name":"陇南市"}],
  ["CHN-ADM2-1590546715-B242", {"sourceName":"Pingliang","province":"甘肃省","name":"平凉市"}],
  ["CHN-ADM2-1590546715-B243", {"sourceName":"Taizhou City","province":"江苏省","name":"泰州市"}],
  ["CHN-ADM2-1590546715-B244", {"sourceName":"Shangluo City","province":"陕西省","name":"商洛市"}],
  ["CHN-ADM2-1590546715-B245", {"sourceName":"Zaozhuang City","province":"山东省","name":"枣庄市"}],
  ["CHN-ADM2-1590546715-B246", {"sourceName":"Zhangjiajie City","province":"湖南省","name":"张家界市"}],
  ["CHN-ADM2-1590546715-B247", {"sourceName":"Qingyang","province":"甘肃省","name":"庆阳市"}],
  ["CHN-ADM2-1590546715-B248", {"sourceName":"Aksu Prefecture","province":"新疆维吾尔自治区","name":"阿克苏地区"}],
  ["CHN-ADM2-1590546715-B249", {"sourceName":"Wuzhou City","province":"广西壮族自治区","name":"梧州市"}],
  ["CHN-ADM2-1590546715-B250", {"sourceName":"Hohhot City","province":"内蒙古自治区","name":"呼和浩特市"}],
  ["CHN-ADM2-1590546715-B251", {"sourceName":"Puyang City","province":"河南省","name":"濮阳市"}],
  ["CHN-ADM2-1590546715-B252", {"sourceName":"Qiandongnan Miao and Dong Autonomous Prefecture","province":"贵州省","name":"黔东南苗族侗族自治州"}],
  ["CHN-ADM2-1590546715-B253", {"sourceName":"Qiannan Buyei and Miao Autonomous Prefecture","province":"贵州省","name":"黔南布依族苗族自治州"}],
  ["CHN-ADM2-1590546715-B254", {"sourceName":"Wuxi City","province":"江苏省","name":"无锡市"}],
  ["CHN-ADM2-1590546715-B255", {"sourceName":"Yuncheng City","province":"山西省","name":"运城市"}],
  ["CHN-ADM2-1590546715-B256", {"sourceName":"Gannan Tibetan Autonomous Prefecture","province":"甘肃省","name":"甘南藏族自治州"}],
  ["CHN-ADM2-1590546715-B257", {"sourceName":"Hebi City","province":"河南省","name":"鹤壁市"}],
  ["CHN-ADM2-1590546715-B258", {"sourceName":"Ziyang City","province":"四川省","name":"资阳市"}],
  ["CHN-ADM2-1590546715-B259", {"sourceName":"Liupanshui City","province":"贵州省","name":"六盘水市"}],
  ["CHN-ADM2-1590546715-B260", {"sourceName":"Suihua City","province":"黑龙江省","name":"绥化市"}],
  ["CHN-ADM2-1590546715-B261", {"sourceName":"Weifang City","province":"山东省","name":"潍坊市"}],
  ["CHN-ADM2-1590546715-B262", {"sourceName":"Wenshan Zhuang and Miao Autonomous Prefecture","province":"云南省","name":"文山壮族苗族自治州"}],
  ["CHN-ADM2-1590546715-B263", {"sourceName":"Zhangjiakou City","province":"河北省","name":"张家口市"}],
  ["CHN-ADM2-1590546715-B264", {"sourceName":"Zhangye","province":"甘肃省","name":"张掖市"}],
  ["CHN-ADM2-1590546715-B265", {"sourceName":"Wuhu City","province":"安徽省","name":"芜湖市"}],
  ["CHN-ADM2-1590546715-B266", {"sourceName":"Wuhai City","province":"内蒙古自治区","name":"乌海市"}],
  ["CHN-ADM2-1590546715-B267", {"sourceName":"Tongchuan City","province":"陕西省","name":"铜川市"}],
  ["CHN-ADM2-1590546715-B269", {"sourceName":"Shuangyashan","province":"黑龙江省","name":"双鸭山市"}],
  ["CHN-ADM2-1590546715-B270", {"sourceName":"Shizuishan City","province":"宁夏回族自治区","name":"石嘴山市"}],
  ["CHN-ADM2-1590546715-B271", {"sourceName":"Shannan","province":"西藏自治区","name":"山南市"}],
  ["CHN-ADM2-1590546715-B272", {"sourceName":"Shangrao City","province":"江西省","name":"上饶市"}],
  ["CHN-ADM2-1590546715-B273", {"sourceName":"Sansha","province":"海南省","name":"三沙市"}],
  ["CHN-ADM2-1590546715-B274", {"sourceName":"Pingdingshan City","province":"河南省","name":"平顶山市"}],
  ["CHN-ADM2-1590546715-B275", {"sourceName":"Meizhou City","province":"广东省","name":"梅州市"}],
  ["CHN-ADM2-1590546715-B276", {"sourceName":"Meishan City","province":"四川省","name":"眉山市"}],
  ["CHN-ADM2-1590546715-B277", {"sourceName":"Maoming City","province":"广东省","name":"茂名市"}],
  ["CHN-ADM2-1590546715-B278", {"sourceName":"Ma'anshan City","province":"安徽省","name":"马鞍山市"}],
  ["CHN-ADM2-1590546715-B279", {"sourceName":"Luzhou City","province":"四川省","name":"泸州市"}],
  ["CHN-ADM2-1590546715-B280", {"sourceName":"Luoyang City","province":"河南省","name":"洛阳市"}],
  ["CHN-ADM2-1590546715-B281", {"sourceName":"Luohe City","province":"河南省","name":"漯河市"}],
  ["CHN-ADM2-1590546715-B282", {"sourceName":"Laiwu City","province":"山东省","name":"莱芜市"}],
  ["CHN-ADM2-1590546715-B283", {"sourceName":"Kizilsu Kirghiz Autonomous Prefecture","province":"新疆维吾尔自治区","name":"克孜勒苏柯尔克孜自治州"}],
  ["CHN-ADM2-1590546715-B284", {"sourceName":"Jingzhou City","province":"湖北省","name":"荆州市"}],
  ["CHN-ADM2-1590546715-B285", {"sourceName":"Jinchang","province":"甘肃省","name":"金昌市"}],
  ["CHN-ADM2-1590546715-B286", {"sourceName":"Jiayuguan","province":"甘肃省","name":"嘉峪关市"}],
  ["CHN-ADM2-1590546715-B287", {"sourceName":"Jiaozuo City","province":"河南省","name":"焦作市"}],
  ["CHN-ADM2-1590546715-B288", {"sourceName":"Huainan City","province":"安徽省","name":"淮南市"}],
  ["CHN-ADM2-1590546715-B289", {"sourceName":"Huaibei City","province":"安徽省","name":"淮北市"}],
  ["CHN-ADM2-1590546715-B290", {"sourceName":"Foshan City","province":"广东省","name":"佛山市"}],
  ["CHN-ADM2-1590546715-B291", {"sourceName":"Fangchenggang City","province":"广西壮族自治区","name":"防城港市"}],
  ["CHN-ADM2-1590546715-B292", {"sourceName":"Chifeng City","province":"内蒙古自治区","name":"赤峰市"}],
  ["CHN-ADM2-1590546715-B293", {"sourceName":"Chaoyang City","province":"辽宁省","name":"朝阳市"}],
  ["CHN-ADM2-1590546715-B294", {"sourceName":"Anqing City","province":"安徽省","name":"安庆市"}],
  ["CHN-ADM2-1590546715-B295", {"sourceName":"Ankang City","province":"陕西省","name":"安康市"}],
  ["CHN-ADM2-1590546715-B296", {"sourceName":"Alxa League","province":"内蒙古自治区","name":"阿拉善盟"}],
  ["CHN-ADM2-1590546715-B297", {"sourceName":"Altay Prefecture","province":"新疆维吾尔自治区","name":"阿勒泰地区"}],
  ["CHN-ADM2-1590546715-B298", {"sourceName":"Zhoushan City","province":"浙江省","name":"舟山市"}],
  ["CHN-ADM2-1590546715-B299", {"sourceName":"Zhongshan City","province":"广东省","name":"中山市"}],
  ["CHN-ADM2-1590546715-B301", {"sourceName":"Yangquan City","province":"山西省","name":"阳泉市"}],
  ["CHN-ADM2-1590546715-B302", {"sourceName":"Xuchang City","province":"河南省","name":"许昌市"}],
  ["CHN-ADM2-1590546715-B303", {"sourceName":"Xining City","province":"青海省","name":"西宁市"}],
  ["CHN-ADM2-1590546715-B304", {"sourceName":"Changsha City","province":"湖南省","name":"长沙市"}],
  ["CHN-ADM2-1590546715-B305", {"sourceName":"Ezhou City","province":"湖北省","name":"鄂州市"}],
  ["CHN-ADM2-1590546715-B306", {"sourceName":"Enshi Tujia and Miao Autonomous Prefecture","province":"湖北省","name":"恩施土家族苗族自治州"}],
  ["CHN-ADM2-1590546715-B307", {"sourceName":"Dongying City","province":"山东省","name":"东营市"}],
  ["CHN-ADM2-1590546715-B308", {"sourceName":"Changzhou City","province":"江苏省","name":"常州市"}],
  ["CHN-ADM2-1590546715-B309", {"sourceName":"Pingxiang City","province":"江西省","name":"萍乡市"}],
  ["CHN-ADM2-1590546715-B310", {"sourceName":"Qianxinan Buyei and Miao Autonomous Prefecture","province":"贵州省","name":"黔西南布依族苗族自治州"}],
  ["CHN-ADM2-1590546715-B311", {"sourceName":"Qingdao City","province":"山东省","name":"青岛市"}],
  ["CHN-ADM2-1590546715-B312", {"sourceName":"Qinhuangdao City","province":"河北省","name":"秦皇岛市"}],
  ["CHN-ADM2-1590546715-B313", {"sourceName":"Tangshan City","province":"河北省","name":"唐山市"}],
  ["CHN-ADM2-1590546715-B314", {"sourceName":"Hotan Prefecture","province":"新疆维吾尔自治区","name":"和田地区"}],
  ["CHN-ADM2-1590546715-B315", {"sourceName":"Shantou City","province":"广东省","name":"汕头市"}],
  ["CHN-ADM2-1590546715-B316", {"sourceName":"Siping City","province":"吉林省","name":"四平市"}],
  ["CHN-ADM2-1590546715-B317", {"sourceName":"Songyuan City","province":"吉林省","name":"松原市"}],
  ["CHN-ADM2-1590546715-B318", {"sourceName":"Weihai","province":"山东省","name":"威海市"}],
  ["CHN-ADM2-1590546715-B319", {"sourceName":"Weinan City","province":"陕西省","name":"渭南市"}],
  ["CHN-ADM2-1590546715-B320", {"sourceName":"Wenzhou City","province":"浙江省","name":"温州市"}],
  ["CHN-ADM2-1590546715-B321", {"sourceName":"Putian City","province":"福建省","name":"莆田市"}],
  ["CHN-ADM2-1590546715-B322", {"sourceName":"Liuzhou City","province":"广西壮族自治区","name":"柳州市"}],
  ["CHN-ADM2-1590546715-B323", {"sourceName":"Panzhihua City","province":"四川省","name":"攀枝花市"}],
  ["CHN-ADM2-1590546715-B324", {"sourceName":"Xinyu City","province":"江西省","name":"新余市"}],
  ["CHN-ADM2-1590546715-B325", {"sourceName":"Ganzhou City","province":"江西省","name":"赣州市"}],
  ["CHN-ADM2-1590546715-B326", {"sourceName":"Garzê Tibetan Autonomous Prefecture","province":"四川省","name":"甘孜藏族自治州"}],
  ["CHN-ADM2-1590546715-B327", {"sourceName":"Yangzhou City","province":"江苏省","name":"扬州市"}],
  ["CHN-ADM2-1590546715-B328", {"sourceName":"Yibin City","province":"四川省","name":"宜宾市"}],
  ["CHN-ADM2-1590546715-B329", {"sourceName":"Beihai City","province":"广西壮族自治区","name":"北海市"}],
  ["CHN-ADM2-1590546715-B330", {"sourceName":"Changzhi City","province":"山西省","name":"长治市"}],
  ["CHN-ADM2-1590546715-B331", {"sourceName":"Fuyang City","province":"安徽省","name":"阜阳市"}],
  ["CHN-ADM2-1590546715-B332", {"sourceName":"Fuzhou City","province":"江西省","name":"抚州市"}],
  ["CHN-ADM2-1590546715-B333", {"sourceName":"Fuzhou City","province":"福建省","name":"福州市"}],
  ["CHN-ADM2-1590546715-B334", {"sourceName":"Handan City","province":"河北省","name":"邯郸市"}],
  ["CHN-ADM2-1590546715-B335", {"sourceName":"Hengshui City","province":"河北省","name":"衡水市"}],
  ["CHN-ADM2-1590546715-B336", {"sourceName":"Hengyang City","province":"湖南省","name":"衡阳市"}],
  ["CHN-ADM2-1590546715-B337", {"sourceName":"Leshan City","province":"四川省","name":"乐山市"}],
  ["CHN-ADM2-1590546715-B338", {"sourceName":"Lhasa","province":"西藏自治区","name":"拉萨市"}],
  ["CHN-ADM2-1590546715-B339", {"sourceName":"Qingyuan City","province":"广东省","name":"清远市"}],
  ["CHN-ADM2-1590546715-B340", {"sourceName":"Shanwei City","province":"广东省","name":"汕尾市"}]
])
const SPECIAL = {
  'Beijing Municipality': { name: '北京市', geonames: '1816670', aliases: ['北京', 'Beijing'] },
  'Tianjin Municipality': { name: '天津市', geonames: '1792947', aliases: ['天津', 'Tianjin'] },
  'Shanghai Municipality': { name: '上海市', geonames: '1796236', aliases: ['上海', 'Shanghai'] },
  'Chongqing Municipality': { name: '重庆市', geonames: '1814906', aliases: ['重庆', 'Chongqing'] },
  'Hong Kong Special Administrative Region': { name: '香港', geonames: '1819729', aliases: ['香港特别行政区', 'Hong Kong', 'Hongkong'] },
  'Macau Special Administrative Region': { name: '澳门', geonames: '1821274', aliases: ['澳門', '澳门特别行政区', 'Macao', 'Macau'] }
}
const REMOVED_HK = new Set(['Hong Kong Island', 'Kowloon', 'New Territories'])
const REMOVED_MACAU = new Set(['Coloane', 'Taipa'])
const NGARI_REFERENCE = 'https://www.xizang.gov.cn/xwzx_406/qxxw/202402/t20240210_403584.html'
// Reviewed identity concordance only: no geometry is moved or synthesized.
// The modern Taizhou gazetteer point lies outside this generalized 2017 coast.
const CONCORDANCE = [{ source: 'Taizhou City', province: '浙江省', name: '台州', geonames: '8400694' }]
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
// Keep in sync with src/renderer/map/domain.ts normalizeCityName.
const normalize = (name) => name.normalize('NFKC').trim().toLocaleLowerCase()
  .replace(/\s+(?:city|prefecture|municipality)$/i, '').replace(/市$/, '')
  .replace(/[\s·・.'’\-]/g, '')
const latinName = (name) => normalize(name.replace(/\s+(city|prefecture|league)$/i, ''))
const hasChinese = (name) => /\p{Script=Han}/u.test(name) && !/[\u3040-\u30ff\uac00-\ud7af]/u.test(name)
const toSimplifiedChinese = Converter({ from: 'tw', to: 'cn' })

async function download(url, bytes) {
  const read = async (start, end) => {
    let lastError
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: bytes ? { Range: `bytes=${start}-${end}` } : {},
          signal: AbortSignal.timeout(45000)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
        const data = Buffer.from(await response.arrayBuffer())
        if (!bytes) return data
        const part = response.status === 206 ? data : data.subarray(start, end + 1)
        assert.equal(part.length, end - start + 1, `Incomplete source range: ${url}`)
        return part
      } catch (error) { lastError = error }
    }
    throw lastError
  }
  if (!bytes || bytes <= 400000) return read(0, bytes ? bytes - 1 : 0)
  // Bounded parallel range reads avoid slow large responses on archival hosts.
  const chunk = 400000
  const results = new Array(Math.ceil(bytes / chunk))
  let cursor = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < results.length) {
      const i = cursor++
      results[i] = await read(i * chunk, Math.min(bytes - 1, (i + 1) * chunk - 1))
    }
  }))
  return Buffer.concat(results)
}

function ringContains(ring, x, y) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]; const [bx, by] = ring[j]
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}
function contains(geometry, lon, lat) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some((rings) => ringContains(rings[0], lon, lat) && !rings.slice(1).some((ring) => ringContains(ring, lon, lat)))
}
function bounds(geometry) {
  const result = [Infinity, Infinity, -Infinity, -Infinity]
  const walk = (coordinates) => {
    if (typeof coordinates[0] === 'number') {
      result[0] = Math.min(result[0], coordinates[0]); result[1] = Math.min(result[1], coordinates[1])
      result[2] = Math.max(result[2], coordinates[0]); result[3] = Math.max(result[3], coordinates[1])
    } else for (const child of coordinates) walk(child)
  }
  walk(geometry.coordinates)
  return result
}
function inside(feature, city) {
  const b = feature.bbox
  return city.lon >= b[0] && city.lon <= b[2] && city.lat >= b[1] && city.lat <= b[3] && contains(feature.geometry, city.lon, city.lat)
}
function representativePoint(geometry) {
  const b = bounds(geometry)
  const mid = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  if (contains(geometry, ...mid)) return mid
  // Island groups such as Sansha have a huge overall box but tiny land rings.
  // Search individual polygons first so their label does not fall in the sea.
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const ringArea = (ring) => Math.abs(ring.slice(0, -1).reduce((sum, p, i) => sum + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1], 0))
  for (const polygon of polygons.toSorted((a, c) => ringArea(c[0]) - ringArea(a[0]))) {
    const small = { type: 'Polygon', coordinates: polygon }
    const box = bounds(small)
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
      const p = [box[0] + ((box[2] - box[0]) * x) / 8, box[1] + ((box[3] - box[1]) * y) / 8]
      if (contains(small, ...p)) return p
    }
  }
  for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) {
    const p = [b[0] + ((b[2] - b[0]) * x) / 20, b[1] + ((b[3] - b[1]) * y) / 20]
    if (contains(geometry, ...p)) return p
  }
  return geometry.type === 'Polygon' ? geometry.coordinates[0][0] : geometry.coordinates[0][0][0]
}
function clockwiseGeometry(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const coordinates = polygons.map((rings) => rings.map((ring, i) => {
    const area = ring.slice(0, -1).reduce((sum, point, j) => sum + point[0] * ring[j + 1][1] - ring[j + 1][0] * point[1], 0)
    return (i === 0 ? area > 0 : area < 0) ? [...ring].reverse() : ring
  }))
  return { type: geometry.type, coordinates: geometry.type === 'Polygon' ? coordinates[0] : coordinates }
}

const sourceBuffers = {}
await Promise.all(Object.entries(SOURCES).map(async ([key, source]) => {
  console.log(`Downloading ${key}: ${source.url}`)
  const data = await download(source.url, source.bytes)
  if (source.sha256) assert.equal(hash(data), source.sha256, `Pinned source changed: ${key}`)
  sourceBuffers[key] = data
}))
const rawPrefectures = JSON.parse(sourceBuffers.prefectures)
const original = feature(rawPrefectures, Object.values(rawPrefectures.objects)[0]).features
assert.equal(original.length, 340, 'Expected the historical city layer, never the current 2391-county ADM2')
assert(original.some((f) => f.properties.shapeName === 'Hangzhou City'))
// The source ADM2 layer contains one county nested next to its prefecture.
// Assign the original polygon parts to the same prefecture feature. The city
// mesh then omits their shared internal arcs (both sides have the same id).
// This preserves every valid source ring without inventing connecting edges.
// Zanda (札达县) belongs to Ngari (阿里地区); no outside geometry is introduced.
const ngari = original.find((f) => f.properties.shapeName === 'Ngari Prefecture')
const zanda = original.find((f) => f.properties.shapeName === 'Zanda County')
assert(ngari && zanda)
ngari.geometry = { type: 'MultiPolygon', coordinates: [ngari.geometry, zanda.geometry].flatMap((geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates) }
const rawProvinces = JSON.parse(sourceBuffers.provinces).features
assert.equal(rawProvinces.length, 34)
const municipalTopology = JSON.parse(sourceBuffers.municipalities2017)
const municipalSources = feature(municipalTopology, Object.values(municipalTopology.objects)[0]).features
assert.equal(municipalSources.length, 31)
const hongKongGeometry = merge(rawPrefectures, Object.values(rawPrefectures.objects)[0].geometries.filter((g) => REMOVED_HK.has(g.properties.shapeName)))
assert((hongKongGeometry.coordinates).every((polygon) => polygon.every((ring) => JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1)))), 'Historical HK union rings must close')
const cityBytes = await fs.readFile(path.join(RESOURCES, 'cities.json.gz'))
const cityData = JSON.parse(gunzipSync(cityBytes))
const gazetteer = cityData.rows.map((row) => Object.fromEntries(cityData.columns.map((name, i) => [name, row[i]])))
const chineseCities = gazetteer.filter((city) => ['CN', 'HK', 'MO'].includes(city.country))
const provinces = rawProvinces.map((f) => ({
  type: 'Feature',
  properties: { id: `gb:${f.properties.shapeID}`, name: PROVINCE_NAMES[f.properties.shapeName], aliases: [f.properties.shapeName] },
  geometry: f.geometry,
  bbox: bounds(f.geometry)
}))
assert(provinces.every((f) => f.properties.name), 'Unreviewed province label')

const labelAudit = []
const regions = original.filter((f) => !REMOVED_HK.has(f.properties.shapeName) && !REMOVED_MACAU.has(f.properties.shapeName) && f.properties.shapeName !== 'Zanda County').map((f) => {
  const sourceName = f.properties.shapeName
  f.bbox = bounds(f.geometry)
  const candidates = chineseCities.filter((city) => city.country === 'CN' && inside(f, city))
  const sourceKey = latinName(sourceName)
  const matched = candidates.filter((city) => [city.name, ...city.aliases.split(',')].some((name) => latinName(name) === sourceKey))
  const labelCity = matched[0]
  const centerCity = labelCity ?? candidates[0]
  const center = centerCity ? [centerCity.lon, centerCity.lat] : representativePoint(f.geometry)
  const audited = AUDITED_PREFECTURES.get(f.properties.shapeID)
  assert(audited && audited.sourceName === sourceName, `Unreviewed prefecture identity: ${sourceName}`)
  const provinceName = audited.province
  const name = audited.name
  const aliases = [...new Set([sourceName, sourceName.replace(/\s+City$/i, ''), name, name.replace(/市$/u, ''),
    ...(labelCity ? [labelCity.name, ...labelCity.aliases.split(',').filter((alias) => hasChinese(alias) || /^[\p{Script=Latin}\d '\-]+$/u.test(alias)).slice(0, 20)] : [])])]
  labelAudit.push({ source: sourceName, name, province: provinceName, matchedCity: labelCity?.id ?? null, candidates: candidates.length })
  return { type: 'Feature', properties: { id: `gb:${f.properties.shapeID}`, name, province: provinceName, kind: 'prefecture', center, aliases }, geometry: f.geometry, bbox: f.bbox }
})
for (const source of rawProvinces) {
  const supplement = SPECIAL[source.properties.shapeName]
  if (!supplement) continue
  const city = gazetteer.find((row) => row.id === `geonames:${supplement.geonames}`)
  const sameYear = source.properties.shapeName.endsWith('Municipality')
    ? municipalSources.find((f) => f.properties.shapeName === source.properties.shapeName.replace(/ Municipality$/, ''))
    : null
  const geometry = source.properties.shapeName === 'Hong Kong Special Administrative Region'
    ? hongKongGeometry : sameYear?.geometry ?? source.geometry
  if (source.properties.shapeName.endsWith('Municipality')) assert(sameYear, `Missing 2017 municipality: ${supplement.name}`)
  const center = city ? [city.lon, city.lat] : representativePoint(geometry)
  regions.push({ type: 'Feature', properties: {
    id: `gb:${source.properties.shapeID}`, name: supplement.name,
    province: PROVINCE_NAMES[source.properties.shapeName],
    kind: source.properties.shapeName.endsWith('Municipality') ? 'municipality' : 'special',
    center, aliases: [source.properties.shapeName, ...supplement.aliases]
  }, geometry, bbox: bounds(geometry) })
  // The province skeleton must not reintroduce a coarse line through a city.
  const skeleton = provinces.find((f) => f.properties.id === `gb:${source.properties.shapeID}`)
  skeleton.geometry = geometry
  skeleton.bbox = bounds(geometry)
}
assert.equal(regions.length, 340)
assert(regions.every((r) => r.properties.province && hasChinese(r.properties.name)), 'All final regions need reviewed Chinese labels and provinces')
assert.equal(regions.filter((r) => r.properties.kind === 'municipality').length, 4)
assert.equal(regions.filter((r) => r.properties.kind === 'special').length, 2)
assert(regions.some((r) => r.properties.name === '莱芜市'), 'Preserve the historical 2017 Laiwu region')
for (const region of [...regions, ...provinces]) {
  const originalName = region.properties.name
  region.properties.name = toSimplifiedChinese(originalName)
  if (region.properties.province) region.properties.province = toSimplifiedChinese(region.properties.province)
  region.properties.aliases = [...new Set([originalName, ...region.properties.aliases,
    ...[originalName, ...region.properties.aliases].map(toSimplifiedChinese)])]
}

const index = { version: 1, sourceYear: '2017', geonames: {}, names: {} }
for (const region of regions) for (const name of [region.properties.name, ...region.properties.aliases]) {
  const key = normalize(name)
  if (key) (index.names[key] ??= []).push(region.properties.id)
}
for (const key of Object.keys(index.names)) index.names[key] = [...new Set(index.names[key])]
const hongKong = regions.find((r) => r.properties.name === '香港')
const macau = regions.find((r) => r.properties.name === '澳门')
for (const city of chineseCities) {
  const region = city.country === 'HK' ? hongKong : city.country === 'MO' ? macau : regions.find((r) => inside(r, city))
  if (region) index.geonames[city.id.replace(/^geonames:/, '')] = region.properties.id
}
// Explicit canonical ids also cover gazetteer points on very generalized coasts.
for (const [sourceName, supplement] of Object.entries(SPECIAL)) {
  index.geonames[supplement.geonames] = regions.find((r) => r.properties.aliases.includes(sourceName)).properties.id
}
for (const entry of CONCORDANCE) {
  const region = regions.find((r) => r.properties.province === entry.province && r.properties.aliases.includes(entry.source))
  assert(region, `Reviewed concordance missing: ${entry.name}`)
  index.geonames[entry.geonames] = region.properties.id
}
// Keep shared city edges in one topology and simplify arcs, never individual city
// polygons. A modest spherical area threshold retains small islands and cities.
const cleanFeature = (f) => ({ type: 'Feature', properties: f.properties, geometry: clockwiseGeometry(f.geometry) })
const unsimplified = topology({ cities: { type: 'FeatureCollection', features: regions.map(cleanFeature) }, provinces: { type: 'FeatureCollection', features: provinces.map(cleanFeature) } }, 1000000)
const weighted = presimplify(unsimplified, sphericalTriangleArea)
// Preserve three distinct coordinates per ring, including tiny island rings.
// Altering arc weights retains the same shared points in neighboring polygons.
for (const object of Object.values(weighted.objects)) for (const geometry of object.geometries) {
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs
  for (const rings of polygons) for (const ring of rings) {
    const points = ring.flatMap((arc) => weighted.arcs[arc < 0 ? ~arc : arc])
    const kept = new Set(points.filter((p) => p[2] === Infinity).map((p) => `${p[0]},${p[1]}`))
    for (const point of points.toSorted((a, b) => b[2] - a[2])) {
      if (kept.size >= 3) break
      const key = `${point[0]},${point[1]}`
      if (!kept.has(key)) { kept.add(key); point[2] = Infinity }
    }
    assert(kept.size >= 3, `Invalid source polygon: ${geometry.properties.name}`)
  }
}
const minWeight = 1e-10
const compact = quantize(simplify(weighted, minWeight), 1000000)
const decoded = feature(compact, compact.objects.cities).features
assert.equal(decoded.length, regions.length)
for (const f of decoded) {
  const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  assert(rings.some((polygon) => polygon[0].length >= 4 && new Set(polygon[0].map((p) => p.join(','))).size >= 3), `Collapsed boundary: ${f.properties.name}`)
  assert(geoArea(f) > 0 && geoArea(f) < Math.PI * 2, `D3 complement / winding error: ${f.properties.name}`)
  if (!geoContains(f, f.properties.center)) f.properties.center = representativePoint(f.geometry)
  assert(geoContains(f, f.properties.center), `Label anchor outside region: ${f.properties.name}`)
}
const topoBytes = Buffer.from(JSON.stringify(compact))
const indexBytes = Buffer.from(JSON.stringify(index))
assert(gzipSync(topoBytes, { level: 9 }).length + gzipSync(indexBytes, { level: 9 }).length < 5 * 1024 * 1024, 'Boundary data exceeded the 5 MiB compressed asset budget')
const shenzhenChecks = [[114.13149, 22.54721], [114.0771, 22.53589], [114.06136, 22.54033]]
const hongKongChecks = [[114.17469, 22.27832], [114.17, 22.32], [113.95, 22.25], [114.029, 22.209]]
for (const point of shenzhenChecks) assert.deepEqual(decoded.filter((f) => geoContains(f, point)).map((f) => f.properties.name), ['深圳市'], `Shenzhen must not overlap HK: ${point}`)
for (const point of hongKongChecks) assert.deepEqual(decoded.filter((f) => geoContains(f, point)).map((f) => f.properties.name), ['香港'], `Historical HK must contain its islands: ${point}`)
const provinceHongKong = feature(compact, compact.objects.provinces).features.find((f) => f.properties.name === '香港特别行政区')
for (const point of shenzhenChecks) assert(!geoContains(provinceHongKong, point), 'HK province skeleton must not cross Shenzhen')

const expected = [
  ['1808926', '杭州', '浙江省'], ['8400694', '台州', '浙江省'], ['1793505', '泰州', '江苏省'],
  ['1886760', '苏州', '江苏省'], ['1793743', '宿州', '安徽省'],
  ['1785781', '玉林', '广西壮族自治区'], ['1785777', '榆林', '陕西省'],
  ['1816670', '北京', '北京市']
]
for (const [id, name, province] of expected) {
  const region = regions.find((r) => r.properties.id === index.geonames[id])
  assert(region && region.properties.name.includes(name) && region.properties.province === province, `Canonical mapping mismatch: ${id} ${name}; actual=${JSON.stringify(region?.properties)}`)
  const geometry = decoded.find((f) => f.properties.id === region.properties.id)
  assert(geoContains(geometry, region.properties.center), `D3 point-in-polygon mismatch: ${name}`)
}
await fs.mkdir(ASSETS, { recursive: true })
await fs.writeFile(path.join(ASSETS, 'china-cities.topo.json'), topoBytes)
await fs.writeFile(path.join(ASSETS, 'china-city-index.json'), indexBytes)
const licenses = path.join(RESOURCES, 'licenses/boundary-data')
await fs.mkdir(licenses, { recursive: true })
await Promise.all([
  ['ODbL-1.0.txt', 'https://opendatacommons.org/licenses/odbl/odbl-10.txt'],
  ['CC-BY-4.0.txt', 'https://creativecommons.org/licenses/by/4.0/legalcode.txt']
].map(async ([filename, url]) => fs.writeFile(path.join(licenses, filename), await download(url))))
await fs.writeFile(path.join(licenses, 'NOTICE.txt'), `MyMap boundary database\n\nHistorical city boundaries: geoBoundaries 3.0.0, CHN ADM2, representing 2017.\nSource: OpenStreetMap, Wambacher. © OpenStreetMap contributors.\nhttps://www.geoboundaries.org/\nhttps://www.openstreetmap.org/copyright\nSource license: ODbL 1.0; this derivative boundary database remains ODbL 1.0.\n\nWhole municipalities: geoBoundaries 3.0.0 CHN ADM1, representing 2017, OpenStreetMap/Wambacher, ODbL 1.0. Hong Kong: union of the three 2017 CHN ADM2 source objects using shared source arcs. These five geometries are identical in city and province objects. Remaining provinces and the whole Macau outline: geoBoundaries fixed commit 9469f09, CHN ADM1, representing 2019; original source Wikimedia Commons / geoBoundaries, Public Domain. Macau is a lower-precision generalized reference. geoBoundaries attribution retained.\n\nChinese city names and point-to-boundary concordance: GeoNames, CC BY 4.0.\nhttps://www.geonames.org/\n\nChanges: merge the original Hong Kong Island, Kowloon and New Territories source arcs; replace the two Macau subregions with a whole-SAR reference; unite source Zanda County parts with Ngari Prefecture; add four same-year whole municipalities; 334 audited formal names and provinces, Chinese labels and GeoNames concordance; shared topology, spherical simplification and quantization. Result: 334 prefecture regions plus 4 municipalities and 2 SARs (340 total). No synthetic city boundaries. Taiwan is a province-level outline only. Historical Laiwu remains separate. An explicit Taizhou/Zhejiang identity concordance handles a gazetteer point outside the generalized historical coastline without moving the boundary.\n\nThe MIT license for MyMap's program code does not replace the above data licenses.\nReproduction and alteration method: https://github.com/Lisalsj/MyMap/blob/main/scripts/prepare-boundaries.mjs\nMachine-readable derivative data: src/renderer/assets/china-cities.topo.json and china-city-index.json in the same repository.\n`)
await fs.appendFile(path.join(licenses, 'NOTICE.txt'), '\nDisplay labels are normalized to Simplified Chinese using opencc-js (tw to cn) at build time; original Traditional Chinese names remain in aliases and the concordance index.\n')
const manifestPath = path.join(RESOURCES, 'data-manifest.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
manifest.boundary = {
  format: 'TopoJSON', version: 1, sourceYear: '2017', coordinates: 'WGS84 longitude/latitude',
  retrieved: new Date().toISOString().slice(0, 10),
  license: 'ODbL-1.0; GeoNames names/concordance CC-BY-4.0; Public Domain province supplement',
  attribution: 'geoBoundaries; © OpenStreetMap contributors; Wambacher; GeoNames',
  sources: Object.fromEntries(Object.entries(SOURCES).map(([key, source]) => [key, { ...source, sha256: hash(sourceBuffers[key]) }])),
  geoNamesSnapshot: { file: 'cities.json.gz', sha256: hash(cityBytes) },
  coverage: {
    originalFeatures: 340, unionedHongKongSubregions: [...REMOVED_HK], removedMacauSubregions: [...REMOVED_MACAU], prefectures: 334,
    wholeRegionSources: {
      hongKong: { year: '2017', source: 'prefectures', sourceObjects: [...REMOVED_HK], method: 'Merge existing shared source arcs; use identical geometry in city and province layers' },
      municipalities: { year: '2017', source: 'municipalities2017', sourceObjects: ['Beijing', 'Tianjin', 'Shanghai', 'Chongqing'], method: 'Use complete same-year ADM1 polygons in city and province layers; retain existing region ids' },
      macau: { year: '2019', source: 'provinces', limitation: 'Generalized whole-SAR outline; its precision is lower than the 2017 OSM city layer. No known city-centre overlap in the bundled GeoNames snapshot.' },
      remainingProvinceSkeleton: { year: '2019', source: 'provinces', divisionLines: 'Renderer derives province divisions from city shared arcs whose neighbors have different audited provinces' }
    },
    prefectureRestoration: { sourceObjects: ['Ngari Prefecture', 'Zanda County'], result: 'Ngari Prefecture', method: 'Aggregate the original polygon parts into one MultiPolygon feature; shared internal arcs have the same region id and are excluded from the city boundary mesh', membershipReference: NGARI_REFERENCE },
    municipalities: 4, specialAdministrativeRegions: 2, cityRegions: regions.length, provinceRegions: provinces.length,
    matchedGeoNamesPoints: Object.keys(index.geonames).length,
    taiwan: 'Province outline only; no city boundary or GeoNames-to-city mapping.',
    historicalExceptions: ['Laiwu is a separate 2017 boundary; no silent union into Jinan.', 'Provincially administered counties/cities missing from the source remain uncovered.'],
    warning: 'Historical generalized administrative reference, not current official boundaries; no synthetic filling of gaps. Macau remains a generalized 2019 whole-SAR outline.',
    reviewedConcordance: CONCORDANCE.map((entry) => ({ ...entry, reason: 'Modern gazetteer city point is outside the generalized 2017 polygon; identity confirmed by city name and province. Geometry unchanged.' }))
  },
  simplification: { method: 'Shared TopoJSON arcs; spherical triangle area; minimum three distinct points per ring', minWeightSteradians: minWeight, quantization: 1000000 },
  labelNormalization: { tool: 'opencc-js', version: JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules/opencc-js/package.json'), 'utf8')).version, from: 'tw', to: 'cn', preservesTraditionalAliases: true },
  prefectureLabels: { method: '334 audited formal names and provinces keyed by pinned source shapeID and sourceName; no first-Han or coarse-province inference', correctedLabels: 37, provinceCorrections: [{ sourceName: 'Siping City', province: '吉林省' }], historicalNamePolicy: '2017 names: Hami is 哈密市 (2016 conversion); Nagqu remains 那曲地区; Laiwu remains independent.' },
  assets: {
    topology: { file: 'src/renderer/assets/china-cities.topo.json', bytes: topoBytes.length, gzipBytes: gzipSync(topoBytes, { level: 9 }).length, sha256: hash(topoBytes) },
    index: { file: 'src/renderer/assets/china-city-index.json', bytes: indexBytes.length, gzipBytes: gzipSync(indexBytes, { level: 9 }).length, sha256: hash(indexBytes) }
  },
  reproduction: 'node scripts/prepare-boundaries.mjs'
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ regions: regions.length, mappedPoints: Object.keys(index.geonames).length, bytes: topoBytes.length + indexBytes.length, samples: expected.map(([id]) => { const r = regions.find((r) => r.properties.id === index.geonames[id]); return { geonames: id, id: r?.properties.id, name: r?.properties.name, province: r?.properties.province } }), englishLabels: labelAudit.filter((r) => !hasChinese(r.name)), missingProvinces: labelAudit.filter((r) => !r.province) }, null, 2))
