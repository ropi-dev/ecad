import type { CircuitPin } from "#/circuit/model.ts";
import {
	type PinElectricalType,
	pinElectricalTypeLabels,
	pinElectricalTypes,
} from "#/drawing/pin-types.ts";
import type {
	ErcContext,
	ErcFinding,
	ErcPin,
	ErcRule,
	ErcSubject,
} from "#/erc/engine.ts";

const pinSubject = ({ pin }: ErcPin): ErcSubject => ({
	kind: "pin",
	id: pin.id,
});
const pinLabel = ({ pin, component }: ErcPin) =>
	`${component.reference} pin ${pin.number}${pin.name ? ` (${pin.name})` : ""}`;
const netLabel = (names: readonly string[]) =>
	names.join(" / ") || "Unnamed net";

export const unconnectedPinRule: ErcRule = {
	id: "unconnected-pin",
	title: "Unconnected pin",
	severity: "warning",
	*check(context) {
		for (const entry of context.pins.values()) {
			const net = context.netsByPin.get(entry.pin.id);
			if (
				entry.pin.electricalType === "no-connect" ||
				entry.pin.electricalType === "free"
			)
				continue;
			if (context.noConnect.has(entry.pin.id) && !net) continue;
			if (!net || net.pinIds.length < 2)
				yield {
					message: `${pinLabel(entry)} is unconnected. Connect it or mark it no-connect.`,
					subjects: [pinSubject(entry)],
				};
		}
	},
};

function undrivenRule(
	id: string,
	title: string,
	type: "input" | "power-in",
	drivers: readonly CircuitPin["electricalType"][],
	severity: ErcRule["severity"],
	drivenByNet: (net: {
		readonly schematicShapeIds?: readonly number[];
	}) => boolean = () => false,
): ErcRule {
	return {
		id,
		title,
		severity,
		*check(context) {
			for (const net of context.circuit.nets) {
				const members = context.pinsByNet.get(net.id) ?? [];
				if (
					members.length < 2 ||
					drivenByNet(net) ||
					members.some(({ pin }) => drivers.includes(pin.electricalType))
				)
					continue;
				const sinks = members.filter(({ pin }) => pin.electricalType === type);
				if (sinks.length)
					yield {
						message: `${netLabel(net.names)} has ${type === "input" ? "inputs but no signal driver" : "power inputs but no power output"}.`,
						subjects: sinks.map(pinSubject),
						target: { kind: "net", id: net.id },
					};
			}
		},
	};
}

/**
 * As in KiCad, passive pins drive inputs, such as resistors around an op amp.
 * Open-collector and open-emitter outputs also count, because a pull-up may
 * be inside the receiving chip.
 */
export const undrivenInputRule = undrivenRule(
	"undriven-input",
	"Input without a driver",
	"input",
	[
		"output",
		"bidirectional",
		"tri-state",
		"passive",
		"power-out",
		"open-collector",
		"open-emitter",
	],
	"warning",
);
/**
 * Only a power output drives a power input. A supply symbol on the net, such
 * as VCC or GND, also counts as the source, so it plays the role of KiCad's
 * PWR_FLAG.
 */
export const undrivenPowerRule = undrivenRule(
	"undriven-power",
	"Power input without a driver",
	"power-in",
	["power-out"],
	"error",
	(net) => !!net.schematicShapeIds?.length,
);

const pinTypeMatrix: Record<PinElectricalType, string> = {
	input: "OOOOOOWOOOOE",
	output: "OEOWOOWOEEEE",
	bidirectional: "OOOOOOWOWOWE",
	"tri-state": "OWOOOOWWEWWE",
	passive: "OOOOOOWOOOOE",
	free: "OOOOOOOOOOOE",
	unspecified: "WWWWWOWWWWWE",
	"power-in": "OOOWOOWOOOOE",
	"power-out": "OEWEOOWOEEEE",
	"open-collector": "OEOWOOWOEOOE",
	"open-emitter": "OEWWOOWOEOOE",
	"no-connect": "EEEEEEEEEEEE",
};
const pinTypeIndex = new Map(pinElectricalTypes.map((type, i) => [type, i]));
const pinTypeConflict = (a: PinElectricalType, b: PinElectricalType) =>
	pinTypeMatrix[a][pinTypeIndex.get(b) ?? 0];
