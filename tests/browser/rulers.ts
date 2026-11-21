import { expect, type Locator, type Page } from "@playwright/test";

export async function screenPointOfMillimetres(
	target: Page | Locator,
	x: number,
	y: number,
) {
	const rulers = target.getByRole("img", {
		name: "Drawing rulers in millimetres",
	});
	await expect(rulers.locator("[data-axis]")).not.toHaveCount(0);
	const scale = await rulers.evaluate((element) => {
		const axis = (name: string, key: "x" | "y") => {
			const ticks = [
				...element.querySelectorAll<SVGGElement>(
					`g[data-axis="${name}"][data-value]`,
				),
			]
				.map((tick) => {
					const box = (
						tick.querySelector("line") as SVGLineElement
					).getBoundingClientRect();
					return {
						value: Number(tick.dataset.value),
						position: box[key] + (key === "x" ? box.width : box.height) / 2,
					};
				})
				.sort((a, b) => a.value - b.value);
			const first = ticks[0];
			const last = ticks[ticks.length - 1];
			const perUnit =
				(last.position - first.position) / (last.value - first.value);
			return { perUnit, origin: first.position - first.value * perUnit };
		};
		return { x: axis("x", "x"), y: axis("y", "y") };
	});
	return {
		x: scale.x.origin + x * scale.x.perUnit,
		y: scale.y.origin + y * scale.y.perUnit,
	};
}
