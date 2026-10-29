import { z } from "zod";

const id = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(200);
export const circuitPinSchema = z.strictObject({
	id,
	sourcePinId: id.optional(),
	schematicShapeId: z.number().int().positive().optional(),
	name: z.string().max(200),
	number: name,
	electricalType: z
		.enum([
			"passive",
			"input",
			"output",
			"bidirectional",
			"power-in",
			"power-out",
		])
		.default("passive"),
});
export const circuitComponentSchema = z.strictObject({
	id,
	schematicShapeId: z.number().int().nonnegative().optional(),
	schematicShapeIds: z
		.array(z.number().int().positive())
		.min(1)
		.refine((ids) => new Set(ids).size === ids.length)
		.optional(),
	reference: name,
	value: z.string().max(200),
	part: z.strictObject({
		id,
		name,
		revision: z.string().optional(),
		library: z
			.strictObject({ scope: z.enum(["user", "project"]), id })
			.optional(),
	}),
	pins: z.array(circuitPinSchema).min(1),
});
export const circuitNetSchema = z.strictObject({
	id,
	names: z.array(name),
	pinIds: z.array(id),
});
export const circuitSchema = z
	.strictObject({
		format: z.literal("ecad-circuit"),
		version: z.literal(1),
		id,
		name,
		revision: z.number().int().nonnegative(),
		components: z.array(circuitComponentSchema),
		nets: z.array(circuitNetSchema),
		noConnectPinIds: z.array(id),
	})
	.superRefine((circuit, ctx) => {
		const ids = new Set<string>();
		const pins = new Set<string>();
		const references = new Set<string>();
		const memberships = new Set<string>();
		const names = new Set<string>();
		const issue = (message: string) =>
			ctx.addIssue({ code: "custom", message });
		const unique = (value: string) => {
			if (ids.has(value)) issue(`Duplicate circuit identity: ${value}`);
			ids.add(value);
		};
		unique(circuit.id);
		for (const component of circuit.components) {
			unique(component.id);
			if (references.has(component.reference))
				issue(`Duplicate component reference: ${component.reference}`);
			references.add(component.reference);
			for (const pin of component.pins) {
				unique(pin.id);
				pins.add(pin.id);
			}
		}
		for (const net of circuit.nets) {
			unique(net.id);
			for (const pinId of net.pinIds) {
				if (!pins.has(pinId)) issue(`Net references an unknown pin: ${pinId}`);
				if (memberships.has(pinId))
					issue(`Pin belongs to more than one net: ${pinId}`);
				memberships.add(pinId);
			}
			for (const value of net.names) {
				if (names.has(value)) issue(`Duplicate net name: ${value}`);
				names.add(value);
			}
		}
		const noConnect = new Set<string>();
		for (const pinId of circuit.noConnectPinIds) {
			if (!pins.has(pinId))
				issue(`No-connect references an unknown pin: ${pinId}`);
			if (memberships.has(pinId))
				issue(`Connected pin is marked no-connect: ${pinId}`);
			if (noConnect.has(pinId)) issue(`Duplicate no-connect pin: ${pinId}`);
			noConnect.add(pinId);
		}
	});

export const graphLayoutSchema = z
	.strictObject({
		format: z.literal("ecad-circuit-graph"),
		version: z.literal(1),
		circuitId: id,
		collapsedComponentIds: z.array(id).optional(),
		positions: z.array(
			z.strictObject({
				id,
				kind: z.enum(["component", "net"]),
				x: z.number().finite().min(-1_000_000).max(1_000_000),
				y: z.number().finite().min(-1_000_000).max(1_000_000),
			}),
		),
	})
	.superRefine((layout, ctx) => {
		const ids = new Set<string>();
		for (const position of layout.positions) {
			if (ids.has(position.id))
				ctx.addIssue({ code: "custom", message: "Duplicate graph position." });
			ids.add(position.id);
		}
		if (
			new Set(layout.collapsedComponentIds).size !==
			(layout.collapsedComponentIds?.length ?? 0)
		)
			ctx.addIssue({
				code: "custom",
				message: "Duplicate collapsed component.",
			});
	});

export type Circuit = z.infer<typeof circuitSchema>;
export type CircuitComponent = z.infer<typeof circuitComponentSchema>;
export type CircuitPin = z.infer<typeof circuitPinSchema>;
export type CircuitNet = z.infer<typeof circuitNetSchema>;
export type GraphLayout = z.infer<typeof graphLayoutSchema>;
export const circuitFileSchema = z
	.strictObject({ circuit: circuitSchema, graph: graphLayoutSchema })
	.superRefine((file, ctx) => {
		if (file.circuit.id !== file.graph.circuitId)
			ctx.addIssue({
				code: "custom",
				message: "Graph belongs to another circuit.",
			});
		const components = new Set(
			file.circuit.components.map((component) => component.id),
		);
		const nets = new Set(file.circuit.nets.map((net) => net.id));
		for (const id of file.graph.collapsedComponentIds ?? []) {
			if (!components.has(id))
				ctx.addIssue({
					code: "custom",
					message: "Graph collapses a missing component.",
				});
		}
		for (const position of file.graph.positions) {
			if (!(position.kind === "component" ? components : nets).has(position.id))
				ctx.addIssue({
					code: "custom",
					message: "Graph references a missing circuit entity.",
				});
		}
	});
export type CircuitFile = z.infer<typeof circuitFileSchema>;

export function createCircuit(
	name: string,
	circuitId: string = globalThis.crypto.randomUUID(),
): CircuitFile {
	return circuitFileSchema.parse({
		circuit: {
			format: "ecad-circuit",
			version: 1,
			id: circuitId,
			name,
			revision: 0,
			components: [],
			nets: [],
			noConnectPinIds: [],
		},
		graph: {
			format: "ecad-circuit-graph",
			version: 1,
			circuitId,
			positions: [],
		},
	});
}

export const parseCircuit = (content: string) =>
	circuitSchema.parse(JSON.parse(content));
export const serializeCircuit = (circuit: Circuit) =>
	`${JSON.stringify(circuitSchema.parse(circuit), null, 2)}\n`;
export const parseGraphLayout = (content: string) =>
	graphLayoutSchema.parse(JSON.parse(content));
export const serializeGraphLayout = (graph: GraphLayout) =>
	`${JSON.stringify(graphLayoutSchema.parse(graph), null, 2)}\n`;
