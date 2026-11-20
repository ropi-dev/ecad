import type { EditorShape } from "@ecad/drawing-core/drawing/shapes.ts";
import { errorMessage } from "@ecad/drawing-core/lib/error-message.ts";
import { createEffect, createSignal, createUniqueId, Show } from "solid-js";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";
import { toastManager } from "#/components/ui/toast.ts";
import { downloadPng } from "#/components/viewer/exportPng.ts";
import type { DrawingZoneFill } from "#/drawing/export.ts";
import type { DrawingExportFormat } from "#/drawing/export-client.ts";
import type { SheetSize } from "#/drawing/worksheet.ts";
import { measurePerformanceAsync } from "#/performance/runtime.ts";

const setNumber = (set: (value: number) => void, value: number) => {
	if (!Number.isNaN(value)) set(value);
};
const fieldLabel =
	"flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted";

/** Export dialog. It stays mounted while closed to keep the chosen settings. */
export function DrawingExport(props: {
	shapes: EditorShape[];
	sheet: SheetSize;
	label: string;
	layered?: boolean;
	zoneFills?: (() => Promise<readonly DrawingZoneFill[]>) | undefined;
	maskMargin?: number | undefined;
	copperLayers?: number | undefined;
	open: boolean;
	onClose: () => void;
}) {
	const [width, setWidth] = createSignal(9600);
	const [height, setHeight] = createSignal(6400);
	const [area, setArea] = createSignal<"sheet" | "drawing">("sheet");
	const [background, setBackground] = createSignal<
		"white" | "dark" | "transparent"
	>("white");
	const [format, setFormat] = createSignal<DrawingExportFormat>("png");
	const [busy, setBusy] = createSignal(false);
	const [error, setError] = createSignal("");
	const formId = createUniqueId();
	const layered = () => props.layered ?? false;
	createEffect(
		() => props.open,
		(open) => {
			if (open)
				void import("#/drawing/export-client.ts")
					.then(({ warmDrawingExport }) => warmDrawingExport())
					.catch(() => undefined);
		},
	);
	return (
		<AppDialog
			open={props.open}
			onOpenChange={(next) => {
				if (!next && !busy()) props.onClose();
			}}
			size="sm"
			title="Export drawing"
			description={
				format() === "pdf"
					? "The grid, selection and editor controls are left out."
					: "Content is fitted without stretching. The grid, selection and editor controls are left out."
			}
			footer={
				<>
					<button
						type="button"
						class="ui-button"
						data-variant="ghost"
						data-size="md"
						disabled={busy()}
						onClick={() => props.onClose()}
					>
						Cancel
					</button>
					<button
						class="ui-button"
						data-variant="primary"
						data-size="md"
						disabled={busy()}
						type="submit"
						form={formId}
					>
						{busy() ? "Exporting..." : "Download"}
					</button>
				</>
			}
		>
			<form
				id={formId}
				class={`${dialogBodyClassName} flex flex-col gap-3.5`}
				onSubmit={async (event) => {
					event.preventDefault();
					if (busy()) return;
					setBusy(true);
					setError("");
					const shapes = props.shapes;
					const label = props.label;
					const chosen = format();
					const size = { width: width(), height: height() };
					const zoneFills = props.zoneFills;
					const maskMargin = props.maskMargin;
					const copperLayers = props.copperLayers;
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
											...size,
											area: area(),
											background: background(),
											sheet: props.sheet,
											title: label,
											layers: layered(),
											...(fills ? { zoneFills: fills } : {}),
											...(maskMargin === undefined ? {} : { maskMargin }),
											...(copperLayers === undefined ? {} : { copperLayers }),
										},
										chosen,
									),
									label,
									chosen,
								);
							},
							{ shapes: shapes.length, ...size, format: chosen },
						);
						props.onClose();
						toastManager.add({
							type: "success",
							title: "Drawing exported",
							description: `${chosen.toUpperCase()} download is ready.`,
						});
					} catch (cause) {
						setError(errorMessage(cause, "Export failed."));
					} finally {
						setBusy(false);
					}
				}}
			>
				<label class={fieldLabel}>
					Output
					<select
						class="ui-select h-8 w-full"
						value={area()}
						onChange={(e) =>
							setArea(e.currentTarget.value as ReturnType<typeof area>)
						}
					>
						<option value="sheet">Full sheet and drawing</option>
						<option value="drawing">Drawing only</option>
					</select>
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class={fieldLabel}>
						Format
						<select
							class="ui-select h-8 w-full"
							value={format()}
							onChange={(e) =>
								setFormat(e.currentTarget.value as DrawingExportFormat)
							}
						>
							<option value="png">PNG</option>
							<option value="svg">SVG vector</option>
							<option value="pdf">PDF vector</option>
						</select>
					</label>
					<label class={fieldLabel}>
						Background
						<select
							class="ui-select h-8 w-full"
							value={background()}
							onChange={(e) =>
								setBackground(
									e.currentTarget.value as ReturnType<typeof background>,
								)
							}
						>
							<option value="white">White</option>
							<option value="dark">Dark</option>
							<option value="transparent">Transparent</option>
						</select>
					</label>
				</div>
				<Show
					when={format() === "pdf"}
					fallback={
						<>
							<div class="grid grid-cols-2 gap-3">
								<label class={fieldLabel}>
									Width in pixels
									<input
										class="ui-input h-8 w-full"
										type="number"
										min="1"
										max="16384"
										required
										value={width()}
										onInput={(e) =>
											setNumber(setWidth, e.currentTarget.valueAsNumber)
										}
									/>
								</label>
								<label class={fieldLabel}>
									Height in pixels
									<input
										class="ui-input h-8 w-full"
										type="number"
										min="1"
										max="16384"
										required
										value={height()}
										onInput={(e) =>
											setNumber(setHeight, e.currentTarget.valueAsNumber)
										}
									/>
								</label>
							</div>
							<p class="m-0 text-xs text-fg-faint">
								SVG text stays sharp at any zoom.
							</p>
						</>
					}
				>
					<p class="m-0 text-xs text-fg-faint">
						{layered() ? "Each layer gets its own page. " : ""}
						{area() === "sheet"
							? `${layered() ? "Pages are" : "The page is"} the ${props.sheet.width} × ${props.sheet.height} mm sheet at 1:1 scale.`
							: `${layered() ? "Pages fit" : "The page fits"} the drawing at 1:1 scale in millimetres.`}{" "}
						Text can be searched and copied.
					</p>
				</Show>
				<Show when={error()}>
					<p role="alert" class="m-0 text-sm text-danger">
						{error()}
					</p>
				</Show>
			</form>
		</AppDialog>
	);
}
