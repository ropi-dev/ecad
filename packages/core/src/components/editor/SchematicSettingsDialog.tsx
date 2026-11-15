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
import { useId, useState } from "react";
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

export function SchematicSettingsDialog({
	sheet,
	onSave,
	onClose,
}: {
	sheet: SheetSettings | undefined;
	onSave: (sheet: SheetSettings) => boolean;
	onClose: () => void;
}) {
	const formId = useId();
	const initialPaper = sheetPaper(sheet);
	const [paper, setPaper] = useState<PaperSize | "custom">(
		sheet?.paper ?? DEFAULT_PAPER,
	);
	const [portrait, setPortrait] = useState(sheet?.portrait ?? false);
	const [width, setWidth] = useState(formatMm(initialPaper.width));
	const [height, setHeight] = useState(formatMm(initialPaper.height));
	const [title, setTitle] = useState(sheet?.title ?? "");
	const [date, setDate] = useState(sheet?.date ?? "");
	const [revision, setRevision] = useState(sheet?.revision ?? "");
	const [company, setCompany] = useState(sheet?.company ?? "");
	const [comments, setComments] = useState(() =>
		Array.from(
			{ length: SHEET_COMMENT_COUNT },
			(_, index) => sheet?.comments?.[index] ?? "",
		),
	);
	const [error, setError] = useState("");
	const custom = paper === "custom";
	const choosePaper = (next: PaperSize | "custom") => {
		if (next === "custom" && !custom) {
			const current = sheetPaper({ paper, portrait });
			setWidth(formatMm(current.width));
			setHeight(formatMm(current.height));
		}
		setPaper(next);
	};
	const text = (
		label: string,
		value: string,
		set: (value: string) => void,
		options: { name?: string } = {},
	) => (
		<label className={fieldLabel}>
			{label}
			<input
				className="ui-input h-8 w-full"
				name={options.name}
				maxLength={SHEET_TEXT_LIMIT}
				value={value}
				onChange={(event) => set(event.target.value)}
			/>
		</label>
	);
	const dimension = (
		label: string,
		value: string,
		set: (value: string) => void,
	) => (
		<label className={fieldLabel}>
			{label}
			<input
				className="ui-input h-8 w-full tabular-nums"
				type="number"
				min={CUSTOM_SHEET_MIN}
				max={CUSTOM_SHEET_MAX}
				step="any"
				required
				value={value}
				onChange={(event) => set(event.target.value)}
			/>
		</label>
	);

	return (
		<AppDialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			title="Schematic settings"
			description="Paper size and title block for every page of this schematic."
			footer={
				<>
					<button
						type="button"
						className="ui-button"
						data-variant="ghost"
						data-size="md"
						onClick={onClose}
					>
						Cancel
					</button>
					<button
						type="submit"
						form={formId}
						className="ui-button"
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
				className={`${dialogBodyClassName} flex max-h-[min(36rem,calc(100dvh-12rem))] flex-col gap-3.5`}
				onSubmit={(event) => {
					event.preventDefault();
					const parsed = sheetSettingsSchema.safeParse({
						paper,
						...(custom
							? { width: Number(width), height: Number(height) }
							: { portrait }),
						title,
						date,
						revision,
						company,
						comments,
					});
					if (!parsed.success) {
						setError(
							parsed.error.issues[0]?.message ?? "Check the sheet settings.",
						);
						return;
					}
					setError("");
					if (onSave(parsed.data)) onClose();
				}}
			>
				<fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
					<legend className="mb-2 p-0 text-sm font-semibold text-fg">
						Paper
					</legend>
					<div className="grid grid-cols-2 gap-3">
						<label className={fieldLabel}>
							Size
							<select
								className="ui-select h-8 w-full"
								value={paper}
								onChange={(event) =>
									choosePaper(event.target.value as PaperSize | "custom")
								}
							>
								{paperNames.map((name) => {
									const size = PAPER_SIZES[name];
									return (
										<option key={name} value={name}>
											{`${name} (${formatMm(size.width)} × ${formatMm(size.height)} mm)`}
										</option>
									);
								})}
								<option value="custom">Custom</option>
							</select>
						</label>
						<label className={fieldLabel}>
							Orientation
							<select
								className="ui-select h-8 w-full"
								value={portrait ? "portrait" : "landscape"}
								disabled={custom}
								onChange={(event) =>
									setPortrait(event.target.value === "portrait")
								}
							>
								<option value="landscape">Landscape</option>
								<option value="portrait">Portrait</option>
							</select>
						</label>
					</div>
					{custom && (
						<div className="grid grid-cols-2 gap-3">
							{dimension("Width in mm", width, setWidth)}
							{dimension("Height in mm", height, setHeight)}
						</div>
					)}
				</fieldset>
				<fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
					<legend className="mb-2 p-0 text-sm font-semibold text-fg">
						Title block
					</legend>
					{text("Title", title, setTitle, { name: "title" })}
					<div className="grid grid-cols-[1fr_7rem] gap-3">
						<label className={fieldLabel}>
							Date
							<span className="flex gap-1.5">
								<input
									className="ui-input h-8 min-w-0 flex-1"
									name="date"
									maxLength={SHEET_TEXT_LIMIT}
									placeholder="YYYY-MM-DD"
									value={date}
									onChange={(event) => setDate(event.target.value)}
								/>
								<button
									type="button"
									className="ui-button"
									data-variant="secondary"
									data-size="md"
									onClick={() => setDate(today())}
								>
									Today
								</button>
							</span>
						</label>
						{text("Revision", revision, setRevision, { name: "revision" })}
					</div>
					{text("Company", company, setCompany, { name: "company" })}
					{commentLines.map((line, index) => (
						<label key={line} className={fieldLabel}>
							{line}
							<input
								className="ui-input h-8 w-full"
								maxLength={SHEET_TEXT_LIMIT}
								value={comments[index]}
								onChange={(event) =>
									setComments((current) =>
										current.map((value, at) =>
											at === index ? event.target.value : value,
										),
									)
								}
							/>
						</label>
					))}
				</fieldset>
				{error && (
					<p role="alert" className="m-0 text-sm text-danger">
						{error}
					</p>
				)}
			</form>
		</AppDialog>
	);
}
