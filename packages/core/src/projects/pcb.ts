import { createCircuit } from "@ecad/drawing-core/circuit/model.ts";
import { type ProjectDocument, projectNameSchema } from "#/projects/format.ts";

export const primaryPcbId = "pcb-main";

export function pairPcbDocuments(
	document: ProjectDocument,
	name: string,
): ProjectDocument {
	const circuits = [...(document.circuits ?? [])];
	const drawings = (document.drawings ?? []).map((drawing) => ({ ...drawing }));
	if (!circuits.some((file) => file.circuit.id === primaryPcbId))
		circuits.push(createCircuit(name, primaryPcbId));
	for (const drawing of drawings) {
		drawing.circuitId ??= `pcb-${drawing.id}`;
		if (!circuits.some((file) => file.circuit.id === drawing.circuitId))
			circuits.push(createCircuit(drawing.name, drawing.circuitId));
	}
	for (const file of circuits) {
		if (
			file.circuit.id === primaryPcbId ||
			drawings.some((drawing) => drawing.circuitId === file.circuit.id)
		)
			continue;
		const base = `pcb-${file.circuit.id
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, "-")
			.slice(0, 100)}`;
		let id = base;
		for (
			let suffix = 2;
			drawings.some((drawing) => drawing.id === id);
			suffix++
		)
			id = `${base}-${suffix}`;
		drawings.push({
			id,
			circuitId: file.circuit.id,
			name: pcbDocumentName(file.circuit.name),
			shapes: [],
		});
	}
	return { ...document, circuits, drawings };
}

export function pcbDocumentName(name: string): string {
	const valid = projectNameSchema.safeParse(name);
	if (valid.success) return valid.data;
	const cleaned =
		Array.from(name, (character) =>
			character.charCodeAt(0) < 32 ? "-" : character,
		)
			.join("")
			.replace(/[<>:"/\\|?*]/g, "-")
			.slice(0, 120)
			.trim()
			.replace(/[. ]+$/, "") || "PCB";
	return projectNameSchema.safeParse(cleaned).success
		? cleaned
		: `PCB ${cleaned}`.slice(0, 120);
}

export function uniquePcbName(
	name: string,
	document: ProjectDocument,
	primaryName?: string,
): string {
	const used = new Set([
		...(document.circuits ?? []).map((file) => file.circuit.name),
		...(document.drawings ?? []).map((file) => file.name),
		...(primaryName ? [primaryName] : []),
	]);
	let candidate = name;
	for (let suffix = 2; used.has(candidate); suffix++) {
		const ending = ` ${suffix}`;
		candidate = `${name.slice(0, 120 - ending.length)}${ending}`;
	}
	return candidate;
}
