import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import { type Accessor, createEffect, createMemo } from "solid-js";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import { useProjectSelection } from "#/projects/ProjectProvider.tsx";

type View = ViewSelection["view"];
type Of<V extends View> = Extract<ViewSelection, { view: V }>;
type Selection<V extends View> = Of<V>["selection"];

interface ViewSelectionSyncOptions<V extends View> {
	enabled?: boolean;
	view: V;
	store: Of<V>["store"];
	equal(a: Selection<V>, b: Selection<V>): boolean;
	receive(source: ViewSelection, circuit: Circuit | undefined): Selection<V>;
	apply(selection: Selection<V>): Selection<V>;
}

export function useViewSelectionSync<V extends View>(
	options: Accessor<ViewSelectionSyncOptions<V>>,
	selection: Accessor<Selection<V>>,
) {
	const project = useProjectSelection(
		({ rememberViewSelection, takeSelectionHandoff }) => ({
			rememberViewSelection,
			takeSelectionHandoff,
		}),
	);
	const state = createMemo(() => {
		const current = options();
		return {
			...current,
			enabled: current.enabled ?? true,
			project: project(),
		};
	});
	type State = ReturnType<typeof state>;
	const remembering = createMemo(
		() => ({ ...state(), selection: selection() }),
		{
			equals: (a, b) =>
				a.enabled === b.enabled &&
				a.project === b.project &&
				a.view === b.view &&
				a.store === b.store &&
				a.selection === b.selection &&
				a.equal === b.equal,
		},
	);
	const handing = createMemo(() => state(), {
		equals: (a, b) => a.enabled === b.enabled && a.project === b.project,
	});
	let handoff:
		| { selection: Selection<V>; origin?: ViewSelection }
		| null
		| undefined;
	let applied: { selection: Selection<V>; origin: ViewSelection } | null = null;
	const remember = (
		current: State,
		selection: Selection<V>,
		origin: ViewSelection | undefined,
	) => {
		current.project?.rememberViewSelection({
			view: current.view,
			store: current.store,
			selection,
			...(origin ? { origin } : {}),
		} as ViewSelection);
	};
	const take = (current: State) => {
		const { view, store, receive } = current;
		const handed = current.project?.takeSelectionHandoff(view);
		if (!handed) return null;
		const { source, circuit } = handed;
		if (source.view === view)
			return source.store === store
				? { selection: source.selection as Selection<V> }
				: null;
		return { selection: receive(source, circuit), origin: source };
	};
	const applyHandoff = (current: State) => {
		if (handoff === undefined) handoff = take(current);
		const next = handoff;
		if (!next) return;
		const result = current.apply(next.selection);
		applied = next.origin ? { selection: result, origin: next.origin } : null;
		remember(current, result, next.origin);
	};
	createEffect(remembering, (current) => {
		if (!current.enabled || !current.project) return;
		if (applied && !current.equal(applied.selection, current.selection))
			applied = null;
		remember(current, current.selection, applied?.origin);
	});
	createEffect(handing, (current) => {
		if (!current.project) return;
		if (current.enabled) applyHandoff(current);
		else {
			handoff = undefined;
			applied = null;
		}
	});
}
