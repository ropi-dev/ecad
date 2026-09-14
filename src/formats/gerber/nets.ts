import type { SceneLayer } from "../../engine/types";

/** Gerber .N names identify nets; empty and N/C names must never join objects. */
export function indexGerberNets(
	layer: SceneLayer,
): Map<string, ReadonlySet<string>> {
	const namesByObject = new Map<string, string[]>();
	const objectsByName = new Map<string, string[]>();
	for (const object of layer.objects) {
		if (object.polarity === "clear") continue;
		const names = [...new Set(object.attributes[".N"] ?? [])]
			.filter((name) => name !== "" && name !== "N/C")
			.sort();
		namesByObject.set(object.id, names);
		for (const name of names) {
			const ids = objectsByName.get(name) ?? [];
			ids.push(object.id);
			objectsByName.set(name, ids);
		}
	}
	const groups = new Map<string, ReadonlySet<string>>();
	const index = new Map<string, ReadonlySet<string>>();
	for (const [id, names] of namesByObject) {
		// Missing metadata cannot establish electrical connectivity.
		if (!names.length) {
			index.set(id, new Set([id]));
			continue;
		}
		const key = JSON.stringify(names);
		let group = groups.get(key);
		if (!group) {
			group = new Set(names.flatMap((name) => objectsByName.get(name)!));
			groups.set(key, group);
		}
		index.set(id, group);
	}
	return index;
}
