import { useState } from "react";
import { createPortal } from "react-dom";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import { exportDrawingSvg } from "#/drawing/export.ts";
import type { EditorShape } from "#/drawing/shapes.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { captureSvgPng } from "#/engine/capture-png.ts";
import { measureText } from "#/engine/drawing/text.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

export function DrawingExport({
	shapes,
	sheet,
	label,
	disabled,
}: {
	shapes: EditorShape[];
	sheet: SheetSize;
	label: string;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [width, setWidth] = useState(9600);
	const [height, setHeight] = useState(6400);
	const [area, setArea] = useState<"sheet" | "drawing">("sheet");
	const [background, setBackground] = useState<
		"white" | "dark" | "transparent"
	>("white");
	const [format, setFormat] = useState("png");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const field = "rounded border border-white/30 bg-slate-800 p-2 text-white";
	return (
		<>
			<button
				type="button"
				disabled={disabled}
				className="rounded px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40"
				onClick={() => setOpen(true)}
			>
				Export drawing
			</button>
			{open &&
				createPortal(
					<dialog
						ref={(node) => {
							if (node && !node.open) node.showModal();
						}}
						aria-label="Export drawing"
						onCancel={(event) => {
							event.preventDefault();
							if (!busy) setOpen(false);
						}}
						className="fixed inset-0 m-auto max-h-[calc(100%-2rem)] overflow-y-auto bg-transparent p-0 backdrop:bg-black/60"
						onPointerDown={(event) => event.stopPropagation()}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Escape" && !busy) setOpen(false);
						}}
					>
						<form
							className="flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-4 rounded-xl border border-white/20 bg-slate-900 p-6 text-sm text-white shadow-xl"
							onSubmit={async (event) => {
								event.preventDefault();
								if (busy) return;
								setBusy(true);
								setError("");
								try {
									await measurePerformanceAsync(
										"drawing.export",
										async () => {
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
																	? "#111318"
																	: "white",
														);
											downloadPng(blob, label, format);
										},
										{ shapes: shapes.length, width, height, format },
									);
								} catch (cause) {
									setError(
										cause instanceof Error ? cause.message : "Export failed.",
									);
								} finally {
									setBusy(false);
								}
							}}
						>
							<h2 className="text-lg font-semibold">Export drawing</h2>
							<label className="flex flex-col gap-1">
								Output
								<select
									className={field}
									value={area}
									onChange={(e) => setArea(e.target.value as typeof area)}
								>
									<option value="sheet">Full sheet and drawing</option>
									<option value="drawing">Drawing only</option>
								</select>
							</label>
							<label className="flex flex-col gap-1">
								Format
								<select
									className={field}
									value={format}
									onChange={(e) => setFormat(e.target.value)}
								>
									<option value="png">PNG</option>
									<option value="svg">SVG vector</option>
								</select>
							</label>
							<div className="grid grid-cols-2 gap-3">
								<label className="flex flex-col gap-1">
									Width in pixels
									<input
										className={field}
										type="number"
										min="1"
										max="16384"
										required
										value={width}
										onChange={(e) => setWidth(e.target.valueAsNumber)}
									/>
								</label>
								<label className="flex flex-col gap-1">
									Height in pixels
									<input
										className={field}
										type="number"
										min="1"
										max="16384"
										required
										value={height}
										onChange={(e) => setHeight(e.target.valueAsNumber)}
									/>
								</label>
							</div>
							<label className="flex flex-col gap-1">
								Background
								<select
									className={field}
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
							<p className="text-slate-300">
								Fits all content without stretching. No grid, selection or
								editor controls. SVG text stays sharp at any zoom.
							</p>
							{error && (
								<p role="alert" className="text-red-300">
									{error}
								</p>
							)}
							<div className="flex justify-end gap-3">
								<button
									type="button"
									disabled={busy}
									onClick={() => setOpen(false)}
								>
									Close
								</button>
								<button
									className="rounded bg-amber-200 px-4 py-2 text-slate-950 disabled:opacity-50"
									disabled={busy}
									type="submit"
								>
									{busy ? "Exporting..." : "Download"}
								</button>
							</div>
						</form>
					</dialog>,
					document.body,
				)}
		</>
	);
}
