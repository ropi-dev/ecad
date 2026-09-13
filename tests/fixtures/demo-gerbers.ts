/** A deterministic example built from Gerber source, using the same import path as user files. */
export const demoName = 'Atlas sensor board'

export const demoPalette: Record<string, string> = {
  'atlas-F_Cu.gbr': '#e77967',
  'atlas-B_Cu.gbr': '#658fe3',
  'atlas-F_Mask.gbr': '#6aa991',
  'atlas-F_Silkscreen.gbr': '#d9e4e4',
  'atlas-Edge_Cuts.gbr': '#899ba4',
  'atlas-Components_Top.gbr': '#d5ac63',
}

type Point = readonly [number, number]
type Pad = { position: Point; aperture: number; reference: string; pin: string }
type Component = {
  reference: string
  value: string
  footprint: string
  position: Point
  width: number
  height: number
  rotation?: number
}

const coordinate = (value: number) => String(Math.round(value * 1_000_000))
const xy = ([x, y]: Point) => `X${coordinate(x)}Y${coordinate(y)}`

class Gerber {
  private readonly commands: string[]

  constructor(fileFunction: string, mask = false) {
    const clearance = mask ? 0.12 : 0
    const rectangle = (width: number, height: number) =>
      `R,${width + clearance}X${height + clearance}`
    this.commands = [
      'G04 Atlas sensor board - illustrative PCB; not for fabrication*',
      '%TF.GenerationSoftware,ECAD,Atlas demo,1.0*%',
      `%TF.FileFunction,${fileFunction}*%`,
      `%TF.FilePolarity,${mask ? 'Negative' : 'Positive'}*%`,
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%LPD*%',
      '%ADD10C,0.18*%',
      '%ADD11C,0.28*%',
      '%ADD12C,0.48*%',
      `%ADD13${rectangle(1.65, 0.38)}*%`,
      `%ADD14${rectangle(0.38, 1.65)}*%`,
      `%ADD15${rectangle(1.15, 1.15)}*%`,
      `%ADD16C,${1.85 + clearance}X0.95*%`,
      `%ADD17C,${0.82 + clearance}X0.36*%`,
      `%ADD18${rectangle(1.55, 0.55)}*%`,
      `%ADD19${rectangle(1.1, 1.8)}*%`,
      `%ADD20C,${5.2 + clearance}X3.2*%`,
      '%ADD21C,0.12*%',
      '%ADD22C,0.65*%',
      '%ADD23R,1.85X1.85X0.95*%',
      'G01*',
    ]
  }

  add(command: string) {
    this.commands.push(command)
    return this
  }

  path(points: readonly Point[], aperture = 10) {
    this.commands.push(`D${aperture}*`, 'G01*')
    points.forEach((point, index) => this.commands.push(`${xy(point)}D0${index ? 1 : 2}*`))
    return this
  }

  flash(point: Point, aperture: number) {
    this.commands.push(`D${aperture}*`, `${xy(point)}D03*`)
    return this
  }

  rectangle(x: number, y: number, width: number, height: number, aperture = 21) {
    return this.path([[x, y], [x + width, y], [x + width, y + height], [x, y + height], [x, y]], aperture)
  }

  region(points: readonly Point[]) {
    this.add('G36*').path([...points, points[0]])
    return this.add('G37*')
  }

  finish() {
    return [...this.commands, '%TD*%', 'M02*'].join('\n')
  }
}

const components: Component[] = [
  { reference: 'U1', value: 'STM32F405', footprint: 'LQFP-48', position: [32, 24], width: 8.8, height: 8.8 },
  { reference: 'J1', value: 'USB-C', footprint: 'USB-C-16P', position: [5, 24], width: 7.8, height: 10 },
  { reference: 'J2', value: 'GPIO', footprint: 'PinHeader_2x09_P2.54mm', position: [56.27, 23.16], width: 5, height: 23 },
  { reference: 'U2', value: 'AP2112K-3.3', footprint: 'SOIC-8', position: [15, 10.8], width: 4.2, height: 5 },
  { reference: 'U3', value: 'BME280', footprint: 'LGA-8', position: [44.5, 12], width: 3.8, height: 4.4 },
  { reference: 'Y1', value: '8MHz', footprint: 'Crystal_3225', position: [20.5, 24], width: 3.2, height: 2.5 },
  { reference: 'D1', value: 'STATUS', footprint: 'LED_0805', position: [46, 36], width: 2, height: 1.2 },
]

