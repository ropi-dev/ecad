import { Shapes } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { viewControlButtonClassName } from "../viewer/ViewControls3D";
import { type SymbolDefinition, symbolDefinitions } from "./symbols";

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
					<div className="flex flex-col gap-1">
						{symbolDefinitions.map((definition) => (
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
								<svg
									viewBox="-5 -3 10 6"
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
												<line
													x1={-child.width / 2}
													x2={child.width / 2}
													y1="0"
													y2="0"
												/>
											) : child.kind === "pin" ? (
												<circle r={child.width / 2} fill="currentColor" />
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
								<span>
									<span className="block text-sm">{definition.name}</span>
									<span className="block text-xs text-[#9ba7b8]">
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
