import { generateDefaultFootprints } from "@ecad/default-footprints";
import { autoroute } from "@ecad/drawing-core/board/autoroute.ts";
import {
	type BoardFootprint,
	boardPads,
	createBoardFootprint,
	type FootprintSource,
} from "@ecad/drawing-core/board/footprints.ts";
import { negotiatedRoute } from "@ecad/drawing-core/board/negotiated-route.ts";
import { boardNetlist } from "@ecad/drawing-core/board/netlist.ts";
import type { BoardRules } from "@ecad/drawing-core/board/rules.ts";
import { synchronizeBoard } from "@ecad/drawing-core/board/sync.ts";
import {
	type CircuitFile,
	createCircuit,
} from "@ecad/drawing-core/circuit/model.ts";
import {
	type EditorShape,
	type EditorSymbol,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { symbolReferenceKey } from "@ecad/drawing-core/drawing/symbol-reference.ts";
import type { Point } from "@ecad/drawing-core/drawing/types.ts";
import type { FootprintReference } from "@ecad/drawing-core/footprint/reference.ts";
import { fillReach, fillZones } from "#/board/fill.ts";
import { type BoardFile, createBoardFile } from "#/board/format.ts";
import { trackSegment } from "#/board/routing.ts";
import {
	estimateLabelTextWidth,
	synchronizePcb,
} from "#/circuit/linked-schematic.ts";
import { createLabelShape } from "#/drawing/placement.ts";
import { resolveDrawingSymbols } from "#/drawing/symbol-persistence.ts";
import {
	createSymbol,
	type SymbolDefinition,
	symbolDefinitions,
} from "#/drawing/symbols.ts";
import { updateText } from "#/drawing/text.ts";

/** A part in the reference design: its symbol, value, footprint and pin nets. */
interface Part {
	reference: string;
	symbol: string;
	value: string;
	footprint?: string;
	/** Net by pin number. Pins left out are not connected. */
	pins: Record<string, string>;
	/** Board placement: centre in millimetres, angle in degrees, side. */
	at: [x: number, y: number, angle?: number, back?: boolean];
}

const gpioPins = [
	2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 27, 28, 29, 31, 32,
	33, 34, 35, 36, 37, 40, 41, 42, 43,
];

const two = (a: string, b: string) => ({ "1": a, "2": b });

const capacitor = (
	reference: string,
	value: string,
	net: string,
	at: Part["at"],
	size = "0402",
): Part => ({
	reference,
	symbol: "capacitor",
	value,
	footprint: `c_${size}_${size === "0402" ? "1005" : size === "0603" ? "1608" : "2012"}metric`,
	pins: two(net, "GND"),
	at,
});

const resistor = (
	reference: string,
	value: string,
	a: string,
	b: string,
	at: Part["at"],
): Part => ({
	reference,
	symbol: "resistor",
	value,
	footprint: "r_0402_1005metric",
	pins: two(a, b),
	at,
});

const header = (reference: string, nets: string[], at: Part["at"]): Part => ({
	reference,
	symbol: "connector-20",
	value: "GPIO",
	pins: Object.fromEntries(nets.map((net, index) => [String(index + 1), net])),
	at,
});

const mcuPins: Record<string, string> = {
	...Object.fromEntries(
		gpioPins.map((pin, index) => [String(pin), `GPIO${index}`]),
	),
	...Object.fromEntries(
		["1", "11", "20", "30", "38", "45", "44", "49", "53", "54"].map((pin) => [
			pin,
			"+3V3",
		]),
	),
	"6": "DVDD",
	"23": "DVDD",
	"39": "DVDD",
	"50": "DVDD",
	"46": "VREG_AVDD",
	"47": "GND",
	"48": "VREG_LX",
	"61": "GND",
	"56": "QSPI_SCLK",
	"57": "QSPI_SD0",
	"59": "QSPI_SD1",
	"58": "QSPI_SD2",
	"55": "QSPI_SD3",
	"60": "QSPI_SS",
	"26": "RUN",
	"24": "SWCLK",
	"25": "SWDIO",
	"51": "USB_DM",
	"52": "USB_DP",
	"21": "XIN",
	"22": "XOUT",
};

/**
 * The RP2350A minimal design from Raspberry Pi's hardware design guide:
 * the chip with its switching core regulator, a QSPI flash, a 12 MHz crystal,
 * USB, a 3.3 V regulator, BOOTSEL and RUN buttons, an SWD header and two
 * 20-pin GPIO headers.
 */
export const rp2350aParts: readonly Part[] = [
	{
		reference: "U1",
		symbol: "rp2350a",
		value: "RP2350A",
		pins: mcuPins,
		at: [0, 6],
	},
	{
		reference: "U2",
		symbol: "w25q128jvs",
		value: "W25Q128JVS",
		pins: {
			"1": "QSPI_SS",
			"2": "QSPI_SD1",
			"3": "QSPI_SD2",
			"4": "GND",
			"5": "QSPI_SD0",
			"6": "QSPI_SCLK",
			"7": "QSPI_SD3",
			"8": "+3V3",
		},
		at: [-7, 17],
	},
	{
		reference: "U3",
		symbol: "ams1117-3.3",
		value: "AMS1117-3.3",
		pins: { "1": "GND", "2": "+3V3", "3": "VBUS" },
		at: [8.2, 18.5],
	},
	{
		reference: "J1",
		symbol: "usb-b-micro",
		value: "USB_B_Micro",
		pins: {
			"1": "VBUS",
			"2": "USB_CONN_DM",
			"3": "USB_CONN_DP",
			"5": "GND",
			"6": "GND",
		},
		at: [0, 26, 180],
	},
	{
		reference: "Y1",
		symbol: "crystal-gnd24",
		value: "12MHz",
		pins: { "1": "XIN", "2": "GND", "3": "XOSC", "4": "GND" },
		at: [-1, -2.4, 0, true],
	},
	{
		reference: "L1",
		symbol: "inductor",
		value: "3.3uH",
		footprint: "l_0805_2012metric",
		pins: two("VREG_LX", "DVDD"),
		at: [2.0, 12.6, 90],
	},
	{
		reference: "SW1",
		symbol: "switch-push",
		value: "BOOTSEL",
		pins: two("BOOTSEL", "GND"),
		at: [-3.25, -11.8],
	},
	{
		reference: "SW2",
		symbol: "switch-push",
		value: "RUN",
		pins: two("RUN", "GND"),
		at: [-3.25, -20.2],
	},
	{
		reference: "J4",
		symbol: "connector-3",
		value: "SWD",
		pins: { "1": "SWCLK", "2": "GND", "3": "SWDIO" },
		at: [-2.54, -7, 90],
	},
	header(
		"J2",
		[
			"GPIO0",
			"GPIO1",
			"GND",
			"GPIO2",
			"GPIO3",
			"GPIO4",
			"GPIO5",
			"GND",
			"GPIO6",
			"GPIO7",
			"GPIO8",
			"GPIO9",
			"GND",
			"GPIO10",
			"GPIO11",
			"GPIO12",
			"GPIO13",
			"GND",
			"GPIO14",
			"GPIO15",
		],
		[-16.51, 24.13],
	),
	header(
		"J3",
		[
			"VBUS",
			"GND",
			"+3V3",
			"GND",
			"GPIO29",
			"GPIO28",
			"GND",
			"GPIO27",
			"GPIO26",
			"GPIO25",
			"GPIO24",
			"GPIO23",
			"GND",
			"GPIO22",
			"GPIO21",
			"GPIO20",
			"GPIO19",
			"GPIO18",
			"GPIO17",
			"GPIO16",
		],
		[16.51, 24.13],
	),
	resistor("R1", "27R", "USB_CONN_DM", "USB_DM", [0.9, 18, 90]),
	resistor("R2", "27R", "USB_CONN_DP", "USB_DP", [-0.3, 18, 90]),
	resistor("R3", "1k", "XOUT", "XOSC", [1.1, -0.4, 0, true]),
	resistor("R4", "33R", "+3V3", "VREG_AVDD", [4.2, 11.4, 0]),
	resistor("R5", "10k", "+3V3", "QSPI_SS", [-7, 21.2, 0]),
	resistor("R6", "1k", "QSPI_SS", "BOOTSEL", [-7, 13, 0]),
	capacitor("C1", "10uF", "VBUS", [8.2, 23, 0], "0805"),
	capacitor("C2", "10uF", "+3V3", [10.6, 13, 90], "0805"),
	capacitor("C3", "15pF", "XIN", [-3.9, -2.4, 90, true]),
	capacitor("C4", "15pF", "XOSC", [1.9, -2.4, 90, true]),
	capacitor("C5", "4.7uF", "VREG_AVDD", [6.4, 11.4, 0], "0603"),
	capacitor("C6", "4.7uF", "+3V3", [-0.2, 13.4, 90, true]),
	capacitor("C7", "4.7uF", "DVDD", [4.6, 14.2, 0], "0603"),
	capacitor("C8", "100nF", "DVDD", [-5.2, 6.6, 90, true]),
	capacitor("C9", "100nF", "DVDD", [0.2, 3.4, 0, true]),
	capacitor("C10", "100nF", "DVDD", [5.2, 6.2, 90, true]),
	capacitor("C11", "100nF", "+3V3", [-5.2, 8.8, 90, true]),
	capacitor("C12", "100nF", "+3V3", [-5.2, 4.4, 90, true]),
	capacitor("C13", "100nF", "+3V3", [-1.9, 3.4, 0, true]),
	capacitor("C14", "100nF", "+3V3", [5.2, 4, 90, true]),
	capacitor("C15", "100nF", "+3V3", [2.3, 3.4, 0, true]),
	capacitor("C16", "100nF", "+3V3", [3.4, 10.2, 0, true]),
	capacitor("C17", "100nF", "+3V3", [-1.6, 11.4, 0, true]),
	capacitor("C18", "100nF", "+3V3", [1.4, 11.0, 90, true]),
	capacitor("C19", "100nF", "+3V3", [5.2, 8.6, 90, true]),
	capacitor("C20", "100nF", "+3V3", [-3.6, 21, 0]),
];

export const rp2350aRules: BoardRules = {
	clearance: 0.15,
	trackWidth: 0.2,
	viaDiameter: 0.6,
	viaDrill: 0.3,
	edgeClearance: 0.3,
};

export const rp2350aCircuitId = "rp2350a";

const outlineSize = { width: 37, height: 58 };

const definitionsById = new Map(
	symbolDefinitions.map((definition) => [definition.id, definition]),
);

function definition(id: string): SymbolDefinition {
	const found = definitionsById.get(id);
	if (!found) throw new Error(`No built-in symbol ${id}.`);
	return found;
}

const pinNumber = (pin: { number?: string }, index: number) =>
	pin.number?.trim() || String(index + 1);

/** Where each schematic part goes, in a grid of columns on an A3 sheet. */
const sheetSlots: Record<string, Point> = {
	U1: { x: -40, y: 10 },
	U2: { x: -130, y: 80 },
	U3: { x: 90, y: 100 },
	J1: { x: 20, y: 100 },
	Y1: { x: -130, y: -10 },
	L1: { x: 90, y: 60 },
	SW1: { x: -130, y: 40 },
	SW2: { x: -130, y: 20 },
	J4: { x: -130, y: -50 },
	J2: { x: 60, y: 10 },
	J3: { x: 120, y: 10 },
};

function gridSlot(index: number): Point {
	const column = index % 10;
	const row = Math.floor(index / 10);
	return { x: -180 + column * 24, y: -80 - row * 24 };
}

/**
 * The schematic: each part's symbol with a net label on every connected
 * pin, so the circuit follows from the labels' names.
 */
export function rp2350aSchematic(): EditorShape[] {
	const shapes: EditorShape[] = [];
	let id = 1;
	let free = 0;
	for (const part of rp2350aParts) {
		const symbolDefinition = definition(part.symbol);
		const symbol: EditorSymbol = {
			...createSymbol(
				id++,
				symbolDefinition,
				sheetSlots[part.reference] ?? gridSlot(free++),
				part.reference,
			),
			...(part.footprint
				? { footprint: { library: "builtin", id: part.footprint } }
				: {}),
		};
		symbol.attributes = {
			...symbol.attributes,
			reference: part.reference,
			value: part.value,
		};
		shapes.push(symbol);
		const pins = symbolShapes(symbol).filter((child) => child.kind === "pin");
		pins.forEach((pin, pinIndex) => {
			if (pin.kind !== "pin") return;
			const net = part.pins[pinNumber(pin, pinIndex)];
			if (!net) return;
			const outward = Math.cos(pin.rotation);
			const label = createLabelShape(
				id++,
				{ x: pin.x, y: pin.y },
				"net",
				estimateLabelTextWidth,
			);
			shapes.push(
				updateText(
					{
						...label,
						horizontalAlign:
							Math.abs(outward) < 0.5
								? "center"
								: outward > 0
									? "right"
									: "left",
						verticalAlign: Math.sin(pin.rotation) > 0.5 ? "top" : "bottom",
					},
					net,
					estimateLabelTextWidth,
				),
			);
		});
	}
	return shapes;
}

/** The circuit the schematic describes, and the schematic as the sync saves it. */
export function rp2350aCircuit(schematic: EditorShape[]): {
	shapes: EditorShape[];
	file: CircuitFile;
} {
	const resolved = resolveDrawingSymbols(
		schematic,
		symbolDefinitions,
		new Map(
			symbolDefinitions.flatMap((entry) =>
				entry.library
					? [[symbolReferenceKey(entry.library, entry.id), entry] as const]
					: [],
			),
		),
	).shapes;
	let counter = 0;
	const linked = synchronizePcb(
		createCircuit("RP2350A", rp2350aCircuitId),
		resolved,
		undefined,
		symbolDefinitions,
		{
			measureText: estimateLabelTextWidth,
			newId: () => `rp2350a-${++counter}`,
		},
	);
	return { shapes: linked.shapes, file: linked.file };
}

const footprintLibrary = () =>
	new Map(generateDefaultFootprints().map(({ file }) => [file.id, file]));

function footprintSource(
	library: ReturnType<typeof footprintLibrary>,
	reference: FootprintReference,
): FootprintSource | undefined {
	const file = library.get(reference.id);
	return file && { reference, name: file.name, shapes: file.shapes };
}

const degrees = (angle = 0) => (angle * Math.PI) / 180;

/**
 * Short straight tracks from each signal pad of the chip outward, past the
 * pad row, as a hand layout starts. Later routes then keep clear of the row.
 */
function fanout(
	footprints: readonly BoardFootprint[],
	netlist: ReturnType<typeof boardNetlist>,
	firstId: number,
	ground: string | undefined,
): EditorShape[] {
	const chip = footprints.find(
		(footprint) => footprint.attributes.reference === "U1",
	);
	if (!chip) return [];
	const stubs: EditorShape[] = [];
	let id = firstId;
	for (const pad of boardPads([chip])) {
		const net = netlist.padNet(pad.component, pad.number);
		if (!net || net === ground) continue;
		const dx = pad.shape.x - chip.x;
		const dy = pad.shape.y - chip.y;
		const length = Math.hypot(dx, dy);
		if (length < 3) continue;
		const outward =
			Math.abs(dx) > Math.abs(dy)
				? { x: Math.sign(dx), y: 0 }
				: { x: 0, y: Math.sign(dy) };
		const from = { x: pad.shape.x, y: pad.shape.y };
		const to = {
			x: Number((from.x + outward.x * 1.2).toFixed(4)),
			y: Number((from.y + outward.y * 1.2).toFixed(4)),
		};
		stubs.push(
			trackSegment(id++, from, to, "F.Cu", rp2350aRules.trackWidth, net),
		);
	}
	return stubs;
}

/**
 * The board: an outline, each footprint at its place, every connection
 * routed, and ground zones on both sides.
 */
export function rp2350aBoard(
	circuit: CircuitFile,
	schematic: EditorShape[],
	trace?: (message: string) => void,
): { board: BoardFile; failed: number } {
	const library = footprintLibrary();
	const symbols = new Map(
		schematic.flatMap((shape) =>
			shape.kind === "symbol" ? [[shape.id, shape] as const] : [],
		),
	);
	const synced = synchronizeBoard({
		shapes: [],
		circuit: circuit.circuit,
		footprintOf: (component) => {
			for (const id of component.schematicShapeIds ?? [
				component.schematicShapeId ?? 0,
			])
				if (symbols.get(id)?.footprint) return symbols.get(id)?.footprint;
			return undefined;
		},
		source: (reference) => footprintSource(library, reference),
		nextId: 1,
	});
	if (synced.missing.length)
		throw new Error(
			`No footprint for ${synced.missing.map((entry) => entry.reference).join(", ")}.`,
		);
	const parts = new Map(rp2350aParts.map((part) => [part.reference, part]));
	const footprints = synced.place.map((shape) => {
		const footprint = shape as BoardFootprint;
		const part = parts.get(footprint.attributes.reference);
		if (!part) return footprint;
		const [x, y, angle, back] = part.at;
		const source = footprintSource(library, footprint.footprint);
		if (!source) return footprint;
		return createBoardFootprint(
			footprint.id,
			source,
			{
				component: footprint.component,
				reference: footprint.attributes.reference,
				value: footprint.attributes.value,
			},
			{ x, y },
			{ rotation: degrees(angle), flipped: back },
		);
	});
	let nextId = footprints.length + 1;
	const outline: EditorShape = {
		id: nextId++,
		kind: "rectangle",
		layer: "Edge.Cuts",
		x: 0,
		y: 0,
		...outlineSize,
		rotation: 0,
		lineWidth: 0.1,
	};
	const netlist = boardNetlist(circuit.circuit);
	const ground = [...netlist.nets.values()].find((net) => net.name === "GND");
	const stubs = fanout(footprints, netlist, nextId, ground?.id);
	nextId += stubs.length;
	const board = [...footprints, outline, ...stubs];
	const negotiated = negotiatedRoute(board, netlist, nextId, {
		rules: rp2350aRules,
		exclude: new Set(ground ? [ground.id] : []),
		rounds: 60,
		progress: trace
			? (round, overlapping) =>
					trace(`round ${round}: ${overlapping} nets overlap`)
			: undefined,
	});
	nextId += negotiated.shapes.length;
	const finished = autoroute(
		[...board, ...negotiated.shapes],
		netlist,
		nextId,
		{
			rules: rp2350aRules,
			trace: trace
				? (event, line) =>
						trace(`${netlist.nets.get(line.net)?.name}: ${event}`)
				: undefined,
		},
	);
	const routed = {
		shapes: [...negotiated.shapes, ...finished.shapes],
		failed: finished.failed,
	};
	nextId += finished.shapes.length;
	const zones: EditorShape[] = (["F.Cu", "B.Cu"] as const).map((layer) => ({
		id: nextId++,
		kind: "rectangle",
		layer,
		x: 0,
		y: 0,
		width: outlineSize.width - 0.2,
		height: outlineSize.height - 0.2,
		rotation: 0,
		lineWidth: 0.1,
		zone: {},
		...(ground ? { net: ground.id } : {}),
	}));
	const shapes = [...board, ...routed.shapes, ...zones];
	const fills = fillZones(shapes, netlist, rp2350aRules);
	void fillReach(fills);
	const file = createBoardFile("RP2350A", circuit.circuit.id);
	return {
		board: { ...file, rules: rp2350aRules, shapes },
		failed: routed.failed.length,
	};
}
