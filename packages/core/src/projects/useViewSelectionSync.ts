import type { Circuit } from "@ecad/drawing-core/circuit/model.ts";
import { type Accessor, createEffect, createMemo, untrack } from "solid-js";
import type { ViewSelection } from "#/circuit/selection-sync.ts";
import { fromExternalStore } from "#/lib/external-store.ts";
import {
	type SyncedViewSelection,
	useProjectSelection,
} from "#/projects/ProjectProvider.tsx";

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
	revision?: Accessor<unknown>,
) {
	const project = useProjectSelection(
		({
			rememberViewSelection,
			takeSelectionHandoff,
			subscribeViewSelection,
			getViewSelection,
			circuitForViewSelection,
			circuitIdForView,
			session,
		}) => ({
			rememberViewSelection,
			takeSelectionHandoff,
			subscribeViewSelection,
			getViewSelection,
			circuitForViewSelection,
			circuitIdForView,
			session,
		}),
	);
	const syncedSource = createMemo(() => {
		const current = project();
		if (!current) return () => null;
		return fromExternalStore(
			current.subscribeViewSelection,
			current.getViewSelection,
		);
	});
	interface SyncState {
		options: ViewSelectionSyncOptions<V>;
		enabled: boolean;
		project: ReturnType<typeof project>;
	}
	interface IncomingState extends SyncState {
		synced: SyncedViewSelection | null;
		revision: unknown;
	}
	interface RememberingState extends SyncState {
		selection: Selection<V>;
	}
	const state = createMemo<SyncState>(() => {
		const current = options();
		return {
			options: current,
			enabled: current.enabled ?? true,
			project: project(),
		};
	});
	const incoming = createMemo<IncomingState>(
		() => {
			const current = state();
			return {
				options: current.options,
				enabled: current.enabled,
				project: current.project,
				synced: syncedSource()(),
				revision: revision?.(),
			};
		},
		{
			equals: (a, b) =>
				a.enabled === b.enabled &&
				a.project === b.project &&
				a.options.view === b.options.view &&
				a.options.store === b.options.store &&
				a.synced === b.synced &&
				a.revision === b.revision,
		},
	);
	const remembering = createMemo<RememberingState>(
		() => {
			const current = state();
			return {
				options: current.options,
				enabled: current.enabled,
				project: current.project,
				selection: selection(),
			};
		},
		{
			equals: (a, b) =>
				a.enabled === b.enabled &&
				a.project === b.project &&
				a.options.view === b.options.view &&
				a.options.store === b.options.store &&
				a.selection === b.selection &&
				a.options.equal === b.options.equal,
		},
	);
	let applied: {
		version: number;
		selection: Selection<V>;
		origin: ViewSelection;
	} | null = null;
	let lastAppliedVersion = -1;
	let wasEnabled = false;
	let lastStore: object | undefined;
	let lastLocal: { selection: Selection<V> } | null = null;
	let syncingNow = false;

	createEffect(incoming, (current) => {
		const { options: opts, enabled, project: proj, synced } = current;
		if (!enabled || !proj) {
			wasEnabled = false;
			lastStore = undefined;
			applied = null;
			lastAppliedVersion = -1;
			lastLocal = null;
			return;
		}
		const justEnabled = !wasEnabled;
		const storeChanged = lastStore !== undefined && lastStore !== opts.store;
		wasEnabled = true;
		lastStore = opts.store;
		if (storeChanged) {
			applied = null;
			lastAppliedVersion = -1;
		}
		if (justEnabled || storeChanged) {
			const handed = proj.takeSelectionHandoff(opts.view);
			if (handed) {
				const { source, circuit } = handed;
				const next =
					source.view === opts.view
						? source.store === opts.store
							? { selection: source.selection as Selection<V> }
							: null
						: {
								selection: opts.receive(source, circuit),
								origin: source,
							};
				if (next) {
					syncingNow = true;
					let result: Selection<V>;
					try {
						result = opts.apply(next.selection);
					} finally {
						syncingNow = false;
					}
					lastAppliedVersion = synced?.version ?? -1;
					lastLocal = { selection: result };
					applied = next.origin
						? {
								version: lastAppliedVersion,
								selection: result,
								origin: next.origin,
							}
						: null;
					proj.rememberViewSelection({
						view: opts.view,
						store: opts.store,
						selection: result,
						...(next.origin ? { origin: next.origin } : {}),
					} as ViewSelection);
					return;
				}
			}
		}
		const circuitId = proj.circuitIdForView(opts.view, opts.store);
		const matchesCircuit =
			!!synced &&
			circuitId !== undefined &&
			synced.circuitId === circuitId &&
			synced.generation === proj.session;
		if (
			matchesCircuit &&
			synced.source.view !== opts.view &&
			synced.version !== lastAppliedVersion
		) {
			const mapped = opts.receive(
				synced.source,
				proj.circuitForViewSelection(synced.circuitId),
			);
			syncingNow = true;
			let result: Selection<V>;
			try {
				result = opts.apply(mapped);
			} finally {
				syncingNow = false;
			}
			applied = {
				version: synced.version,
				selection: result,
				origin: synced.source,
			};
			lastAppliedVersion = synced.version;
			lastLocal = { selection: result };
			return;
		}
		if (
			matchesCircuit &&
			synced.source.view !== opts.view &&
			synced.version === lastAppliedVersion &&
			applied !== null &&
			applied.version === synced.version
		) {
			const mapped = opts.receive(
				synced.source,
				proj.circuitForViewSelection(synced.circuitId),
			);
			if (
				!opts.equal(mapped, applied.selection) ||
				!opts.equal(mapped, untrack(selection))
			) {
				syncingNow = true;
				let result: Selection<V>;
				try {
					result = opts.apply(mapped);
				} finally {
					syncingNow = false;
				}
				applied = {
					...applied,
					selection: result,
				};
				lastLocal = { selection: result };
			}
			return;
		}
		if (justEnabled || storeChanged) {
			if (
				matchesCircuit &&
				synced.source.view === opts.view &&
				synced.source.store === opts.store
			) {
				const sourceSelection = synced.source.selection as Selection<V>;
				if (!opts.equal(untrack(selection), sourceSelection)) {
					syncingNow = true;
					try {
						lastLocal = { selection: opts.apply(sourceSelection) };
					} finally {
						syncingNow = false;
					}
				} else {
					lastLocal = { selection: untrack(selection) };
				}
				lastAppliedVersion = synced.version;
			} else {
				lastLocal = { selection: untrack(selection) };
			}
		}
	});

	createEffect(remembering, (current) => {
		const { options: opts, enabled, project: proj } = current;
		if (!enabled || !proj || syncingNow) return;
		if (!lastLocal) {
			lastLocal = { selection: current.selection };
			return;
		}
		if (opts.equal(lastLocal.selection, current.selection)) return;
		lastLocal = { selection: current.selection };
		if (applied && opts.equal(applied.selection, current.selection)) return;
		applied = null;
		proj.rememberViewSelection({
			view: opts.view,
			store: opts.store,
			selection: current.selection,
		} as ViewSelection);
		lastAppliedVersion = proj.getViewSelection()?.version ?? lastAppliedVersion;
	});
}
