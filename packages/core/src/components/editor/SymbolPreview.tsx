import { parseOverbars } from "@ecad/drawing-core/drawing/overbar.ts";
import { pinBubbleRadius } from "@ecad/drawing-core/drawing/pin-types.ts";
import { PIN_RADIUS, shapeBounds } from "@ecad/drawing-core/drawing/shapes.ts";
import { textCenter } from "@ecad/drawing-core/drawing/text-alignment.ts";
import { createMemo } from "solid-js";
import { schematicThemes, viewerThemes } from "#/drawing/schematic-theme.ts";
import { createSymbol, type SymbolDefinition } from "#/drawing/symbols.ts";
import { drawingFontStack } from "#/drawing/text.ts";
import { measurePerformance } from "#/performance/runtime.ts";
import { useTheme } from "#/settings/theme.ts";

export default function SymbolPreview(props: { definition: SymbolDefinition }) {
	const theme = useTheme();
	const preview = createMemo(() => {
		const definition = props.definition;
		const current = theme();
		return measurePerformance(
			"symbol.thumbnail",
			() =>
				buildSymbolPreview({
					definition,
					stroke: schematicThemes[current].appearance.stroke,
					thumbnailFill: viewerThemes[current].thumbnailFill,
				}),
			{ shapes: definition.children.length },
		);
	});
	return <>{preview()}</>;
}

function buildSymbolPreview({
	definition,
	stroke,
	thumbnailFill,
}: {
	definition: SymbolDefinition;
	stroke: string;
	thumbnailFill: string;
}) {
	if (!definition.children.length)
		return (
			<span
				class="grid h-7 w-11 shrink-0 place-items-center text-2xs text-fg-faint"
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
		44 / (width + 2 * padding),
		28 / (height + 2 * padding),
	);
	const pinMarkers = PIN_RADIUS * previewScale >= 0.5;
	const lines = definition.children
		.flatMap((child) => {
			if (child.kind === "pin" && child.length) {
				const length =
					child.length - (pinMarkers ? 2 * pinBubbleRadius(child) : 0);
				return [
					`M ${child.x} ${-child.y} L ${child.x + Math.cos(child.rotation) * length} ${-child.y - Math.sin(child.rotation) * length}`,
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
			class="h-7 w-11 shrink-0"
			style={{ color: stroke }}
			aria-hidden="true"
		>
			{lines && (
				<path
					d={lines}
					fill="none"
					stroke="currentColor"
					stroke-width="0.2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			)}
			{definition.children
				.filter((child) => {
					if (child.kind === "wire" || child.kind === "line") return false;
					if (child.kind === "text") return child.fontSize * previewScale >= 1;
					if (child.kind === "pin") return pinMarkers;
					return true;
				})
				.map((child) => (
					<g
						transform={`translate(${child.kind === "text" ? textCenter(child).x : child.x} ${-(child.kind === "text" ? textCenter(child).y : child.y)}) rotate(${(-child.rotation * 180) / Math.PI})`}
						fill={
							child.kind !== "line" && "filled" in child && child.filled
								? thumbnailFill
								: "none"
						}
						stroke="currentColor"
						stroke-width="0.2"
					>
						{child.kind === "text" ? (
							<text
								fill="currentColor"
								stroke="none"
								font-family={drawingFontStack}
								font-size={String(child.fontSize)}
								text-anchor={
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
									.map((line) => parseOverbars(line).text)
									.map((line, index) => (
										<tspan
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
						) : child.kind === "pin" && pinBubbleRadius(child) ? (
							<>
								<circle r={child.width / 2} fill="currentColor" stroke="none" />
								<circle
									cx={(child.length ?? 0) - pinBubbleRadius(child)}
									r={pinBubbleRadius(child)}
									fill="none"
								/>
							</>
						) : child.kind === "pin" || child.kind === "circle" ? (
							<circle
								r={child.width / 2}
								fill={
									child.kind === "pin"
										? "currentColor"
										: child.filled
											? thumbnailFill
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
