import { useCallback, useEffect, useMemo, useState } from "react";
import {
	buildPreviewDisplay,
	buildStaticDisplay,
	type DrawingDisplay,
} from "#/drawing/display.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import {
	buildWorksheetDisplay,
	defaultSheet,
	type SheetSize,
} from "#/drawing/worksheet.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { measurePerformance } from "#/performance/runtime.ts";

type DrawingRenderer = ReturnType<typeof createDrawingRenderer>;

/** React owns the renderer lifetime; display rules and Three objects live elsewhere. */
export function useEditorScene(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	previews: EditorShape[] = [],
	sheet: SheetSize | null = defaultSheet,
) {
	const [renderer, setRenderer] = useState<DrawingRenderer>();
	const width = sheet?.width;
	const height = sheet?.height;
	const name = sheet?.name;
	useEffect(() => {
		const next = createDrawingRenderer(
			width !== undefined && height !== undefined
				? buildWorksheetDisplay({ width, height, name })
				: null,
		);
		setRenderer(next);
		return () => next.dispose();
	}, [width, height, name]);
	// Wire and symbol previews change on every pointer move; the document does not.
	const document = useMemo(
		() =>
			measurePerformance(
				"editor.scene-display",
				() => buildStaticDisplay(shapes, selectedIds, measureText),
				{ shapes: shapes.length },
			),
		[shapes, selectedIds],
	);
	const shapeCount = shapes.length;
	const preview = useMemo(
		() => buildPreviewDisplay(previews, shapeCount, measureText),
		[previews, shapeCount],
	);
	const display = useMemo<DrawingDisplay>(
		() => ({ ...document, previews: preview }),
		[document, preview],
	);
	const updateScene = useCallback(
		(root: Parameters<DrawingRenderer["update"]>[0]) => {
			renderer?.update(root, display);
		},
		[renderer, display],
	);
	return { scene: renderer?.scene, updateScene };
}