for (let index = 0; index < 8; index++) {
  components.push({ reference: `R${index + 1}`, value: index < 2 ? '5.1k' : '10k', footprint: 'R_0603', position: [15.5 + index * 3.65, 33.5], width: 1.6, height: 0.8 })
}
for (let index = 0; index < 6; index++) {
  components.push({ reference: `C${index + 1}`, value: '100nF', footprint: 'C_0603', position: [23 + index * 3.75, 10.5], width: 1.6, height: 0.8 })
}
for (let index = 0; index < 4; index++) {
  components.push({ reference: `C${index + 7}`, value: index % 2 ? '10uF' : '100nF', footprint: 'C_0603', position: [45.5, 19 + index * 3.4], width: 1.6, height: 0.8 })
}
for (let index = 0; index < 3; index++) {
  components.push({ reference: `R${index + 9}`, value: '22', footprint: 'R_0603', position: [15.5, 20.5 + index * 3], width: 1.6, height: 0.8 })
}

const pads: Pad[] = []
const pad = (position: Point, aperture: number, reference: string, pin: number) =>
  pads.push({ position, aperture, reference, pin: String(pin) })
for (let index = 0; index < 12; index++) {
  const offset = -3.575 + index * 0.65
  pad([26.7, 24 + offset], 13, 'U1', index + 1)
  pad([32 + offset, 18.7], 14, 'U1', index + 13)
  pad([37.3, 24 - offset], 13, 'U1', index + 25)
  pad([32 - offset, 29.3], 14, 'U1', index + 37)
}
for (let index = 0; index < 6; index++) pad([9, 22 + index * 0.8], 18, 'J1', index + 1)
for (const x of [2.8, 6.8]) {
  pad([x, 18.4], 19, 'J1', 0)
  pad([x, 29.6], 19, 'J1', 0)
}
for (let index = 0; index < 9; index++) {
  pad([55, 13 + index * 2.54], index ? 16 : 23, 'J2', index * 2 + 1)
  pad([57.54, 13 + index * 2.54], 16, 'J2', index * 2 + 2)
}
for (const component of components.filter(({ reference }) => /^[RCYD]/.test(reference))) {
  const [x, y] = component.position
  const offset = component.reference === 'Y1' ? 2 : 1.2
  pad([x - offset, y], 15, component.reference, 1)
  pad([x + offset, y], 15, component.reference, 2)
}
for (const reference of ['U2', 'U3']) {
  const component = components.find((item) => item.reference === reference)!
  const [x, y] = component.position
  for (let index = 0; index < 4; index++) {
    pad([x - 2.6, y - 1.905 + index * 1.27], 18, reference, index + 1)
    pad([x + 2.6, y + 1.905 - index * 1.27], 18, reference, index + 5)
  }
}

const mountingHoles: Point[] = [[4, 4], [60, 4], [4, 40], [60, 40]]
const vias: Point[] = []
const top = new Gerber('Copper,L1,Top')
const bottom = new Gerber('Copper,L2,Bot')

// Routed fan-outs use explicit net attributes so the inspector has useful data.
for (let index = 0; index < 12; index++) {
  const offset = -3.575 + index * 0.65
  const leftY = 24 + offset
  const leftX = 23.5 - (index % 4) * 0.75
  const leftEndY = leftY + (index < 6 ? -1 : 1) * (2.8 + (index % 3) * 0.7)
  top.add(`%TO.N,MCU_L${index + 1}*%`)
    .path([[26.7, leftY], [leftX + 1.3, leftY], [leftX, leftY + (index < 6 ? -1.3 : 1.3)], [leftX, leftEndY]])
  vias.push([leftX, leftEndY])

  const rightY = 24 - offset
  const rightX = 39.9 + (index % 4) * 0.64
  top.add(`%TO.N,GPIO_${index + 1}*%`)
    .path([[37.3, rightY], [rightX - 0.6, rightY], [rightX, rightY + 0.6], [rightX, rightY + 1.8]])
  vias.push([rightX, rightY + 1.8])

  const upperX = 32 - offset
  const upperY = 31 + (index % 3) * 0.48
  top.add(`%TO.N,MCU_T${index + 1}*%`)
    .path([[upperX, 29.3], [upperX, upperY], [upperX + 1.3, upperY + 1.3], [upperX + 1.3, 35.3 + (index % 2) * 0.85]])
  vias.push([upperX + 1.3, 35.3 + (index % 2) * 0.85])

  const lowerX = 32 + offset
  const lowerY = 16.5 - (index % 3) * 0.52
  top.add(`%TO.N,MCU_B${index + 1}*%`)
    .path([[lowerX, 18.7], [lowerX, lowerY], [lowerX - 1.3, lowerY - 1.3], [lowerX - 1.3, 12.6 - (index % 2) * 0.9]])
  vias.push([lowerX - 1.3, 12.6 - (index % 2) * 0.9])
}

