import {
	type EditorSymbol,
	symbolShapes,
} from "@ecad/drawing-core/drawing/shapes.ts";
import {
	type FootprintReference,
	footprintKey,
	matchPinsToPads,
	symbolPinNumbers,
} from "@ecad/drawing-core/footprint/reference.ts";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onSettled,
	Show,
} from "solid-js";
import type { FootprintFile } from "#/footprint/format.ts";
import {
	footprintPadNumbers,
	useBuiltinFootprints,
} from "#/footprint/library.ts";

export interface FootprintChoices {
	readonly project: readonly FootprintFile[];
	readonly onOpen?: (id: string) => void;
	/** Copies a built-in footprint into the project and returns the copy's ID. */
	readonly onCopy?: (id: string) => Promise<string>;
}

const list = (numbers: readonly string[]) =>
	numbers.length > 6
		? `${numbers.slice(0, 6).join(", ")} and ${numbers.length - 6} more`
		: numbers.join(", ");

const plural = (count: number, word: string) =>
	`${word}${count === 1 ? "" : "s"}`;

export function SymbolFootprintField(props: {
	symbol: EditorSymbol;
	choices: FootprintChoices;
	onChange: (footprint: FootprintReference | undefined) => void;
}) {
	const builtin = useBuiltinFootprints();
	const [copying, setCopying] = createSignal(false);
	const [copyError, setCopyError] = createSignal("");
	let mounted = true;
	onSettled(() => () => {
		mounted = false;
	});
	const current = () => props.symbol.footprint;
	const file = createMemo(() => {
		const reference = current();
		if (!reference) return undefined;
		return reference.library === "builtin"
			? builtin.library?.byId.get(reference.id)?.file
			: props.choices.project.find(({ id }) => id === reference.id);
	});
	const waiting = () => current()?.library === "builtin" && !builtin.library;
	const loading = () => waiting() && !builtin.failed;
	const missing = () => current() !== undefined && !waiting() && !file();
	const pins = createMemo(() =>
		symbolPinNumbers(
			symbolShapes(props.symbol).filter((child) => child.kind === "pin"),
		),
	);
	const match = createMemo(() => {
		const footprint = file();
		return footprint
			? matchPinsToPads(pins(), footprintPadNumbers(footprint.shapes))
			: undefined;
	});
	const mismatched = () => {
		const result = match();
		return (
			!!result &&
			(result.pinsWithoutPads.length > 0 || result.padsWithoutPins.length > 0)
		);
	};
	const status = () => {
		const reference = current();
		const result = match();
		if (!reference) return "No footprint assigned.";
		if (waiting() && builtin.failed)
			return "The built-in footprints could not be loaded. Reload the page to try again.";
		if (loading()) return "Loading built-in footprints...";
		if (missing())
			return reference.library === "project"
				? "This footprint is not in the project."
				: "This footprint is not in the built-in library.";
		if (result && mismatched())
			return [
				result.pinsWithoutPads.length > 0 &&
					`No pad for ${plural(result.pinsWithoutPads.length, "pin")} ${list(result.pinsWithoutPads)}.`,
				result.padsWithoutPins.length > 0 &&
					`No pin for ${plural(result.padsWithoutPins.length, "pad")} ${list(result.padsWithoutPins)}.`,
			]
				.filter(Boolean)
				.join(" ");
		return `Pads match all ${pins().length} ${plural(pins().length, "pin")}.`;
	};
	const selected = createMemo(() => {
		const reference = current();
		return reference ? footprintKey(reference) : "";
	});
	let select!: HTMLSelectElement;
	createEffect(
		() => [selected(), builtin.library, props.choices.project] as const,
		([value]) => {
			select.value = value;
		},
	);
	const copy = async () => {
		const reference = current();
		if (!reference) return;
		setCopying(true);
		setCopyError("");
		try {
			const id = await props.choices.onCopy?.(reference.id);
			if (id && mounted) props.onChange({ library: "project", id });
		} catch (cause) {
			if (mounted)
				setCopyError(
					cause instanceof Error
						? cause.message
						: "The footprint could not be copied.",
				);
		} finally {
			if (mounted) setCopying(false);
		}
	};
	return (
		<div class="flex flex-col gap-1.5">
			<select
				aria-label="Footprint"
				aria-describedby={`footprint-status-${props.symbol.id}`}
				class="ui-select w-full overflow-clip whitespace-nowrap [overflow-clip-margin:content-box]"
				title={file()?.name}
				ref={select}
				onChange={(event) => {
					const [library, id] = event.currentTarget.value.split(/:(.*)/s);
					props.onChange(
						library === "builtin" || library === "project"
							? { library, id }
							: undefined,
					);
				}}
			>
				<option value="">None</option>
				<Show when={(waiting() || missing()) && current()}>
					{(reference) => (
						<option value={footprintKey(reference())}>
							{waiting() ? reference().id : `${reference().id} (missing)`}
						</option>
					)}
				</Show>
				{props.choices.project.length > 0 && (
					<optgroup label="Project footprints">
						<For each={props.choices.project}>
							{(footprint) => (
								<option value={`project:${footprint.id}`}>
									{footprint.name}
								</option>
							)}
						</For>
					</optgroup>
				)}
				<For each={builtin.library?.categories}>
					{(category) => (
						<optgroup label={category}>
							<For
								each={builtin.library?.footprints.filter(
									(footprint) => footprint.category === category,
								)}
							>
								{(footprint) => (
									<option value={`builtin:${footprint.file.id}`}>
										{footprint.file.name}
									</option>
								)}
							</For>
						</optgroup>
					)}
				</For>
			</select>
			<p
				id={`footprint-status-${props.symbol.id}`}
				class={[
					"m-0 text-xs",
					missing() || mismatched() || (waiting() && builtin.failed)
						? "text-warning"
						: "text-fg-faint",
				]}
			>
				{status()}
			</p>
			{builtin.failed && !waiting() && (
				<p class="m-0 text-xs text-warning">
					The built-in footprints could not be loaded. Reload the page to try
					again.
				</p>
			)}
			{file() && current()?.library === "project" && props.choices.onOpen && (
				<button
					type="button"
					class="ui-button w-full"
					data-variant="secondary"
					onClick={() => {
						const reference = current();
						if (reference) props.choices.onOpen?.(reference.id);
					}}
				>
					Open footprint
				</button>
			)}
			{file() && current()?.library === "builtin" && props.choices.onCopy && (
				<button
					type="button"
					class="ui-button w-full"
					data-variant="secondary"
					disabled={copying()}
					title="Copy this footprint into the project to edit it, and use the copy here"
					onClick={() => void copy()}
				>
					{copying() ? "Copying..." : "Copy to project"}
				</button>
			)}
			<Show when={copyError()}>
				<p role="alert" class="m-0 text-xs text-danger">
					{copyError()}
				</p>
			</Show>
		</div>
	);
}
