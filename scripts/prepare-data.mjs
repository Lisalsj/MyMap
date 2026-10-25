// Original vector artwork and Windows icon. Reproduce with: node scripts/prepare-data.mjs
// Artwork is fictional illustration, not photography or a claim of geographic accuracy.
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resources = path.join(root, 'resources')
const demo = path.join(resources, 'demo')
await fs.mkdir(demo, { recursive: true })

const svg = (content, color = '#efe9d4') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#f5edd9"/></linearGradient><linearGradient id="water" x2="0" y2="1"><stop stop-color="#a4b8ab"/><stop offset="1" stop-color="#d9d7bb"/></linearGradient><linearGradient id="front" x2="1" y2="1"><stop stop-color="#284d42"/><stop offset="1" stop-color="#496d50"/></linearGradient><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".055"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter><filter id="blur"><feGaussianBlur stdDeviation="20"/></filter></defs><g filter="url(#paper)"><rect width="1600" height="1100" fill="url(#sky)"/>${content}</g></svg>`
const pine = (x, y, scale, color) =>
  `<g transform="translate(${x} ${y}) scale(${scale})" fill="${color}"><path d="M-6 15H6V-240H-6Z"/><path d="M0-380 70-225 30-225 95-125 45-125 120-20H-120L-45-125H-95L-30-225H-70Z"/></g>`
