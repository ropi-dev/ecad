import { useEffect, useEffectEvent, useRef } from "react";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

type View = ViewSelection["view"];
type Of<V extends View> = Extract<ViewSelection, { view: V }>;
type Selection<V extends View> = Of<V>["selection"];

export function useViewSelectionSync<V extends View>({
	enabled = true,
	view,
	store,
	selection,
	equal,
	receive,
	apply,
}: {
	enabled?: boolean;
	view: V;
	store: Of<V>["store"];
	selection: Selection<V>;
	equal(a: Selection<V>, b: Selection<V>): boolean;
	receive(source: Exclude<ViewSelection, { view: V }>): Selection<V>;
	apply(selection: Selection<V>): Selection<V>;
}) {
	const project = useProjectSelection(
		({ rememberViewSelection, takeSelectionHandoff }) => ({
			rememberViewSelection,
			takeSelectionHandoff,
		}),
	);
	const handoff = useRef<
		{ selection: Selection<V>; origin?: ViewSelection } | null | undefined
	>(undefined);
	const applied = useRef<{
		selection: Selection<V>;
		origin: ViewSelection;
	} | null>(null);
	const remember = useEffectEvent(
		(current: Selection<V>, origin: ViewSelection | undefined) =>
			project?.rememberViewSelection({
				view,
				store,
				selection: current,
				...(origin ? { origin } : {}),
			} as ViewSelection),
	);
	const take = useEffectEvent(() => {
		const source = project?.takeSelectionHandoff(view);
		if (!source) return null;
		if (source.view === view)
			return source.store === store
				? { selection: source.selection as Selection<V> }
				: null;
		return {
			selection: receive(source as Exclude<ViewSelection, { view: V }>),
			origin: source,
		};
	});
	const applyHandoff = useEffectEvent(() => {
		if (handoff.current === undefined) handoff.current = take();
		const next = handoff.current;
		if (!next) return;
		const result = apply(next.selection);
		applied.current = next.origin
			? { selection: result, origin: next.origin }
			: null;
		remember(result, next.origin);
	});
	useEffect(() => {
		if (!enabled || !project) return;
		if (applied.current && !equal(applied.current.selection, selection))
			applied.current = null;
		remember(selection, applied.current?.origin);
	}, [enabled, project, selection, equal]);
	useEffect(() => {
		if (enabled && project) applyHandoff();
	}, [enabled, project]);
}
