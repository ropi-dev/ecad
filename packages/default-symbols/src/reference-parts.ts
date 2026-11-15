// Adapted from the KiCad symbol libraries, commit 4e17d7595f9691d45d97aea8ad64572652fb5bed.
// Copyright KiCad library contributors. See ../LICENSE.md and ../NOTICE.md.
// Coordinates are in mils.
import type { SourceShape, SourceSymbol } from "./types.ts";

function connector(pins: number): SourceSymbol {
	const top = Math.floor((pins - 1) / 2) * 100;
	const drawing: SourceShape[] = [
		["rectangle", -50, top + 50, 50, top - pins * 100 + 50],
	];
	for (let pin = 1; pin <= pins; pin++) {
		const y = top - (pin - 1) * 100;
		drawing.push(["rectangle", -50, y + 5, 0, y - 5]);
		drawing.push(["pin", `Pin_${pin}`, -200, y, 150, "R"]);
	}
	return {
		id: `connector-${pins}`,
		category: "Connectors",
		name: `${pins}-pin connector`,
		description: `Single-row ${pins}-pin connector`,
		prefix: "J",
		value: `${pins} pins`,
		footprint: `pinheader_1x${String(pins).padStart(2, "0")}_p2.54mm_vertical`,
		source: `Connector_Generic:Conn_01x${String(pins).padStart(2, "0")}`,
		rotation: 0,
		drawing,
	};
}

export const referenceSymbols: readonly SourceSymbol[] = [
	{
		id: "crystal-gnd24",
		category: "Passives",
		packaging: {
			part: "Crystal, 4 pins",
			name: "3225",
			description: "3.2 x 2.5 mm, ground on pins 2 and 4",
		},
		name: "Crystal, 4 pins",
		description:
			"Four-pin quartz resonator with case ground on pins 2 and 4, such as the ABM8 3.2 x 2.5 mm package",
		prefix: "Y",
		value: "12M",
		footprint: "crystal_smd_3225-4pin_3.2x2.5mm",
		source: "Device:Crystal_GND24",
		rotation: 0,
		showPinLabels: false,
		drawing: [
			["rectangle", -45, 100, 45, -100],
			["polyline", [-100, 0], [-75, 0]],
			["polyline", [-75, -50], [-75, 50]],
			["polyline", [75, -50], [75, 50]],
			["polyline", [100, 0], [75, 0]],
			["polyline", [-100, -150], [100, -150], [100, -100]],
			["polyline", [-100, 150], [100, 150], [100, 100]],
			["pin", "1", -200, 0, 100, "R", "1"],
			["pin", "2", 0, -250, 100, "U", "2"],
			["pin", "3", 200, 0, 100, "L", "3"],
			["pin", "4", 0, 250, 100, "D", "4"],
		],
	},
	{
		id: "w25q128jvs",
		category: "Other components",
		packaging: {
			part: "W25Q128JV",
			name: "W25Q128JVS",
			description: "SOIC-8 208 mil",
		},
		name: "W25Q128JVS",
		description:
			"Winbond 128 Mbit serial NOR flash with quad SPI, SOIC-8 208 mil",
		prefix: "U",
		value: "W25Q128JVS",
		footprint: "soic-8_5.23x5.23mm_p1.27mm",
		source: "Memory_Flash:W25Q128JVS",
		rotation: 0,
		filled: true,
		pinType: "bidirectional",
		pinTypes: {
			"/CS": "input",
			CLK: "input",
			VCC: "power-in",
			GND: "power-in",
		},
		drawing: [
			["rectangle", -500, 400, 500, -400],
			["pin", "/CS", -700, 200, 200, "R", "1"],
			["pin", "CLK", -700, 0, 200, "R", "6"],
			["pin", "DI(IO0)", 700, 200, 200, "L", "5"],
			["pin", "DO(IO1)", 700, 100, 200, "L", "2"],
			["pin", "IO2", 700, 0, 200, "L", "3"],
			["pin", "IO3", 700, -100, 200, "L", "7"],
			["pin", "VCC", 0, 600, 200, "D", "8"],
			["pin", "GND", 0, -600, 200, "U", "4"],
		],
	},
	{
		id: "ams1117-3.3",
		category: "Other components",
		packaging: {
			part: "AMS1117-3.3",
			name: "SOT-223",
			description: "SOT-223 with the tab on the output",
		},
		name: "AMS1117-3.3",
		description:
			"1 A low-dropout linear regulator with a fixed 3.3 V output, SOT-223",
		prefix: "U",
		value: "AMS1117-3.3",
		footprint: "sot-223-3_tabpin2",
		source: "Regulator_Linear:AMS1117-3.3",
		rotation: 0,
		filled: true,
		pinTypes: { VI: "power-in", VO: "power-out", GND: "power-in" },
		drawing: [
			["rectangle", -300, 200, 300, -200],
			["pin", "VI", -500, 100, 200, "R", "3"],
			["pin", "VO", 500, 100, 200, "L", "2"],
			["pin", "GND", 0, -400, 200, "U", "1"],
		],
	},
	{
		id: "usb-b-micro",
		category: "Other components",
		packaging: {
			part: "USB Micro-B",
			name: "Right angle SMD",
			description: "Five contacts and a shield",
		},
		name: "USB Micro-B",
		description: "USB 2.0 Micro-B receptacle with shield",
		prefix: "J",
		value: "USB_B_Micro",
		footprint: "usb_micro-b_molex-105017-0001",
		source: "Connector:USB_B_Micro",
		rotation: 0,
		filled: true,
		pinTypes: { VBUS: "power-out", GND: "power-in" },
		drawing: [
			["rectangle", -300, 500, 300, -500],
			["pin", "VBUS", 500, 300, 200, "L", "1"],
			["pin", "D+", 500, 0, 200, "L", "3"],
			["pin", "D-", 500, -100, 200, "L", "2"],
			["pin", "ID", 500, -300, 200, "L", "4"],
			["pin", "GND", 0, -700, 200, "U", "5"],
			["pin", "Shield", -100, -700, 200, "U", "6"],
		],
	},
	connector(20),
];
