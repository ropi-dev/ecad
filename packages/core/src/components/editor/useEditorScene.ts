import { useCallback, useEffect, useMemo, useState } from "react";
import { buildDrawingDisplay } from "#/drawing/display.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import {
	buildWorksheetDisplay,
	defaultSheet,
	type SheetSize,
} from "#/drawing/worksheet.ts";
import { createDrawingRenderer } from "#/engine/drawing/renderer.ts";

type DrawingRenderer = ReturnType<typeof createDrawingRenderer>;

/** React owns the renderer lifetime; display rules and Three objects live elsewhere. */
export function useEditorScene(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	previews: EditorShape[] = [],
	sheet: SheetSize = defaultSheet,
) {
	const [renderer, setRenderer] = useState<DrawingRenderer>();
	useEffect(() => {
		const next = createDrawingRenderer(
			buildWorksheetDisplay({
				width: sheet.width,
				height: sheet.height,
				name: sheet.name,
			}),
		);
		setRenderer(next);
		return () => next.dispose();
	}, [sheet.width, sheet.height, sheet.name]);
	const display = useMemo(
		() => buildDrawingDisplay(shapes, selectedIds, previews),
		[shapes, selectedIds, previews],
	);
	const updateScene = useCallback(
		(root: Parameters<DrawingRenderer["update"]>[0]) => {
			renderer?.update(root, display);
		},
		[renderer, display],
	);
	return { scene: renderer?.scene, updateScene };
}
