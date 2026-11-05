import type { SourceShape, SourceSymbol } from "./types.ts";

type PinTable = Readonly<Record<string, string>>;

const nrf54lQfn40: PinTable = {
	1: "P1.00/XL1",
	2: "P1.01/XL2",
	3: "P1.02/NFC1",
	4: "P1.03/NFC2",
	5: "P1.04/AIN0",
	6: "P1.05/AIN1",
	7: "P1.06/AIN2",
	8: "P1.08/EXTREF",
	9: "VDD",
	10: "P2.00",
	11: "P2.01",
	12: "P2.02",
	13: "P2.03",
	14: "P2.04",
	15: "P2.05",
	16: "P2.06",
	17: "P2.07",
	18: "P2.08",
	19: "VDD",
	20: "P0.00",
	21: "P0.01",
	22: "SWDIO",
	23: "SWDCLK",
	24: "P0.04",
	25: "nRESET",
	26: "ANT",
	27: "VSS_PA",
	28: "DECRF",
	29: "XC1",
	30: "XC2",
	31: "VDD",
	32: "P1.11/AIN4",
	33: "P1.12/AIN5",
	34: "P1.13/AIN6",
	35: "P1.14/AIN7",
	36: "DECA",
	37: "VSS",
	38: "DECD",
	39: "DCC",
	40: "VDD",
	41: "VSS",
};

const nrf54lQfn48: PinTable = {
	1: "P1.00/XL1",
	2: "P1.01/XL2",
	3: "P1.02/NFC1",
	4: "P1.03/NFC2",
	5: "P1.04/AIN0",
	6: "P1.05/AIN1",
	7: "P1.06/AIN2",
	8: "P1.07/AIN3",
	9: "P1.08/EXTREF",
	10: "VDD",
	11: "P2.00",
	12: "P2.01",
	13: "P2.02",
	14: "P2.03",
	15: "P2.04",
	16: "P2.05",
	17: "P2.06",
	18: "P2.07",
	19: "P2.08",
	20: "P2.09",
	21: "P2.10",
	22: "VDD",
	23: "P0.00",
	24: "P0.01",
	25: "SWDIO",
	26: "SWDCLK",
	27: "P0.02",
	28: "P0.03",
	29: "P0.04",
	30: "nRESET",
	31: "ANT",
	32: "VSS_PA",
	33: "DECRF",
	34: "XC1",
	35: "XC2",
	36: "VDD",
	37: "P1.09",
	38: "P1.10",
	39: "P1.11/AIN4",
	40: "P1.12/AIN5",
	41: "P1.13/AIN6",
	42: "P1.14/AIN7",
	43: "DECA",
	44: "VSS",
	45: "DECD",
	46: "DCC",
	47: "VDD",
	48: "VDD",
	49: "VSS",
};

const nrf54lQfn52: PinTable = {
	1: "P1.00/XL1",
	2: "P1.01/XL2",
	3: "P1.02/NFC1",
	4: "P1.03/NFC2",
	5: "P1.04/AIN0",
	6: "P1.16",
	7: "P1.05/AIN1",
	8: "P1.06/AIN2",
	9: "P1.07/AIN3",
	10: "P1.08/EXTREF",
	11: "VDD",
	12: "P2.00",
	13: "P2.01",
	14: "P2.02",
	15: "P2.03",
	16: "P2.04",
	17: "P2.05",
	18: "P2.06",
	19: "P2.07",
	20: "P2.08",
	21: "P2.09",
	22: "P2.10",
	23: "VDD",
	24: "P0.06",
	25: "P0.00",
	26: "P0.01",
	27: "SWDIO",
	28: "SWDCLK",
	29: "P0.02",
	30: "P0.03",
	31: "P0.04",
	32: "P0.05",
	33: "nRESET",
	34: "ANT",
	35: "VSS_PA",
	36: "DECRF",
	37: "XC1",
	38: "XC2",
	39: "VDD",
	40: "P1.09",
	41: "P1.10",
	42: "P1.11/AIN4",
	43: "P1.12/AIN5",
	44: "P1.13/AIN6",
	45: "P1.14/AIN7",
	46: "P1.15",
	47: "DECA",
	48: "VSS",
	49: "DECD",
	50: "DCC",
	51: "VDD",
	52: "VDD",
	53: "VSS",
};

