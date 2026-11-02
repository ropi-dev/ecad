import type { ErcFinding, ErcPin, ErcRule, ErcSubject } from "./engine.ts";

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
	drivers: readonly string[],
	severity: ErcRule["severity"],
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

export const undrivenInputRule = undrivenRule(
	"undriven-input",
	"Input without a driver",
	"input",
	["output", "bidirectional", "power-out"],
	"warning",
);
export const undrivenPowerRule = undrivenRule(
	"undriven-power",
	"Power input without a driver",
	"power-in",
	["power-out"],
	"error",
);

export const conflictingOutputsRule: ErcRule = {
	id: "conflicting-outputs",
	title: "Conflicting outputs",
	severity: "error",
	*check(context) {
		for (const net of context.circuit.nets) {
			const drivers = (context.pinsByNet.get(net.id) ?? []).filter(
				({ pin }) =>
					pin.electricalType === "output" || pin.electricalType === "power-out",
			);
			if (drivers.length > 1)
				yield {
					message: `${netLabel(net.names)} connects multiple outputs: ${drivers.map(pinLabel).join(", ")}.`,
					subjects: drivers.map(pinSubject),
					target: { kind: "net", id: net.id },
				};
		}
	},
};

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
	},
};

export const defaultErcRules: readonly ErcRule[] = [
	unconnectedPinRule,
	undrivenInputRule,
	undrivenPowerRule,
	conflictingOutputsRule,
	connectedNoConnectRule,
];
