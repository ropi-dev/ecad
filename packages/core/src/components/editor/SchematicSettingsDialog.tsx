import {
	CUSTOM_SHEET_MAX,
	CUSTOM_SHEET_MIN,
	DEFAULT_PAPER,
	PAPER_SIZES,
	type PaperSize,
	SHEET_COMMENT_COUNT,
	SHEET_TEXT_LIMIT,
	type SheetSettings,
	sheetPaper,
	sheetSettingsSchema,
} from "@ecad/drawing-core/drawing/sheet.ts";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { AppDialog, dialogBodyClassName } from "#/components/ui/Dialog.tsx";

const fieldLabel =
	"flex min-w-0 flex-col gap-1.5 text-xs font-medium text-fg-muted";
const paperNames = Object.keys(PAPER_SIZES) as PaperSize[];
const commentLines = Array.from(
	{ length: SHEET_COMMENT_COUNT },
	(_, index) => `Comment ${index + 1}`,
);

function formatMm(value: number) {
	return `${Number(value.toFixed(1))}`;
}

function today() {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function TextField(props: {
	label: string;
	value: string;
	onValue: (value: string) => void;
	name?: string;
}) {
	return (
		<label class={fieldLabel}>
			{props.label}
			<input
				class="ui-input h-8 w-full"
				name={props.name}
				maxlength={SHEET_TEXT_LIMIT}
				value={props.value}
				onInput={(event) => props.onValue(event.currentTarget.value)}
			/>
		</label>
	);
}

function DimensionField(props: {
	label: string;
	value: string;
	onValue: (value: string) => void;
}) {
	return (
		<label class={fieldLabel}>
			{props.label}
			<input
				class="ui-input h-8 w-full tabular-nums"
				type="number"
				min={CUSTOM_SHEET_MIN}
				max={CUSTOM_SHEET_MAX}
				step="any"
				required
				value={props.value}
				onInput={(event) => props.onValue(event.currentTarget.value)}
			/>
		</label>
	);
}

export function SchematicSettingsDialog(props: {
	sheet: SheetSettings | undefined;
	onSave: (sheet: SheetSettings) => boolean;
	onClose: () => void;
}) {
	const formId = createUniqueId();
	const sheet = untrack(() => props.sheet);
	const [paper, setPaper] = createSignal<PaperSize | "custom">(
		sheet?.paper ?? DEFAULT_PAPER,
	);
	const [portrait, setPortrait] = createSignal(sheet?.portrait ?? false);
	const [width, setWidth] = createSignal(formatMm(sheetPaper(sheet).width));
	const [height, setHeight] = createSignal(formatMm(sheetPaper(sheet).height));
	const [title, setTitle] = createSignal(sheet?.title ?? "");
	const [date, setDate] = createSignal(sheet?.date ?? "");
	const [revision, setRevision] = createSignal(sheet?.revision ?? "");
	const [company, setCompany] = createSignal(sheet?.company ?? "");
	const [comments, setComments] = createSignal(
		Array.from(
			{ length: SHEET_COMMENT_COUNT },
			(_, index) => sheet?.comments?.[index] ?? "",
		),
	);
	const [error, setError] = createSignal("");
	const custom = () => paper() === "custom";
	const choosePaper = (next: PaperSize | "custom") => {
		if (next === "custom" && !custom()) {
			const current = sheetPaper({ paper: paper(), portrait: portrait() });
			setWidth(formatMm(current.width));
			setHeight(formatMm(current.height));
		}
		setPaper(next);
	};

	return (
		<AppDialog
			open
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
			title="Schematic settings"
			description="Paper size and title block for every page of this schematic."
			footer={
				<>
					<button
						type="button"
						class="ui-button"
						data-variant="ghost"
						data-size="md"
						onClick={() => props.onClose()}
					>
						Cancel
					</button>
					<button
						type="submit"
						form={formId}
						class="ui-button"
						data-variant="primary"
						data-size="md"
					>
						Save
					</button>
				</>
			}
		>
			<form
				id={formId}
				class={`${dialogBodyClassName} flex max-h-[min(36rem,calc(100dvh-12rem))] flex-col gap-3.5`}
				onSubmit={(event) => {
					event.preventDefault();
					const parsed = sheetSettingsSchema.safeParse({
						paper: paper(),
						...(custom()
							? { width: Number(width()), height: Number(height()) }
							: { portrait: portrait() }),
						title: title(),
						date: date(),
						revision: revision(),
						company: company(),
						comments: comments(),
					});
					if (!parsed.success) {
						setError(
							parsed.error.issues[0]?.message ?? "Check the sheet settings.",
						);
						return;
					}
					setError("");
					if (props.onSave(parsed.data)) props.onClose();
				}}
			>
				<fieldset class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
					<legend class="mb-2 p-0 text-sm font-semibold text-fg">Paper</legend>
					<div class="grid grid-cols-2 gap-3">
						<label class={fieldLabel}>
							Size
							<select
								class="ui-select h-8 w-full"
								value={paper()}
								onChange={(event) =>
									choosePaper(event.currentTarget.value as PaperSize | "custom")
								}
							>
								<For each={paperNames}>
									{(name) => (
										<option value={name} selected={paper() === name}>
											{`${name} (${formatMm(PAPER_SIZES[name].width)} × ${formatMm(PAPER_SIZES[name].height)} mm)`}
										</option>
									)}
								</For>
								<option value="custom" selected={custom()}>
									Custom
								</option>
							</select>
						</label>
						<label class={fieldLabel}>
							Orientation
							<select
								class="ui-select h-8 w-full"
								value={portrait() ? "portrait" : "landscape"}
								disabled={custom()}
								onChange={(event) =>
									setPortrait(event.currentTarget.value === "portrait")
								}
							>
								<option value="landscape">Landscape</option>
								<option value="portrait">Portrait</option>
							</select>
						</label>
					</div>
					{custom() && (
						<div class="grid grid-cols-2 gap-3">
							<DimensionField
								label="Width in mm"
								value={width()}
								onValue={setWidth}
							/>
							<DimensionField
								label="Height in mm"
								value={height()}
								onValue={setHeight}
							/>
						</div>
					)}
				</fieldset>
				<fieldset class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
					<legend class="mb-2 p-0 text-sm font-semibold text-fg">
						Title block
					</legend>
					<TextField
						label="Title"
						name="title"
						value={title()}
						onValue={setTitle}
					/>
					<div class="grid grid-cols-[1fr_7rem] gap-3">
						<label class={fieldLabel}>
							Date
							<span class="flex gap-1.5">
								<input
									class="ui-input h-8 min-w-0 flex-1"
									name="date"
									maxlength={SHEET_TEXT_LIMIT}
									placeholder="YYYY-MM-DD"
									value={date()}
									onInput={(event) => setDate(event.currentTarget.value)}
								/>
								<button
									type="button"
									class="ui-button"
									data-variant="secondary"
									data-size="md"
									onClick={() => setDate(today())}
								>
									Today
								</button>
							</span>
						</label>
						<TextField
							label="Revision"
							name="revision"
							value={revision()}
							onValue={setRevision}
						/>
					</div>
					<TextField
						label="Company"
						name="company"
						value={company()}
						onValue={setCompany}
					/>
					<For each={commentLines}>
						{(line, index) => (
							<TextField
								label={line}
								value={comments()[index()]}
								onValue={(value) =>
									setComments((current) =>
										current.map((entry, at) =>
											at === index() ? value : entry,
										),
									)
								}
							/>
						)}
					</For>
				</fieldset>
				<Show when={error()}>
					<p role="alert" class="m-0 text-sm text-danger">
						{error()}
					</p>
				</Show>
			</form>
		</AppDialog>
	);
}
