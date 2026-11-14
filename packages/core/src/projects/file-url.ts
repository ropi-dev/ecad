import type { ProjectSnapshot } from "#/projects/format.ts";

export function projectFileUrlPath(path: string): string {
	return path.replace(/^\.ecad\/[0-9a-f-]{36}\//i, "");
}

export interface ProjectFileSelection {
	id: string;
	path: string;
	file: string;
	view?: "circuit";
}

export function projectFileSelections(
	project: ProjectSnapshot,
): ProjectFileSelection[] {
	const { manifest } = project;
	const selection = (
		id: string,
		path: string,
		view?: "circuit",
	): ProjectFileSelection => ({
		id,
		path,
		file: projectFileUrlPath(path),
		view,
	});
	return [
		selection("drawing", manifest.drawing),
		...(manifest.drawings ?? []).flatMap((path, index) => {
			const drawing = project.drawings?.[index];
			return drawing ? [selection(`drawing:${drawing.id}`, path)] : [];
		}),
		...manifest.symbols.flatMap((path, index) => {
			const symbol = project.symbols[index];
			return symbol ? [selection(`symbol:${symbol.id}`, path)] : [];
		}),
		...(manifest.footprints ?? []).flatMap((path, index) => {
			const footprint = project.footprints?.[index];
			return footprint ? [selection(`footprint:${footprint.id}`, path)] : [];
		}),
		...(manifest.circuits ?? []).flatMap((paths, index) => {
			const circuit = project.circuits?.[index];
			return circuit
				? [selection(`circuit:${circuit.circuit.id}`, paths.circuit, "circuit")]
				: [];
		}),
		...manifest.assets.map((asset) =>
			selection(`asset:${asset.path}`, asset.path),
		),
	];
}