const sharesPad = (a: ErcPin, b: ErcPin) =>
	a.component.id === b.component.id &&
	!!a.pin.name &&
	a.pin.name !== "~" &&
	a.pin.name === b.pin.name &&
	(a.pin.electricalType === b.pin.electricalType ||
		[a.pin.electricalType, b.pin.electricalType].some(
			(type) => type === "passive" || type === "free",
		));

function pinTypeRule(
	id: string,
	title: string,
	level: "E" | "W",
	severity: ErcRule["severity"],
): ErcRule {
	return {
		id,
		title,
		severity,
		*check(context) {
			for (const net of context.circuit.nets) {
				const members = context.pinsByNet.get(net.id) ?? [];
				const pins = new Set<ErcPin>();
				const pairs = new Set<string>();
				for (let i = 0; i < members.length; i++)
					for (let j = i + 1; j < members.length; j++) {
						const a = members[i];
						const b = members[j];
						if (
							a.pin.electricalType === "no-connect" ||
							b.pin.electricalType === "no-connect" ||
							sharesPad(a, b) ||
							pinTypeConflict(a.pin.electricalType, b.pin.electricalType) !==
								level
						)
							continue;
						pins.add(a);
						pins.add(b);
						pairs.add(
							[a.pin.electricalType, b.pin.electricalType]
								.map((type) => pinElectricalTypeLabels[type])
								.sort()
								.join(" and "),
						);
					}
				if (pins.size)
					yield {
						message: `${netLabel(net.names)} connects ${[...pairs].sort().join(", ")} pins: ${[...pins].map(pinLabel).join(", ")}.`,
						subjects: [...pins].map(pinSubject),
						target: { kind: "net", id: net.id },
					};
			}
		},
	};
}

export const pinTypeConflictRule = pinTypeRule(
	"pin-type-conflict",
	"Conflicting pin types",
	"E",
	"error",
);
export const pinTypeWarningRule = pinTypeRule(
	"pin-type-warning",
	"Questionable pin types",
	"W",
	"warning",
);

export const connectedNoConnectRule: ErcRule = {
	id: "connected-no-connect",
	title: "Connected no-connect pin",
	severity: "error",
	*check(context): Iterable<ErcFinding> {
		for (const id of context.noConnect) {
			const entry = context.pins.get(id);
			if (entry && context.netsByPin.has(id))
				yield {
					message: `${pinLabel(entry)} is connected and marked no-connect.`,
					subjects: [pinSubject(entry)],
				};
		}
		for (const entry of context.pins.values()) {
			const net = context.netsByPin.get(entry.pin.id);
			if (
				entry.pin.electricalType === "no-connect" &&
				!context.noConnect.has(entry.pin.id) &&
				net &&
				context.pinsByNet
					.get(net.id)
					?.some((other) => other !== entry && !sharesPad(entry, other))
			)
				yield {
					message: `${pinLabel(entry)} has the Unconnected pin type but is connected.`,
					subjects: [pinSubject(entry)],
				};
		}
	},
};

const netName = (context: ErcContext, pinId: string) =>
	netLabel(context.netsByPin.get(pinId)?.names ?? []);

