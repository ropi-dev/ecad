import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { useEffect, useId, useState } from "react";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import type { DrawingZoneFill } from "#/drawing/export.ts";
import type { DrawingExportFormat } from "#/drawing/export-client.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

/** Export dialog. It stays mounted while closed to keep the chosen settings. */
export function DrawingExport({
	shapes,
	sheet,
	label,
	layered = false,
	zoneFills,
	maskMargin,
	copperLayers,
	open,
	onClose,
}: {
	shapes: EditorShape[];
	sheet: SheetSize;
	label: string;
	layered?: boolean;
	zoneFills?: () => Promise<readonly DrawingZoneFill[]>;
	maskMargin?: number | undefined;
	copperLayers?: number | undefined;
	open: boolean;
	onClose: () => void;
}) {
	const [width, setWidth] = useState(9600);
	const [height, setHeight] = useState(6400);
	const [area, setArea] = useState<"sheet" | "drawing">("sheet");
	const [background, setBackground] = useState<
		"white" | "dark" | "transparent"
	>("white");
	const [format, setFormat] = useState<DrawingExportFormat>("png");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const formId = useId();
	useEffect(() => {
		if (open)
			void import("#/drawing/export-client.ts")
				.then(({ warmDrawingExport }) => warmDrawingExport())
				.catch(() => undefined);
	}, [open]);
	const fieldLabel =
		"flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted";
	return (
		<AppDialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onClose();
			}}
			size="sm"
			title="Export drawing"
			description={
				format === "pdf"
					? "The grid, selection and editor controls are left out."
					: "Content is fitted without stretching. The grid, selection and editor controls are left out."
			}
			footer={
				<>
					<button
						type="button"
						className="ui-button"
						data-variant="ghost"
						data-size="md"
						disabled={busy}
						onClick={() => onClose()}
					>
						Cancel
					</button>
					<button
						className="ui-button"
						data-variant="primary"
						data-size="md"
						disabled={busy}
						type="submit"
						form={formId}
					>
						{busy ? "Exporting..." : "Download"}
					</button>
				</>
			}
		>
			<form
				id={formId}
				className={`${dialogBodyClassName} flex flex-col gap-3.5`}
				onSubmit={async (event) => {
					event.preventDefault();
					if (busy) return;
					setBusy(true);
					setError("");
					try {
						await measurePerformanceAsync(
							"drawing.export",
							async () => {
								const [{ exportDrawing }, fills] = await Promise.all([
									import("#/drawing/export-client.ts"),
									zoneFills?.(),
								]);
								downloadPng(
									await exportDrawing(
										shapes,
										{
											width,
											height,
											area,
											background,
											sheet,
											title: label,
											layers: layered,
											...(fills ? { zoneFills: fills } : {}),
											...(maskMargin === undefined ? {} : { maskMargin }),
											...(copperLayers === undefined ? {} : { copperLayers }),
										},
										format,
									),
									label,
									format,
								);
							},
							{ shapes: shapes.length, width, height, format },
						);
						onClose();
						toastManager.add({
							type: "success",
							title: "Drawing exported",
							description: `${format.toUpperCase()} download is ready.`,
						});
					} catch (cause) {
						setError(errorMessage(cause, "Export failed."));
					} finally {
						setBusy(false);
					}
				}}
			>
				<label className={fieldLabel}>
					Output
					<select
						className="ui-select h-8 w-full"
						value={area}
						onChange={(e) => setArea(e.target.value as typeof area)}
					>
						<option value="sheet">Full sheet and drawing</option>
						<option value="drawing">Drawing only</option>
					</select>
				</label>
				<div className="grid grid-cols-2 gap-3">
					<label className={fieldLabel}>
						Format
						<select
							className="ui-select h-8 w-full"
							value={format}
							onChange={(e) => setFormat(e.target.value as typeof format)}
						>
							<option value="png">PNG</option>
							<option value="svg">SVG vector</option>
							<option value="pdf">PDF vector</option>
						</select>
					</label>
					<label className={fieldLabel}>
						Background
						<select
							className="ui-select h-8 w-full"
							value={background}
							onChange={(e) =>
								setBackground(e.target.value as typeof background)
							}
						>
							<option value="white">White</option>
							<option value="dark">Dark</option>
							<option value="transparent">Transparent</option>
						</select>
					</label>
				</div>
				{format === "pdf" ? (
					<p className="m-0 text-xs text-fg-faint">
						{layered ? "Each layer gets its own page. " : ""}
						{area === "sheet"
							? `${layered ? "Pages are" : "The page is"} the ${sheet.width} × ${sheet.height} mm sheet at 1:1 scale.`
							: `${layered ? "Pages fit" : "The page fits"} the drawing at 1:1 scale in millimetres.`}{" "}
						Text can be searched and copied.
					</p>
				) : (
					<>
						<div className="grid grid-cols-2 gap-3">
							<label className={fieldLabel}>
								Width in pixels
								<input
									className="ui-input h-8 w-full"
									type="number"
									min="1"
									max="16384"
									required
									value={width}
									onChange={(e) => setWidth(e.target.valueAsNumber)}
								/>
							</label>
							<label className={fieldLabel}>
								Height in pixels
								<input
									className="ui-input h-8 w-full"
									type="number"
									min="1"
									max="16384"
									required
									value={height}
									onChange={(e) => setHeight(e.target.valueAsNumber)}
								/>
							</label>
						</div>
						<p className="m-0 text-xs text-fg-faint">
							SVG text stays sharp at any zoom.
						</p>
					</>
				)}
				{error && (
					<p role="alert" className="m-0 text-sm text-danger">
						{error}
					</p>
				)}
			</form>
		</AppDialog>
	);
}
