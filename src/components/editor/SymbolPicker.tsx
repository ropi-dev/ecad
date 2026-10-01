import { Shapes, Upload } from "lucide-react";
import { Popover } from "radix-ui";
import { useRef, useState } from "react";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { viewControlButtonClassName } from "../viewer/ViewControls3D";
import { useSymbolLibrary } from "./useSymbolLibrary";

export function SymbolPicker({
	disabled,
	active,
	onChoose,
}: {
	disabled: boolean;
	active: boolean;
	onChoose: (definition: SymbolDefinition) => void;
}) {
	const [open, setOpen] = useState(false);
	const input = useRef<HTMLInputElement>(null);
	const directoryInput = useRef<HTMLInputElement>(null);
	const { definitions, loading, message, error, upload } = useSymbolLibrary();
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger asChild>
				<button
					type="button"
					disabled={disabled}
					aria-label="Symbols"
					title="Insert a symbol"
					aria-pressed={active}
					className={`${viewControlButtonClassName} aria-pressed:border-[#b88f61] aria-pressed:text-[#e8b77e]`}
				>
					<Shapes size={18} aria-hidden="true" />
				</button>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="top"
					sideOffset={8}
					collisionPadding={12}
					aria-label="Symbol library"
					className="z-50 w-72 max-h-[calc(100dvh-6rem)] overflow-auto rounded-lg border border-[#414955] bg-[#191c22] p-3 text-[#e8edf5] shadow-[0_8px_32px_#0008]"
				>
					<h2 className="m-0 text-sm font-semibold">Symbols</h2>
					<p className="mt-1 mb-3 text-xs text-[#9ba7b8]">
						Choose a symbol, then click the drawing to place it.
					</p>
					<div className="mb-3 border-b border-[#414955] pb-3">
						<input
							ref={input}
							type="file"
							multiple
							accept=".ecadsym,.json"
							aria-label="Upload symbol files"
							className="hidden"
							disabled={loading}
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = "";
								if (files.length) void upload(files);
							}}
						/>
						<input
							ref={directoryInput}
							type="file"
							multiple
							{...{ webkitdirectory: "" }}
							aria-label="Upload symbol directory"
							className="hidden"
							disabled={loading}
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = "";
								if (files.length) void upload(files, true);
							}}
						/>
						<button
							type="button"
							disabled={loading}
							onClick={() => input.current?.click()}
							className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-[#414955] px-3 py-2 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-wait disabled:opacity-50"
						>
							<Upload size={14} aria-hidden="true" />
							{loading ? "Importing…" : "Upload symbols"}
						</button>
						<button
							type="button"
							disabled={loading}
							onClick={() => directoryInput.current?.click()}
							className="mt-2 w-full cursor-pointer rounded-md border border-[#414955] px-3 py-2 text-xs hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e] disabled:cursor-wait disabled:opacity-50"
						>
							Upload library directory
						</button>
						<p className="mt-2 mb-0 text-xs text-[#9ba7b8]">
							One symbol per .ecadsym or .json file. Select files or a
							directory. Saved in this browser.
						</p>
						<a
							href="/examples/symbols/test-point.ecadsym"
							download
							className="mt-1 inline-block text-xs text-[#76c4c0] underline"
						>
							Download example
						</a>
						{message && (
							<output className="mt-2 mb-0 block text-xs text-[#76c4c0]">
								{message}
							</output>
						)}
						{error && (
							<p
								role="alert"
								className="mt-2 mb-0 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-[#ffb4ab]"
							>
								{error}
							</p>
						)}
					</div>
					<div className="flex flex-col gap-1">
						{definitions.map((definition) => (
							<button
								key={definition.id}
								type="button"
								aria-label={`Insert ${definition.name}`}
								className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e8b77e]"
								onClick={() => {
									onChoose(definition);
									setOpen(false);
								}}
							>
								<SymbolPreview definition={definition} />
								<span className="min-w-0">
									<span className="block break-words text-sm">
										{definition.name}
									</span>
									<span className="block break-words text-xs text-[#9ba7b8]">
										{definition.description}
									</span>
								</span>
							</button>
						))}
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}

function SymbolPreview({ definition }: { definition: SymbolDefinition }) {
	const { width, height } = createSymbol(0, definition, { x: 0, y: 0 });
	const padding = Math.max(0.5, Math.max(width, height) * 0.1);
	return (
		<svg
			viewBox={`${-width / 2 - padding} ${-height / 2 - padding} ${width + 2 * padding} ${height + 2 * padding}`}
			className="h-10 w-16 shrink-0 text-[#76c4c0]"
			aria-hidden="true"
		>
			{definition.children.map((child) => (
				<g
					key={child.id}
					transform={`translate(${child.x} ${-child.y}) rotate(${(-child.rotation * 180) / Math.PI})`}
					fill="none"
					stroke="currentColor"
					strokeWidth="0.254"
				>
					{child.kind === "wire" ? (
						<line x1={-child.width / 2} x2={child.width / 2} y1="0" y2="0" />
					) : child.kind === "pin" || child.kind === "circle" ? (
						<circle
							r={child.width / 2}
							fill={child.kind === "pin" ? "currentColor" : "none"}
							stroke={child.kind === "pin" ? "none" : "currentColor"}
						/>
					) : child.kind === "triangle" ? (
						<polygon
							points={`${-child.width / 2},${child.height / 2} ${child.width / 2},${child.height / 2} 0,${-child.height / 2}`}
						/>
					) : (
						<rect
							x={-child.width / 2}
							y={-child.height / 2}
							width={child.width}
							height={child.height}
						/>
					)}
				</g>
			))}
		</svg>
	);
}
