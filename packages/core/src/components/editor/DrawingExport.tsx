import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { X } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
import {
	DialogHeader,
	dialogBodyClassName,
	dialogCloseClassName,
	dialogDescriptionClassName,
	dialogFooterClassName,
	dialogTitleClassName,
} from "#/components/ui/Dialog.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import { darkSchematicTheme } from "#/drawing/schematic-theme.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { captureSvgPng } from "#/engine/capture-png.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

/** Export dialog. It stays mounted while closed to keep the chosen settings. */
export function DrawingExport({
	shapes,
	sheet,
	label,
	open,
	onClose,
}: {
	shapes: EditorShape[];
	sheet: SheetSize;
	label: string;
	open: boolean;
	onClose: () => void;
}) {
	const [width, setWidth] = useState(9600);
	const [height, setHeight] = useState(6400);
	const [area, setArea] = useState<"sheet" | "drawing">("sheet");
	const [background, setBackground] = useState<
		"white" | "dark" | "transparent"
	>("white");
	const [format, setFormat] = useState("png");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const titleId = useId();
	const fieldLabel =
		"flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted";
	return (
		<>
			{open &&
				createPortal(
					<dialog
						ref={(node) => {
							if (node && !node.open) node.showModal();
						}}
						aria-labelledby={titleId}
						onCancel={(event) => {
							event.preventDefault();
							if (!busy) onClose();
						}}
						className="ui-dialog fixed inset-0 m-auto max-w-sm overflow-hidden"
						onPointerDown={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape" && !busy) onClose();
						}}
					>
						<form
							className="flex min-h-0 flex-1 flex-col"
							onSubmit={async (event) => {
								event.preventDefault();
								if (busy) return;
								setBusy(true);
								setError("");
								try {
									await measurePerformanceAsync(
										"drawing.export",
										async () => {
											const { exportDrawingSvg } = await import(
												"#/drawing/export.ts"
											);
											const svg = exportDrawingSvg(shapes, {
												width,
												height,
												area,
												background,
												sheet,
												measureText,
											});
											const blob =
												format === "svg"
													? new Blob([svg], { type: "image/svg+xml" })
													: await captureSvgPng(
															svg,
															width,
															height,
															background === "transparent"
																? null
																: background === "dark"
																	? darkSchematicTheme.paper
																	: "white",
														);
											downloadPng(blob, label, format);
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
							<DialogHeader
								title={
									<h2 id={titleId} className={dialogTitleClassName}>
										Export drawing
									</h2>
								}
								description={
									<p className={dialogDescriptionClassName}>
										Content is fitted without stretching. The grid, selection
										and editor controls are left out.
									</p>
								}
							/>
							<div className={`${dialogBodyClassName} flex flex-col gap-3.5`}>
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
											onChange={(e) => setFormat(e.target.value)}
										>
											<option value="png">PNG</option>
											<option value="svg">SVG vector</option>
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
								{error && (
									<p role="alert" className="m-0 text-sm text-danger">
										{error}
									</p>
								)}
							</div>
							<footer className={dialogFooterClassName}>
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
								>
									{busy ? "Exporting..." : "Download"}
								</button>
							</footer>
							<button
								type="button"
								aria-label="Close dialog"
								className={dialogCloseClassName}
								disabled={busy}
								onClick={() => onClose()}
							>
								<X size={16} aria-hidden="true" />
							</button>
						</form>
					</dialog>,
					document.body,
				)}
		</>
	);
}
