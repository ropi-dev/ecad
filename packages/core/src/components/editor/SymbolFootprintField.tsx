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
import { useEffect, useRef, useState } from "react";
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

export function SymbolFootprintField({
	symbol,
	choices,
	onChange,
}: {
	symbol: EditorSymbol;
	choices: FootprintChoices;
	onChange: (footprint: FootprintReference | undefined) => void;
}) {
	const builtin = useBuiltinFootprints();
	const [copying, setCopying] = useState(false);
	const [copyError, setCopyError] = useState("");
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const current = symbol.footprint;
	const file =
		current?.library === "builtin"
			? builtin?.byId.get(current.id)?.file
			: current
				? choices.project.find(({ id }) => id === current.id)
				: undefined;
	const loading = current?.library === "builtin" && !builtin;
	const missing = current !== undefined && !loading && !file;
	const pins = symbolPinNumbers(
		symbolShapes(symbol).filter((child) => child.kind === "pin"),
	);
	const match = file
		? matchPinsToPads(pins, footprintPadNumbers(file.shapes))
		: undefined;
	const mismatched =
		match &&
		(match.pinsWithoutPads.length > 0 || match.padsWithoutPins.length > 0);
	return (
		<div className="flex flex-col gap-1.5">
			<select
				aria-label="Footprint"
				aria-describedby={`footprint-status-${symbol.id}`}
				className="ui-select w-full overflow-clip whitespace-nowrap [overflow-clip-margin:content-box]"
				title={file?.name}
				value={current ? footprintKey(current) : ""}
				disabled={!builtin}
				onChange={(event) => {
					const [library, id] = event.currentTarget.value.split(/:(.*)/s);
					onChange(
						library === "builtin" || library === "project"
							? { library, id }
							: undefined,
					);
				}}
			>
				<option value="">None</option>
				{current && (loading || missing) && (
					<option value={footprintKey(current)}>
						{loading ? current.id : `${current.id} (missing)`}
					</option>
				)}
				{choices.project.length > 0 && (
					<optgroup label="Project footprints">
						{choices.project.map(({ id, name }) => (
							<option key={id} value={`project:${id}`}>
								{name}
							</option>
						))}
					</optgroup>
				)}
				{builtin?.categories.map((category) => (
					<optgroup key={category} label={category}>
						{builtin.footprints
							.filter((footprint) => footprint.category === category)
							.map(({ file }) => (
								<option key={file.id} value={`builtin:${file.id}`}>
									{file.name}
								</option>
							))}
					</optgroup>
				))}
			</select>
			<p
				id={`footprint-status-${symbol.id}`}
				className={`m-0 text-xs ${missing || mismatched ? "text-warning" : "text-fg-faint"}`}
			>
				{!current
					? "No footprint assigned."
					: loading
						? "Loading built-in footprints..."
						: missing
							? current.library === "project"
								? "This footprint is not in the project."
								: "This footprint is not in the built-in library."
							: match && mismatched
								? [
										match.pinsWithoutPads.length > 0 &&
											`No pad for ${plural(match.pinsWithoutPads.length, "pin")} ${list(match.pinsWithoutPads)}.`,
										match.padsWithoutPins.length > 0 &&
											`No pin for ${plural(match.padsWithoutPins.length, "pad")} ${list(match.padsWithoutPins)}.`,
									]
										.filter(Boolean)
										.join(" ")
								: `Pads match all ${pins.length} ${plural(pins.length, "pin")}.`}
			</p>
			{file && current?.library === "project" && choices.onOpen && (
				<button
					type="button"
					className="ui-button w-full"
					data-variant="secondary"
					onClick={() => choices.onOpen?.(current.id)}
				>
					Open footprint
				</button>
			)}
			{file && current?.library === "builtin" && choices.onCopy && (
				<button
					type="button"
					className="ui-button w-full"
					data-variant="secondary"
					disabled={copying}
					title="Copy this footprint into the project to edit it, and use the copy here"
					onClick={async () => {
						setCopying(true);
						setCopyError("");
						try {
							const id = await choices.onCopy?.(current.id);
							if (id && mounted.current) onChange({ library: "project", id });
						} catch (cause) {
							if (mounted.current)
								setCopyError(
									cause instanceof Error
										? cause.message
										: "The footprint could not be copied.",
								);
						} finally {
							if (mounted.current) setCopying(false);
						}
					}}
				>
					{copying ? "Copying..." : "Copy to project"}
				</button>
			)}
			{copyError && (
				<p role="alert" className="m-0 text-xs text-danger">
					{copyError}
				</p>
			)}
		</div>
	);
}
