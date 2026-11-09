import {
	type CommandResult,
	type InvalidDrawingCommand,
	placeShapesEffect,
	replaceAndPlaceShapesEffect,
} from "@ecad/drawing-core/commands/drawing-commands.ts";
import {
	type createDrawingStore,
	DrawingStore,
} from "@ecad/drawing-core/commands/drawing-store.ts";
import {
	drawingPages,
	resolvePage,
	shapesOnPage,
	withPage,
} from "@ecad/drawing-core/drawing/pages.ts";
import {
	canSelectShape,
	type EditorShape,
} from "@ecad/drawing-core/drawing/shapes.ts";
import { Effect, Either } from "effect";
import { placedSelection } from "#/drawing/command-selection.ts";

type Store = ReturnType<typeof createDrawingStore>;
export type DrawingCommand<A> = Effect.Effect<
	A,
	InvalidDrawingCommand,
	DrawingStore
>;

export type ResolveShapes = (shapes: EditorShape[]) => EditorShape[];

export interface EditorSessionState {
	readonly selection: ReadonlySet<number>;

	readonly childKey: string | null;

	readonly draft: EditorShape[] | null;

	readonly error: string;

	readonly allowLocked: boolean;

	/**
	 * The schematic page the editor shows. Selection, gestures and new shapes
	 * use this page only. `null`, or a page the drawing no longer has, shows
	 * the first page; `currentPage` resolves it.
	 */
	readonly page: number | null;
}

export type EditorSession = ReturnType<typeof createEditorSession>;