// USB data pair, supply routing, and local decoupling.
top.add('%TO.N,USB_DN*%').path([[9, 24.4], [11, 24.4], [12.05, 23.35], [14.3, 23.35]], 10)
top.add('%TO.N,USB_DP*%').path([[9, 25.2], [11.3, 25.2], [12.65, 23.85], [14.3, 23.85]], 10)
top.add('%TO.N,VBUS*%').path([[9, 22], [10.8, 22], [10.8, 14.1], [12.4, 12.5], [12.4, 11.435]], 12)
top.add('%TO.N,+3V3*%').path([[17.6, 11.435], [19.5, 11.435], [19.5, 7.5], [48, 7.5], [50, 9.5], [50, 36], [48, 38], [13, 38], [11, 36], [11, 30.5]], 12)
top.add('%TO.N,STATUS*%').path([[47.2, 36], [49, 36], [49, 32.62], [52, 29.62], [55, 29.62]], 11)

for (const component of components.filter(({ reference }) => /^[RC]/.test(reference))) {
  const [x, y] = component.position
  top.add(`%TO.N,${component.reference}_1*%`).path([[x - 1.2, y], [x - 1.2, y - 1.55], [x - 1.85, y - 2.2]], 10)
  top.add('%TO.N,GND*%').path([[x + 1.2, y], [x + 1.2, y + 1.6]], 11)
  vias.push([x - 1.85, y - 2.2], [x + 1.2, y + 1.6])
}

for (let index = 0; index < 9; index++) {
  const y = 13 + index * 2.54
  const routeX = 48.2 + index * 0.42
  const targetY = 18 + index * 1.25
  bottom.add(`%TO.N,GPIO_${index + 1}*%`).path([[55, y], [routeX + 1, y], [routeX, y + 1], [routeX, targetY], [routeX - 1.2, targetY + 1.2], [40 + (index % 4) * 0.64, targetY + 1.2]], 11)
  bottom.add(`%TO.N,EXT_${index + 1}*%`).path([[57.54, y], [58.9, y], [59.6, y + 0.7], [59.6, 35.8 + index * 0.32], [57.1, 38.3 + index * 0.32], [42 + index * 0.7, 38.3 + index * 0.32]], 10)
}
for (let index = 0; index < 12; index++) {
  const start = vias[index * 4]
  const y = 14.8 - index * 0.36
  bottom.add(`%TO.N,MCU_L${index + 1}*%`).path([start, [start[0] - 1.1, start[1] - 1.1], [start[0] - 1.1, y + 1.5], [start[0] + 0.4, y], [37 + index * 0.55, y]], 10)
}
bottom.add('%TO.N,GND*%').region([[7.3, 5.8], [49, 5.8], [51.2, 8], [51.2, 9], [20, 9], [18.5, 7.5], [7.3, 7.5]])
bottom.path([[8, 34.5], [8, 11], [10, 9], [17.5, 9]], 12)

for (const copper of [top, bottom]) {
  copper.add('%TD*%')
  for (const point of vias) copper.flash(point, 17)
  for (const point of mountingHoles) copper.flash(point, 20)
  for (const { position, aperture, reference, pin } of pads) {
    if (copper === bottom && reference !== 'J2') continue
    copper.add(`%TO.P,${reference},${pin}*%`).flash(position, aperture).add('%TD*%')
  }
}

const mask = new Gerber('Soldermask,Top', true)
for (const { position, aperture } of pads) mask.flash(position, aperture)
for (const point of mountingHoles) mask.flash(point, 20)

// Single-stroke lettering stays actual Gerber geometry at every zoom level.
const glyphs: Record<string, string> = {
  A: '00 03 26 43 40|03 43', B: '00 06 36 45 44 33 03|33 42 41 30 00',
  C: '46 16 05 01 10 40', D: '00 06 26 45 41 20 00', E: '46 06 00 40|03 33',
  F: '00 06 46|03 33', G: '46 16 05 01 10 40 43 23', H: '00 06|40 46|03 43',
  I: '06 46|26 20|00 40', J: '46 41 30 10 01', K: '00 06|46 03 40',
  L: '06 00 40', M: '00 06 23 46 40', N: '00 06 40 46', O: '10 01 05 16 36 45 41 30 10',
  P: '00 06 36 45 44 33 03', Q: '10 01 05 16 36 45 41 30 10|22 40',
  R: '00 06 36 45 44 33 03|23 40', S: '46 16 05 04 13 33 42 41 30 00',
  T: '06 46|26 20', U: '06 01 10 30 41 46', V: '06 20 46', W: '06 10 23 30 46',
  X: '06 40|00 46', Y: '06 23 46|23 20', Z: '06 46 00 40',
  '0': '10 01 05 16 36 45 41 30 10|01 45', '1': '14 26 20|10 30',
  '2': '05 16 36 45 44 00 40', '3': '06 36 45 34 23|34 42 41 30 00',
  '4': '36 03 43|36 30', '5': '46 06 03 33 42 41 30 00',
  '6': '36 16 05 01 10 30 41 42 33 03', '7': '06 46 10',
  '8': '10 01 02 13 33 44 45 36 16 05 04 13|33 42 41 30 10',
  '9': '43 13 04 05 16 36 45 41 30 10', '.': '00 01', '-': '03 43', '+': '03 43|21 25',
}
function text(gerber: Gerber, label: string, x: number, y: number, height = 1.1) {
  for (let index = 0; index < label.length; index++) {
    const glyph = glyphs[label[index]]
    if (!glyph) continue
    for (const stroke of glyph.split('|')) {
      gerber.path(stroke.split(' ').map((point): Point => [
        x + index * height * 0.92 + Number(point[0]) * height / 6,
        y + Number(point[1]) * height / 6,
      ]), 21)
    }
  }
}

