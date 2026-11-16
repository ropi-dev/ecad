import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { useCallback, useEffect, useMemo, useState } from "react";
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

/** React owns the renderer lifetime; display rules and Three objects live elsewhere. */
export function useEditorScene(
	shapes: EditorShape[],
	selectedIds: ReadonlySet<number>,
	previews: EditorShape[] = [],
	sheet: SheetSize | null = defaultSheet,
	buildStatic: (
		shapes: EditorShape[],
		selectedIds: ReadonlySet<number>,
		measure: typeof measureText,
	) => StaticDrawingDisplay = buildStaticDisplay,
	buildPreview: (
		previews: EditorShape[],
		shapeCount: number,
		measure: typeof measureText,
	) => DisplayShape[] = buildPreviewDisplay,
) {
	const [renderer, setRenderer] = useState<DrawingRenderer>();
	const theme = useSchematicTheme();
	const sheetKey = sheet ? JSON.stringify(sheet) : null;
	useEffect(() => {
		const next = createDrawingRenderer(
			sheetKey === null
				? null
				: buildWorksheetDisplay(JSON.parse(sheetKey) as SheetSize),
			theme,
		);
		setRenderer(next);
		return () => next.dispose();
	}, [sheetKey, theme]);
	// Wire and symbol previews change on every pointer move; the document does not.
	const document = useMemo(
		() =>
			measurePerformance(
				"editor.scene-display",
				() => buildStatic(shapes, selectedIds, measureText),
				{ shapes: shapes.length },
			),
		[shapes, selectedIds, buildStatic],
	);
	const shapeCount = shapes.length;
	const preview = useMemo(
		() => buildPreview(previews, shapeCount, measureText),
		[previews, shapeCount, buildPreview],
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