export function createEditorSession(
	initialStore: Store,
	initialResolve: ResolveShapes = (shapes) => shapes,
) {
	let store = initialStore;
	let state: EditorSessionState = {
		selection: new Set(),
		childKey: null,
		draft: null,
		error: "",
		allowLocked: false,
		page: null,
	};
	const listeners = new Set<() => void>();
	let executing = false;
	/** Cancels gestures, which belong to the page they started on. */
	let onPageChange = () => {};

	let historySelection = new Map<number, number[]>([[0, []]]);
	let resolve = initialResolve;
	let resolved: { input: EditorShape[]; output: EditorShape[] } | undefined;
	let paged:
		| { output: EditorShape[]; page: number; shapes: EditorShape[] }
		| undefined;

	const update = (next: Partial<EditorSessionState>) => {
		state = { ...state, ...next };
		for (const listener of listeners) listener();
	};
	const currentPage = () => resolvePage(store.getSnapshot().pages, state.page);
	/** Resolved shapes on the current page; a new page ID or input refilters. */
	const pageShapes = () => {
		const input = store.getSnapshot().shapes;
		if (resolved?.input !== input) resolved = { input, output: resolve(input) };
		const page = currentPage();
		if (paged?.output !== resolved.output || paged.page !== page)
			paged = {
				output: resolved.output,
				page,
				shapes: shapesOnPage(resolved.output, page, store.getSnapshot().pages),
			};
		return paged.shapes;
	};
	const shapes = () => state.draft ?? pageShapes();
	/** New shapes go to the current page, whatever page they were copied from. */
	const onCurrentPage = (next: EditorShape[]) => {
		const page = currentPage();
		const { pages } = store.getSnapshot();
		return next.map((shape) => withPage(shape, page, pages));
	};
	const preview = (draft: EditorShape[] | null) => {
		if (draft !== state.draft) update({ draft });
	};
	const select = (ids: ReadonlySet<number>) => {
		const next = new Set(
			shapes()
				.filter(
					(shape) =>
						ids.has(shape.id) && canSelectShape(shape, state.allowLocked),
				)
				.map((shape) => shape.id),
		);
		if (
			next.size === state.selection.size &&
			[...next].every((id) => state.selection.has(id))
		)
			return;
		update({ selection: next, childKey: null });
	};
	/**
	 * Shows a page that holds shapes in `ids`: the current page when it holds
	 * any, or else the page of the first one.
	 */
	const reveal = (ids: ReadonlySet<number>) => {
		const snapshot = store.getSnapshot();
		const first = drawingPages(snapshot.pages)[0].id;
		const pages = snapshot.shapes
			.filter((item) => ids.has(item.id))
			.map((item) => item.page ?? first);
		const current = currentPage();
		if (!pages.length || pages.includes(current)) return;
		const page = pages[0];
		onPageChange();
		paged = undefined;
		update({ page, selection: new Set(), childKey: null, draft: null });
	};
	const setError = (error: string | ((current: string) => string)) => {
		const next = typeof error === "function" ? error(state.error) : error;
		if (next !== state.error) update({ error: next });
	};
	const execute = <A>(program: DrawingCommand<A>): A | undefined => {
		executing = true;
		const before = store.getSnapshot();
		try {
			const result = Effect.runSync(
				program.pipe(Effect.provideService(DrawingStore, store), Effect.either),
			);
			if (Either.isLeft(result)) {
				setError(result.left.message);
				return undefined;
			}
			if (store.getSnapshot() !== before) setError("");
			return result.right;
		} finally {
			executing = false;
		}
	};

	const acceptEdit = (
		result: CommandResult,
		previousHistoryId: number,
		ids: ReadonlySet<number> = new Set(
			[...state.selection].flatMap((id) => result.idsBySource.get(id) ?? []),
		),
	) => {
		preview(null);
		const committed = store.getSnapshot();
		const existing = new Set(committed.shapes.map((shape) => shape.id));
		const selection = new Set([...ids].filter((id) => existing.has(id)));
		select(selection);
		const historyId = committed.history.currentId;
		if (historyId !== previousHistoryId)
			historySelection.set(historyId, [...selection]);
	};
	const retainExisting = () => {
		const existing = new Set(
			store.getSnapshot().shapes.map((shape) => shape.id),
		);
		select(new Set([...state.selection].filter((id) => existing.has(id))));
	};

	return {
		getState: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},

		shapes,
		pageShapes,
		currentPage,

		/** Shows another page; the selection and any preview stay behind. */
		setPage(page: number) {
			if (page === currentPage() && page === state.page) return;
			onPageChange();
			paged = undefined;
			update({ page, selection: new Set(), childKey: null, draft: null });
		},
		/** Selects shapes on any page, showing the page of the first one. */
		reveal(ids: ReadonlySet<number>) {
			reveal(ids);
			select(ids);
		},

		drawing: () => store.getSnapshot(),
		nextId: () => store.getSnapshot().nextShapeId,
		historyId: () => store.getSnapshot().history.currentId,

		setResolver(
			next: ResolveShapes,
			known?: { input: EditorShape[]; output: EditorShape[] },
		) {
			if (next !== resolve) resolved = undefined;
			resolve = next;
			if (known) resolved = known;
		},
		preview,
		select,
		selectChild(childKey: string | null) {
			if (childKey !== state.childKey) update({ childKey });
		},

		setAllowLocked(allowLocked: boolean) {
			const selection = new Set(
				shapes()
					.filter(
						(shape) =>
							state.selection.has(shape.id) &&
							canSelectShape(shape, allowLocked),
					)
					.map((shape) => shape.id),
			);
			update({ selection, childKey: null, allowLocked });
		},
		setError,
		execute,
		acceptEdit,

		commit<A extends CommandResult>(
			program: DrawingCommand<A>,
			selection?: ReadonlySet<number>,
		) {
			const previousHistoryId = store.getSnapshot().history.currentId;
			const result = execute(program);
			if (result) acceptEdit(result, previousHistoryId, selection);
			return result;
		},

		place(next: EditorShape[], label: string) {
			const previous = store.getSnapshot();
			const result = execute(placeShapesEffect(onCurrentPage(next), label));
			if (result)
				acceptEdit(
					result,
					previous.history.currentId,
					placedSelection(previous.shapes, result),
				);
			else preview(null);
		},

		replace(replacements: EditorShape[], label: string) {
			const previous = store.getSnapshot();
			const existing = new Set(previous.shapes.map((shape) => shape.id));
			const result = execute(
				replaceAndPlaceShapesEffect(
					replacements.filter((shape) => existing.has(shape.id)),
					onCurrentPage(
						replacements.filter((shape) => !existing.has(shape.id)),
					),
					label,
					[...state.selection],
				),
			);
			if (result) acceptEdit(result, previous.history.currentId);
			else preview(null);
		},

		restore(program: DrawingCommand<unknown>) {
			execute(program);
			const restored = store.getSnapshot();
			preview(null);
			const remembered = new Set(
				historySelection.get(restored.history.currentId) ?? [],
			);
			// Show the page that the restored selection is on.
			reveal(remembered);
			const existing = new Set(restored.shapes.map((shape) => shape.id));
			select(new Set([...remembered].filter((id) => existing.has(id))));
		},
		rememberSelection(historyId: number, ids: readonly number[]) {
			historySelection.set(historyId, [...ids]);
		},

		connect(next: Store, onExternalEdit: () => void) {
			onPageChange = onExternalEdit;
			// Another document opens on its first page.
			const reset = next !== store;
			store = next;
			if (reset) {
				paged = undefined;
				update({ page: null });
			}
			historySelection = new Map([[0, []]]);
			const reconcile = () => {
				if (executing) return;
				onExternalEdit();
				retainExisting();
			};
			// A gesture started on another store must never commit to this one.
			onExternalEdit();
			retainExisting();
			return store.subscribe(reconcile);
		},
	};
}