const silk = new Gerber('Legend,Top')
for (const component of components) {
  const [x, y] = component.position
  silk.rectangle(x - component.width / 2, y - component.height / 2, component.width, component.height)
  if (!['U1', 'J1', 'J2'].includes(component.reference)) {
    text(silk, component.reference, x - 0.8, y + component.height / 2 + 0.5, 0.75)
  }
}
silk.flash([28.6, 20.6], 10)
text(silk, 'ATLAS', 10, 39.2, 2)
text(silk, 'SENSOR HUB', 28, 39.8, 1.1)
text(silk, 'REV 1.2', 8.2, 3.1, 1)
text(silk, 'OPEN HARDWARE', 31, 3.1, 0.9)
text(silk, 'U1', 30.9, 25.1, 1)
text(silk, 'STM32', 29.25, 22.3, 0.95)
text(silk, 'USB-C', 2.7, 23.7, 0.8)
text(silk, 'GPIO', 54.2, 36.8, 1)
text(silk, '3V3', 52, 9.3, 0.8)
text(silk, 'GND', 56.2, 9.3, 0.8)
text(silk, 'SENSOR', 41.4, 6, 0.85)
silk.path([[8.8, 37.4], [47.7, 37.4]], 21)
silk.path([[52, 11], [60, 11], [60, 35.5], [52, 35.5], [52, 11]], 21)

const outline = new Gerber('Profile,NP')
outline.add('%TA.AperFunction,Profile*%').add('%ADD24C,0.14*%').add('%TD*%')
outline.path([[2, 0], [62, 0]], 24)
  .add('G75*').add(`G03${xy([64, 2])}I0J2000000D01*`)
  .add(`G01${xy([64, 42])}D01*`).add(`G03${xy([62, 44])}I-2000000J0D01*`)
  .add(`G01${xy([2, 44])}D01*`).add(`G03${xy([0, 42])}I0J-2000000D01*`)
  .add(`G01${xy([0, 2])}D01*`).add(`G03${xy([2, 0])}I2000000J0D01*`)

const assembly = new Gerber('Component,L1,Top')
assembly.add('%TA.AperFunction,ComponentMain*%').add('%ADD30C,0.45*%').add('%TD*%')
assembly.add('%TA.AperFunction,ComponentOutline,Body*%').add('%ADD31C,0.1*%').add('%TD*%')
assembly.add('%TA.AperFunction,ComponentPin*%').add('%ADD32C,0.25*%').add('%TD*%')
for (const component of components) {
  const [x, y] = component.position
  assembly.add(`%TO.C,${component.reference}*%`)
    .add(`%TO.CVal,${component.value}*%`)
    .add(`%TO.CFtp,${component.footprint}*%`)
    .add(`%TO.CRot,${component.rotation ?? 0}*%`)
    .add('%TO.CMnt,SMD*%')
    .flash(component.position, 30)
    .rectangle(x - component.width / 2, y - component.height / 2, component.width, component.height, 31)
    .add('%TD*%')
  for (const pin of pads.filter((item) => item.reference === component.reference)) {
    assembly.add(`%TO.C,${component.reference}*%`).add(`%TO.P,${component.reference},${pin.pin}*%`)
      .flash(pin.position, 32).add('%TD*%')
  }
}

export const demoFiles: { name: string; source: string }[] = [
  { name: 'atlas-F_Cu.gbr', source: top.finish() },
  { name: 'atlas-B_Cu.gbr', source: bottom.finish() },
  { name: 'atlas-F_Mask.gbr', source: mask.finish() },
  { name: 'atlas-F_Silkscreen.gbr', source: silk.finish() },
  { name: 'atlas-Edge_Cuts.gbr', source: outline.finish() },
  { name: 'atlas-Components_Top.gbr', source: assembly.finish() },
]
