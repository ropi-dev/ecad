import type { RulerTick } from "#/engine/ruler.ts";

/** Height of the horizontal ruler and width of the vertical one. */
export const RULER_BAND = 24;

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function svgElement<Name extends keyof SVGElementTagNameMap>(
	name: Name,
	attributes: Record<string, string | number> = {},
) {
	const element = document.createElementNS(SVG_NAMESPACE, name);
	for (const [key, value] of Object.entries(attributes))
		element.setAttribute(key, String(value));
	return element;
}

export type TickLayer = ReturnType<typeof createTickLayer>;

/**
 * Draws one ruler's ticks into an SVG, outside React.
 *
 * A zoom moves every tick on every frame. Each labelled tick is one group
 * placed by a single transform, and the unlabelled ticks share one path, so
 * a layout writes one attribute per labelled tick. Groups are kept by value
 * and stay in ascending order: the tree changes only when a tick enters or
 * leaves.
 *
 * The horizontal ruler's coordinates run along x, with the band from y 0 to
 * `RULER_BAND`. The vertical ruler's run along y, with the band from x 1.
 */
export function createTickLayer(svg: SVGSVGElement, axis: "x" | "y") {
	const minor = svgElement("path", {
		class: "fill-none stroke-ruler-tick stroke-1",
	});
	svg.replaceChildren(minor);
	let groups: { value: number; node: SVGGElement }[] = [];
	const createGroup = () => {
		const node = svgElement("g", { "data-axis": axis });
		node.append(
			svgElement(
				"line",
				axis === "x" ? { y1: 15, y2: RULER_BAND } : { x1: 1, x2: 10 },
			),
			svgElement(
				"text",
				axis === "x"
					? { x: 3, y: 11 }
					: { transform: "translate(14 3) rotate(90)" },
			),
		);
		return node;
	};
	return {
		/** Shows `ticks`, in ascending order of value, moved by `offset` pixels. */
		layout(ticks: readonly RulerTick[], offset: number) {
			let path = "";
			const next: typeof groups = [];
			const spare: SVGGElement[] = [];
			let old = 0;
			for (const tick of ticks) {
				const position = tick.position + offset;
				if (tick.label === undefined) {
					const rounded = Math.round(position * 100) / 100;
					path +=
						axis === "x" ? `M${rounded} 19V${RULER_BAND}` : `M1 ${rounded}H6`;
					continue;
				}
				while (old < groups.length && groups[old].value < tick.value)
					spare.push(groups[old++].node);
				let node: SVGGElement;
				if (old < groups.length && groups[old].value === tick.value)
					node = groups[old++].node;
				else {
					node = spare.pop() ?? createGroup();
					node.setAttribute("data-value", String(tick.value));
					(node.lastChild as SVGTextElement).textContent = tick.label;
					svg.insertBefore(node, groups[old]?.node ?? null);
				}
				// Tests read drawing coordinates from these positions, so they
				// keep full precision.
				node.setAttribute(
					"transform",
					axis === "x"
						? `translate(${position} 0)`
						: `translate(0 ${position})`,
				);
				next.push({ value: tick.value, node });
			}
			while (old < groups.length) spare.push(groups[old++].node);
			for (const node of spare) node.remove();
			groups = next;
			minor.setAttribute("d", path);
		},
	};
}
