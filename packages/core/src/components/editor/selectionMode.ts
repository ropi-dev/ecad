import { shortcutModifier } from "#/components/viewer/shortcutModifier.ts";

export type SelectionMode = "replace" | "toggle" | "add" | "remove";

export function selectionMode(
	event: Pick<MouseEvent, "ctrlKey" | "metaKey" | "shiftKey">,
): SelectionMode {
	if (event[shortcutModifier().flag])
		return event.shiftKey ? "remove" : "toggle";
	return event.shiftKey ? "add" : "replace";
}

export function applySelection<T>(
	current: Iterable<T>,
	items: Iterable<T>,
	mode: SelectionMode,
): Set<T> {
	const next = new Set(mode === "replace" ? [] : current);
	for (const item of items) {
		if (mode === "remove" || (mode === "toggle" && next.has(item)))
			next.delete(item);
		else next.add(item);
	}
	return next;
}