const nrf54lCsp47: PinTable = {
	A1: "XC1",
	A2: "XC2",
	A3: "P1.12/AIN5",
	A4: "DECA",
	A5: "DECD",
	A6: "VSS",
	A7: "DCC",
	B1: "DECRF",
	B3: "P1.09",
	B4: "P1.13/AIN6",
	B5: "P1.14/AIN7",
	B6: "P1.15",
	B7: "VDD",
	C2: "VSS_PA",
	C3: "P1.10",
	C4: "P1.11/AIN4",
	C5: "P1.00/XL1",
	C6: "P1.01/XL2",
	C7: "P1.02/NFC1",
	D1: "ANT",
	D2: "nRESET",
	D3: "P0.04",
	D4: "P2.08",
	D5: "P1.03/NFC2",
	D6: "P1.04/AIN0",
	D7: "P1.06/AIN2",
	E1: "P0.03",
	E2: "P0.02",
	E3: "SWDCLK",
	E4: "P2.07",
	E5: "P2.03",
	E6: "P1.05/AIN1",
	E7: "P1.07/AIN3",
	F1: "P0.01",
	F2: "SWDIO",
	F3: "P2.09",
	F4: "P2.06",
	F5: "P2.04",
	F6: "P2.02",
	F7: "P1.08/EXTREF",
	G1: "P0.00",
	G2: "P2.10",
	G3: "VDD",
	G4: "VSS",
	G5: "P2.05",
	G6: "P2.00",
	G7: "P2.01",
};

const npm2100Qfn16: PinTable = {
	1: "VSET",
	2: "SW",
	3: "VBAT",
	4: "SHPHLD",
	5: "GPIO0",
	6: "SDA",
	7: "SCL",
	8: "SYSGDEN",
	9: "GPIO1",
	10: "PG/RESET",
	11: "AVSS2",
	12: "LSOUT/VOUTLDO",
	13: "VOUT",
	14: "VINT",
	15: "VINT",
	16: "PVSS",
	17: "AVSS1",
};

const npm2100Csp16: PinTable = {
	A1: "LSOUT/VOUTLDO",
	A2: "VOUT",
	A3: "VINT",
	A4: "PVSS",
	B1: "AVSS1",
	B2: "AVSS2",
	B3: "VSET",
	B4: "SW",
	C1: "PG/RESET",
	C2: "SYSGDEN",
	C3: "GPIO0",
	C4: "VBAT",
	D1: "GPIO1",
	D2: "SCL",
	D3: "SDA",
	D4: "SHPHLD",
};

const nrf54lLeft = [
	"VDD",
	"DCC",
	"DECD",
	"DECA",
	"DECRF",
	"XC1",
	"XC2",
	"ANT",
	"nRESET",
	"SWDIO",
	"SWDCLK",
	"VSS_PA",
	"VSS",
];
const npm2100Left = [
	"VBAT",
	"SW",
	"VSET",
	"SHPHLD",
	"SYSGDEN",
	"AVSS1",
	"AVSS2",
	"PVSS",
];
const npm2100Right = [
	"VOUT",
	"LSOUT/VOUTLDO",
	"VINT",
	"PG/RESET",
	"GPIO0",
	"GPIO1",
	"SDA",
	"SCL",
];

const padOrder = (number: string) => {
	const [, row = "", column] = number.match(/^([A-Z]*)(\d+)$/) ?? [];
	return [row, Number(column)] as const;
};
const byPad = (
	[a]: readonly [string, string],
	[b]: readonly [string, string],
) => {
	const [rowA, columnA] = padOrder(a);
	const [rowB, columnB] = padOrder(b);
	return rowA.localeCompare(rowB) || columnA - columnB;
};

