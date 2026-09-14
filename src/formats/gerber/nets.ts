import type { SceneLayer } from "../../engine/types";

/** Only objects with a named Gerber .N net are hover targets. */
export function indexGerberNets(
	layer: SceneLayer,
): Map<string, ReadonlySet<string>> {
	const namesByObject = new Map<string, string[]>();
	const objectsByName = new Map<string, string[]>();
	for (const object of layer.objects) {
		if (object.polarity === "clear") continue;
		const names = [...new Set(object.attributes[".N"] ?? [])]
			.filter((name) => name.trim() !== "" && name !== "N/C")
			.sort();
		if (!names.length) continue;
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
