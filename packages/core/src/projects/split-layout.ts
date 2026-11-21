export const EDITOR_VIEWS = ["schematic", "circuit", "pcb"] as const;
export type EditorView = (typeof EDITOR_VIEWS)[number];

const maxPanes = EDITOR_VIEWS.length;

export function normalizeSplitPanes(
	panes: readonly EditorView[],
	active: EditorView,
): EditorView[] {
	const unique = [
		...new Set(panes.filter((view) => EDITOR_VIEWS.includes(view))),
	].slice(0, maxPanes);
	if (unique.length <= 1) return [active];
	if (unique.includes(active)) return unique;
	if (unique.length < maxPanes) return [...unique, active];
	return [active, ...unique.slice(1)];
}

export function openTwoPaneSplit(
	active: EditorView,
	hasBoard: boolean,
): EditorView[] {
	if (active === "schematic")
		return ["schematic", hasBoard ? "pcb" : "circuit"];
	return [active, "schematic"];
}

export function openThreePaneSplit(
	current: readonly EditorView[],
): EditorView[] {
	if (current.length === 2) {
		const missing = EDITOR_VIEWS.find((view) => !current.includes(view));
		if (missing) return [...current, missing];
	}
	return [...EDITOR_VIEWS];
}

export function switchPaneView(
	panes: readonly EditorView[],
	paneIndex: number,
	target: EditorView,
): EditorView[] {
	const next = [...panes];
	if (paneIndex < 0 || paneIndex >= next.length) return next;
	const otherIndex = next.indexOf(target);
	if (otherIndex === paneIndex) return next;
	if (otherIndex >= 0) {
		next[otherIndex] = next[paneIndex];
		next[paneIndex] = target;
	} else next[paneIndex] = target;
	return next;
}

export function closeSplitPane(
	panes: readonly EditorView[],
	paneIndex: number,
	focused: EditorView,
): { panes: EditorView[]; focused: EditorView } {
	if (panes.length <= 1 || paneIndex < 0 || paneIndex >= panes.length)
		return { panes: [...panes], focused };
	const closed = panes[paneIndex];
	const next = panes.filter((_, index) => index !== paneIndex);
	return {
		panes: next,
		focused:
			closed === focused || !next.includes(focused)
				? next[Math.min(paneIndex, next.length - 1)]
				: focused,
	};
}

export function equalSplitSizes(count: number): number[] {
	const panes = Math.max(1, Math.floor(count));
	return Array.from({ length: panes }, () => 1 / panes);
}

export function resizeSplitSizes(
	sizes: readonly number[],
	dividerIndex: number,
	deltaFraction: number,
	minFraction: number,
): number[] {
	const next = [...sizes];
	if (dividerIndex < 0 || dividerIndex + 1 >= next.length) return next;
	const pair = next[dividerIndex] + next[dividerIndex + 1];
	const min = Math.min(minFraction, pair / 2);
	const first = Math.min(
		pair - min,
		Math.max(min, next[dividerIndex] + deltaFraction),
	);
	next[dividerIndex] = first;
	next[dividerIndex + 1] = pair - first;
	return next;
}