const birds = `<g stroke="#5c7269" stroke-width="3" fill="none" opacity=".6"><path d="M1080 290q15-15 30 0 15-15 30 0M1140 260q10-10 20 0 10-10 20 0M1040 240q10-10 20 0 10-10 20 0"/></g>`
const hangzhou = svg(
  `<circle cx="1160" cy="245" r="94" fill="#dca36d" opacity=".7"/><path d="M0 540 150 400 340 455 590 325 780 435 970 370 1280 470 1600 350V800H0Z" fill="#b8c4af"/><path d="M0 620 240 470 430 560 660 480 920 600 1200 490 1600 550V800H0Z" fill="#8da99a"/><path d="M0 675Q440 620 820 680T1600 660V1100H0Z" fill="url(#water)"/><g stroke="#edf0db" stroke-width="3" opacity=".45"><path d="M500 775H1320M840 830H1500M400 910H940M1020 960H1580M150 855H650M900 730H1200"/></g><path d="M0 825Q230 710 440 790L560 1100H0Z" fill="url(#front)"/><path d="M0 1000Q180 950 270 1100H0Z" fill="#244939"/><g transform="translate(1180 592)" fill="#486d5c"><path d="M-20 45H20V-160H-20Z"/><path d="M-55-160Q0-185 55-160L37-148H-37Z M-50-120Q0-143 50-120L34-108H-34Z M-45-80Q0-101 45-80L31-68H-31Z M-40-40Q0-58 40-40L28-28H-28Z M-35 0Q0-18 35 0L25 12H-25Z"/><path d="M-4-205H4V-176H-4Z"/></g><g transform="translate(848 850)"><path d="M-50 0Q0 30 70 0Z" fill="#4b5d4b"/><path d="M14 0V-70" stroke="#4b5d4b" stroke-width="4"/><path d="M15-70Q65-50 61-12H15Z" fill="#f5ead2"/></g>${pine(95, 900, 1.5, '#315a49')}${pine(220, 850, 0.9, '#3d6551')}${birds}`,
  '#d7e3d8'
)
const yunnan = svg(
  `<circle cx="1150" cy="225" r="95" fill="#e4b47a"/><path d="M0 680 180 475 360 555 700 180 1040 545 1290 310 1600 610V1100H0Z" fill="#9aafa5"/><path d="M500 400 700 180 910 405 778 355 718 390 658 328 600 399Z" fill="#f2efdd"/><path d="M1117 450 1290 310 1455 479 1312 416 1270 393 1205 448Z" fill="#f2efdd"/><path d="M0 695 370 580 580 695 980 490 1260 660 1600 560V1100H0Z" fill="#769686"/><path d="M0 810Q250 680 560 790T1100 735Q1400 610 1600 750V1100H0Z" fill="#5e8066"/><path d="M0 1000Q400 770 760 870T1600 800V1100H0Z" fill="#476b51"/><path d="M800 1100Q1210 900 980 845T1120 760" fill="none" stroke="#decda5" stroke-width="30"/><path d="M300 1100Q510 985 770 1010" fill="none" stroke="#b4b789" stroke-width="14"/>${pine(110, 940, 1.05, '#294e3e')}${pine(235, 970, 0.75, '#31563f')}${pine(1490, 960, 0.95, '#31563f')}<g fill="#e0c886" opacity=".8">${Array.from({ length: 85 }, (_, i) => `<circle cx="${(i * 191 + 41) % 1600}" cy="${930 + ((i * 47) % 170)}" r="${2 + (i % 3)}"/>`).join('')}</g>${birds}`,
  '#d9dfd2'
)
const kyoto = svg(
  `<circle cx="1130" cy="245" r="97" fill="#de9e68" opacity=".8"/><path d="M0 620 210 430 480 510 740 340 1080 540 1300 410 1600 570V1100H0Z" fill="#afbb9e"/><path d="M0 740 330 550 660 710 1040 560 1600 690V1100H0Z" fill="#82977c"/><path d="M0 850Q720 650 1600 830V1100H0Z" fill="#d5c7a0"/><path d="M590 1100 920 800H1000L900 1100Z" fill="#eee3c5"/><g transform="translate(1080 750)"><path d="M-230-245H230L210-220H-210Z" fill="#8b472f"/><path d="M-270-270Q0-230 270-270L240-240Q0-210-240-240Z" fill="#405a44"/><path d="M-190-220H-162V140H-190ZM162-220H190V140H162Z" fill="#a95435"/><path d="M-212-100H212V-77H-212Z" fill="#a95435"/><path d="M-10-230H10V-90H-10Z" fill="#a95435"/></g><g fill="#b2633f"><path d="M-20 640Q90 390 220 510 320 420 380 530 490 470 580 620L520 770 10 790Z"/><path d="M1300 0H1600V720Q1460 610 1320 620 1420 460 1270 350 1400 250 1300 0Z"/></g><g stroke="#4c583c" stroke-width="22" fill="none"><path d="M70 1100 160 640 240 570M160 700 350 610M1560 1000 1450 450 1500 200M1450 450 1330 340"/></g><g fill="#d29350">${Array.from({ length: 100 }, (_, i) => `<ellipse cx="${(i * 173) % 640}" cy="${500 + ((i * 37) % 260)}" rx="16" ry="7" transform="rotate(${i * 17})"/>`).join('')}</g>${birds}`,
  '#eadfc5'
)
const westlake = svg(
  `<circle cx="380" cy="245" r="85" fill="#e4b784" opacity=".8"/><path d="M0 620 260 430 490 530 730 350 1000 480 1210 390 1600 580V850H0Z" fill="#bec7b4"/><path d="M0 730 350 570 700 680 1020 540 1300 660 1600 570V1100H0Z" fill="#93ab98"/><path d="M0 760Q750 690 1600 750V1100H0Z" fill="url(#water)"/><path d="M0 960Q300 800 600 880T1100 890Q1390 790 1600 880V1100H0Z" fill="#506f54"/><path d="M1000 990Q1220 780 1600 880V925Q1230 830 1070 1000Z" fill="#b5ae88"/><g transform="translate(1260 790)"><path d="M-60-15V75H-48V-15M48-15V75H60V-15" fill="#6d684e"/><path d="M-100-20Q0-80 100-20L82-5H-82Z" fill="#4b6550"/><path d="M-70 0H70V10H-70Z" fill="#827857"/></g><g stroke="#eef0d9" stroke-width="3" opacity=".45"><path d="M100 820H740M620 790H1130M210 875H580M850 843H1180"/></g>${pine(130, 1020, 1.25, '#31583f')}${pine(250, 1020, 0.75, '#45694e')}${birds}`,
  '#d9e2d5'
)
for (const [name, source] of [
  ['hangzhou-west-lake', hangzhou],
  ['yunnan-mountain-trail', yunnan],
  ['kyoto-autumn-walk', kyoto],
  ['hangzhou-lakeside-morning', westlake]
]) {
  await fs.writeFile(path.join(demo, `${name}.svg`), source)
  await sharp(Buffer.from(source))
    .jpeg({ quality: 91, mozjpeg: true })
    .toFile(path.join(demo, `${name}.jpg`))
}
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect x="12" y="12" width="488" height="488" rx="116" fill="#2e5945"/><path d="M71 374 188 230 266 307 342 214 442 374Z" fill="#b8c9a3"/><path d="m142 286 46-56 78 77-65-33-20 20Z" fill="#f3ecd7"/><circle cx="355" cy="143" r="44" fill="#e5a56b"/><path d="M258 103c-62 0-111 47-111 107 0 81 111 176 111 176s110-95 110-176c0-60-49-107-110-107Z" fill="#fff4da"/><path d="M258 136c-43 0-78 33-78 75 0 53 78 129 78 129s77-76 77-129c0-42-35-75-77-75Z" fill="#d38959"/><circle cx="258" cy="209" r="39" fill="#fff4da"/><path d="M139 418q117 34 234-5" fill="none" stroke="#f6edcf" stroke-width="13" stroke-linecap="round" stroke-dasharray="14 24"/></svg>`
await fs.writeFile(path.join(resources, 'icon.svg'), icon)
await sharp(Buffer.from(icon)).png().toFile(path.join(resources, 'icon.png'))
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(
  sizes.map((size) => sharp(Buffer.from(icon)).resize(size, size).png().toBuffer())
)
const header = Buffer.alloc(6 + images.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((image, i) => {
  const at = 6 + i * 16
  header[at] = sizes[i] === 256 ? 0 : sizes[i]
  header[at + 1] = header[at]
  header.writeUInt16LE(1, at + 4)
  header.writeUInt16LE(32, at + 6)
  header.writeUInt32LE(image.length, at + 8)
  header.writeUInt32LE(offset, at + 12)
  offset += image.length
})
await fs.writeFile(path.join(resources, 'icon.ico'), Buffer.concat([header, ...images]))
console.log('Generated 4 original landscape illustrations and a 7-resolution Windows icon.')