function chip(
	pins: PinTable,
	left: readonly string[],
	right: (name: string) => number,
	halfWidth: number,
): SourceShape[] {
	const entries = Object.entries(pins).sort(byPad);
	const leftPins = left.flatMap((name) =>
		entries.filter((entry) => entry[1] === name),
	);
	const rightPins = entries
		.filter((entry) => !left.includes(entry[1]))
		.sort((a, b) => right(a[1]) - right(b[1]) || byPad(a, b));
	const top = 50 * (Math.max(leftPins.length, rightPins.length) - 1);
	const column = (
		side: (readonly [string, string])[],
		x: number,
		direction: "L" | "R",
	): SourceShape[] =>
		side.map(([number, name], row) => [
			"pin",
			name,
			x,
			top - 100 * row,
			100,
			direction,
			number,
		]);
	return [
		["rectangle", -halfWidth, top + 100, halfWidth, -top - 100],
		...column(leftPins, -halfWidth - 100, "R"),
		...column(rightPins, halfWidth + 100, "L"),
	];
}

const gpioOrder = (name: string) => {
	const [, port, pin] = name.match(/^P(\d)\.(\d\d)/) ?? [];
	return Number(port) * 100 + Number(pin);
};

const nrf54l = (
	part: string,
	memory: string,
	code: string,
	pins: PinTable,
	gpios: number,
	pkg: string,
): SourceSymbol => ({
	id: `${part}-${code}`.toLowerCase(),
	category: "Microcontrollers",
	name: `${part}-${code}`,
	description: `Nordic Bluetooth LE and multiprotocol SoC, 128 MHz Cortex-M33, ${memory}, ${gpios} GPIO, ${pkg}`,
	prefix: "U",
	value: `${part}-${code}`,
	source: `Nordic nRF54L15, nRF54L10, and nRF54L05 datasheet v1.0, ${code} package pin assignments`,
	rotation: 0,
	filled: true,
	drawing: chip(pins, nrf54lLeft, gpioOrder, 600),
});

const nrf54lPackages = [
	["QDAA", nrf54lQfn40, 24, "QFN-40 with exposed ground pad"],
	["QFAA", nrf54lQfn48, 31, "QFN-48 with exposed ground pad"],
	["QGAA", nrf54lQfn52, 35, "QFN-52 with exposed ground pad"],
] as const;

export const nordicMicrocontrollers: readonly SourceSymbol[] = [
	...(
		[
			["nRF54L15", "1.5 MB NVM, 256 KB RAM"],
			["nRF54L10", "1 MB NVM, 192 KB RAM"],
			["nRF54L05", "0.5 MB NVM, 96 KB RAM"],
		] as const
	).flatMap(([part, memory]) =>
		nrf54lPackages.map(([code, pins, gpios, pkg]) =>
			nrf54l(part, memory, code, pins, gpios, pkg),
		),
	),
	nrf54l(
		"nRF54L15",
		"1.5 MB NVM, 256 KB RAM",
		"CAAA",
		nrf54lCsp47,
		32,
		"47-ball wafer-level CSP",
	),
];

const npm2100 = (code: string, pins: PinTable, pkg: string): SourceSymbol => ({
	id: `npm2100-${code}`.toLowerCase(),
	category: "Power",
	name: `nPM2100-${code}`,
	description: `Nordic primary-cell PMIC with boost regulator, load switch or LDO, fuel gauge and TWI, ${pkg}`,
	prefix: "U",
	value: `nPM2100-${code}`,
	source: `Nordic nPM2100 datasheet v1.0, ${code} pin assignment`,
	rotation: 0,
	filled: true,
	drawing: chip(pins, npm2100Left, (name) => npm2100Right.indexOf(name), 500),
});

export const nordicPowerManagement: readonly SourceSymbol[] = [
	npm2100("QEAA", npm2100Qfn16, "QFN-16 with exposed ground pad"),
	npm2100("CAAA", npm2100Csp16, "16-ball wafer-level CSP"),
];