export const duplicatePinNetsRule: ErcRule = {
	id: "duplicate-pin-nets",
	title: "Pin number on several nets",
	severity: "error",
	*check(context) {
		for (const component of context.circuit.components) {
			const byNumber = new Map<string, ErcPin[]>();
			for (const pin of component.pins) {
				const entry = context.pins.get(pin.id);
				if (!entry || !context.netsByPin.has(pin.id)) continue;
				const list = byNumber.get(pin.number);
				if (list) list.push(entry);
				else byNumber.set(pin.number, [entry]);
			}
			for (const [number, pins] of byNumber) {
				const nets = new Set(
					pins.map(({ pin }) => context.netsByPin.get(pin.id)?.id),
				);
				if (nets.size < 2) continue;
				const names = [
					...new Set(pins.map(({ pin }) => netName(context, pin.id))),
				];
				yield {
					message: `${component.reference} pin ${number} is connected to ${names.length > 1 ? names.join(" and ") : `${nets.size} different nets`}.`,
					subjects: pins.map(pinSubject),
				};
			}
		}
	},
};

const isGroundName = (name: string) => {
	const upper = name.trim().toUpperCase();
	return (
		upper.includes("GND") ||
		upper === "EARTH" ||
		upper.startsWith("EARTH_") ||
		upper === "VSS" ||
		upper === "VSSA"
	);
};

export const groundPinRule: ErcRule = {
	id: "ground-pin-not-ground",
	title: "Ground pin not on a ground net",
	severity: "warning",
	*check(context) {
		for (const component of context.circuit.components) {
			let grounded = false;
			const mismatched: ErcPin[] = [];
			for (const pin of component.pins) {
				if (
					pin.electricalType !== "power-in" &&
					pin.electricalType !== "power-out"
				)
					continue;
				const net = context.netsByPin.get(pin.id);
				const ground = !!net?.names.some(isGroundName);
				if (ground) grounded = true;
				const entry = context.pins.get(pin.id);
				if (entry && isGroundName(pin.name) && !ground) mismatched.push(entry);
			}
			if (grounded)
				for (const entry of mismatched)
					yield {
						message: `${pinLabel(entry)} is not connected to a ground net, but other ${entry.component.reference} power pins are.`,
						subjects: [pinSubject(entry)],
					};
		}
	},
};

export const multipleNetNamesRule: ErcRule = {
	id: "multiple-net-names",
	title: "Net with several names",
	severity: "warning",
	*check(context) {
		for (const net of context.circuit.nets)
			if (net.names.length > 1)
				yield {
					message: `${net.names.join(", ")} name the same net. Remove all but one name, or check for an unintended connection.`,
					subjects: [{ kind: "net", id: net.id }],
				};
	},
};

export function similarNameKey(name: string): string {
	const text = name.trim();
	const parts = /^(.*?)([\d.,]*\d)(\D*)$/.exec(text);
	if (!parts) return text.toLowerCase();
	const [, prefix, value, units] = parts;
	return (
		(prefix === "+" ? "" : prefix) +
		value +
		units.replace(/[µμ]/g, "u")
	).toLowerCase();
}

export const similarNetNamesRule: ErcRule = {
	id: "similar-net-names",
	title: "Similar net names",
	severity: "warning",
	*check(context) {
		const byKey = new Map<string, Map<string, string>>();
		for (const net of context.circuit.nets)
			for (const name of net.names) {
				const key = similarNameKey(name);
				const names = byKey.get(key) ?? new Map<string, string>();
				if (!names.has(name)) names.set(name, net.id);
				byKey.set(key, names);
			}
		for (const names of byKey.values())
			if (names.size > 1)
				yield {
					message: `Net names ${[...names.keys()].sort().join(", ")} differ only in case or formatting. Use one spelling if they are the same net.`,
					subjects: [...new Set(names.values())].map((id) => ({
						kind: "net" as const,
						id,
					})),
				};
	},
};

export const defaultErcRules: readonly ErcRule[] = [
	unconnectedPinRule,
	undrivenInputRule,
	undrivenPowerRule,
	pinTypeConflictRule,
	pinTypeWarningRule,
	connectedNoConnectRule,
	duplicatePinNetsRule,
	groundPinRule,
	multipleNetNamesRule,
	similarNetNamesRule,
];
