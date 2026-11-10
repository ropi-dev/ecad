/** Pin electrical types, matching KiCad's, in its pin editor order. */
export const pinElectricalTypes = [
	"input",
	"output",
	"bidirectional",
	"tri-state",
	"passive",
	"free",
	"unspecified",
	"power-in",
	"power-out",
	"open-collector",
	"open-emitter",
	"no-connect",
] as const;

export type PinElectricalType = (typeof pinElectricalTypes)[number];

/** The type of a pin that does not store one, including pins in older files. */
export const defaultPinElectricalType: PinElectricalType = "passive";

export const pinElectricalTypeLabels: Record<PinElectricalType, string> = {
	input: "Input",
	output: "Output",
	bidirectional: "Bidirectional",
	"tri-state": "Tri-state",
	passive: "Passive",
	free: "Free",
	unspecified: "Unspecified",
	"power-in": "Power input",
	"power-out": "Power output",
	"open-collector": "Open collector",
	"open-emitter": "Open emitter",
	"no-connect": "Unconnected",
};

export function pinElectricalType(pin: {
	readonly electricalType?: PinElectricalType;
}): PinElectricalType {
	return pin.electricalType ?? defaultPinElectricalType;
}
