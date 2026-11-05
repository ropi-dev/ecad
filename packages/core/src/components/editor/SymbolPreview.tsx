import { PIN_RADIUS, shapeBounds } from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import { memo } from "react";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { measurePerformance } from "#/performance/runtime.ts";

export default memo(function SymbolPreview({
	definition,
}: {
	definition: SymbolDefinition;
}) {
	return measurePerformance(
		"symbol.thumbnail",
		() => buildSymbolPreview({ definition }),
		{ shapes: definition.children.length },
	);
});

function buildSymbolPreview({ definition }: { definition: SymbolDefinition }) {
	if (!definition.children.length)
		return (
			<span
				className="grid h-10 w-16 shrink-0 place-items-center text-xs text-[#9ba7b8]"
				aria-hidden="true"
			>
				Empty
			</span>
		);
	const symbol = createSymbol(0, definition, { x: 0, y: 0 });
	const { width, height } = symbol;
	const bounds = shapeBounds(symbol);
	const padding = Math.max(0.5, Math.max(width, height) * 0.1);
	const previewScale = Math.min(
		64 / (width + 2 * padding),
		40 / (height + 2 * padding),
	);
	const lines = definition.children
		.flatMap((child) => {
			if (child.kind === "pin" && child.length) {
				return [
					`M ${child.x} ${-child.y} L ${child.x + Math.cos(child.rotation) * child.length} ${-child.y - Math.sin(child.rotation) * child.length}`,
				];
			}
			if (child.kind !== "wire" && child.kind !== "line") return [];
			const dx = (Math.cos(child.rotation) * child.width) / 2;
			const dy = (Math.sin(child.rotation) * child.width) / 2;
			return [
				`M ${child.x - dx} ${-child.y + dy} L ${child.x + dx} ${-child.y - dy}`,
			];
		})
		.join(" ");
	return (
		<svg
			viewBox={`${bounds.minX - padding} ${-bounds.maxY - padding} ${width + 2 * padding} ${height + 2 * padding}`}
			className="h-10 w-16 shrink-0 text-[#76c4c0]"
			aria-hidden="true"
		>
			{lines && (
				<path
					d={lines}
					fill="none"
					stroke="currentColor"
					strokeWidth="0.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
			{definition.children
				.filter((child) => {
					if (child.kind === "wire" || child.kind === "line") return false;
					if (child.kind === "text") return child.fontSize * previewScale >= 1;
					if (child.kind === "pin") return PIN_RADIUS * previewScale >= 0.5;
					return true;
				})
				.map((child) => (
					<g
						key={child.id}
						transform={`translate(${child.kind === "text" ? textCenter(child).x : child.x} ${-(child.kind === "text" ? textCenter(child).y : child.y)}) rotate(${(-child.rotation * 180) / Math.PI})`}
						fill={
							child.kind !== "line" && "filled" in child && child.filled
								? "#18282b"
								: "none"
						}
						stroke="currentColor"
						strokeWidth="0.2"
					>
						{child.kind === "text" ? (
							<text
								fill="currentColor"
								stroke="none"
								fontFamily="Arial, sans-serif"
								fontSize={child.fontSize}
								textAnchor={
									child.horizontalAlign === "right"
										? "end"
										: child.horizontalAlign === "center"
											? "middle"
											: "start"
								}
							>
								{child.text
									.replace(/\r\n?/g, "\n")
									.split("\n")
									.map((line, index) => (
										<tspan
											key={child.text
												.split("\n")
												.slice(0, index + 1)
												.join("\n")}
											x={
												child.horizontalAlign === "right"
													? child.width / 2
													: child.horizontalAlign === "center"
														? 0
														: -child.width / 2
											}
											y={
												-child.height / 2 +
												child.fontSize +
												index * child.fontSize * 1.25
											}
										>
											{line}
										</tspan>
									))}
							</text>
						) : child.kind === "pin" || child.kind === "circle" ? (
							<circle
								r={child.width / 2}
								fill={
									child.kind === "pin"
										? "currentColor"
										: child.filled
											? "#18282b"
											: "none"
								}
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
