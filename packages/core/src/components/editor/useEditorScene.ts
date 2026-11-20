import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { type Accessor, createMemo, onCleanup } from "solid-js";
import {
	buildPreviewDisplay,
	buildStaticDisplay,
	type DisplayShape,
	type DrawingDisplay,
	type StaticDrawingDisplay,
} from "#/drawing/display.ts";
import {
	buildWorksheetDisplay,
	defaultSheet,
	type SheetSize,
} from "#/drawing/worksheet.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { useSchematicTheme } from "#/settings/theme.ts";

type DrawingRenderer = ReturnType<typeof createDrawingRenderer>;
type BuildStatic = (
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	measure: typeof measureText,
) => StaticDrawingDisplay;
type BuildPreview = (
	previews: EditorShape[],
	shapeCount: number,
	measure: typeof measureText,
) => DisplayShape[];

const noPreviews: EditorShape[] = [];

/** The editor owns the renderer lifetime; display rules and Three objects live elsewhere. */
export function useEditorScene(
	shapes: Accessor<EditorShape[]>,
	selectedIds: Accessor<ReadonlySet<number>>,
	previews: Accessor<EditorShape[]> = () => noPreviews,
	sheet: Accessor<SheetSize | null> = () => defaultSheet,
	buildStatic: Accessor<BuildStatic | undefined> = () => undefined,
	buildPreview: Accessor<BuildPreview | undefined> = () => undefined,
	layered: Accessor<boolean> = () => false,
) {
	const theme = useSchematicTheme();
	const sheetKey = createMemo(() => {
		const value = sheet();
		return value ? JSON.stringify(value) : null;
	});
	const renderer = createMemo((): DrawingRenderer => {
		const key = sheetKey();
		const next = createDrawingRenderer(
			key === null ? null : buildWorksheetDisplay(JSON.parse(key) as SheetSize),
			theme(),
			layered(),
		);
		onCleanup(() => next.dispose());
		return next;
	});
	// Wire and symbol previews change on every pointer move; the document does not.
	const document = createMemo(() => {
		const build = buildStatic() ?? buildStaticDisplay;
		const current = shapes();
		const selection = selectedIds();
		return measurePerformance(
			"editor.scene-display",
			() => build(current, selection, measureText),
			{ shapes: current.length },
		);
	});
	const shapeCount = createMemo(() => shapes().length);
	const preview = createMemo(() =>
		(buildPreview() ?? buildPreviewDisplay)(
			previews(),
			shapeCount(),
			measureText,
		),
	);
	const display = createMemo<DrawingDisplay>(() => ({
		...document(),
		previews: preview(),
	}));
	const updateScene = createMemo(() => {
		const current = renderer();
		const next = display();
		return (root: Parameters<DrawingRenderer["update"]>[0]) =>
			current.update(root, next);
	});
	return {
		get scene() {
			return renderer().scene;
		},
		get updateScene() {
			return updateScene();
		},
	};
}
