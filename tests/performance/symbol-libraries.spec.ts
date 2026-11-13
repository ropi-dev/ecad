import { expect, test } from "@playwright/test";
import { projectRail } from "../browser/project-files";
import { defaultSymbolRows } from "../helpers/default-symbol-rows.ts";
import { required } from "../helpers/required.ts";
import { setupAppTests } from "./app-fixture.ts";
import { finish, interaction, metric, ready, report } from "./app-helpers.ts";

setupAppTests();

test(
	"symbol-libraries",
	{ tag: ["@symbols", "@projects"] },
	async ({ page }, testInfo) => {
		await page.goto("/projects?perf=1");
		await ready(page);
		await page.evaluate(async () => {
			const libraries = (scope: string) =>
				Array.from({ length: 10 }, (_, libraryIndex) => ({
					id: `${scope}-${libraryIndex}`,
					name: `${scope} ${libraryIndex}`,
					enabled: true,
					source: {
						kind: "embedded",
						symbols: Array.from({ length: 20 }, (_, symbolIndex) => ({
							format: "ecad-symbol",
							version: 1,
							units: "mm",
							id: `${scope}-${libraryIndex}-${symbolIndex}`,
							name: `${scope} point ${libraryIndex}-${symbolIndex}`,
							description: "Test point",
							prefix: "TP",
							value: "",
							shapes: [{ kind: "pin", name: "Signal", x: 0, y: 0 }],
						})),
					},
				}));
			localStorage.setItem(
				"ecad.user-config.v1",
				JSON.stringify({
					version: 1,
					symbolLibraries: [
						{
							id: "builtin",
							name: "Built-in symbols",
							enabled: true,
							source: { kind: "builtin" },
						},
						...libraries("user"),
					],
				}),
			);
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle("Library fixture", {
				create: true,
			});
			for (const [name, content] of [
				[
					".ecadprj",
					'format = "ecad-project"\nversion = 1\nname = "Library fixture"\ndrawing = "drawing.ecaddraw"\nsymbols = []\n',
				],
				[
					"drawing.ecaddraw",
					JSON.stringify({ shapes: [], symbolLibraries: libraries("project") }),
				],
			]) {
				const writer = await (
					await directory.getFileHandle(name, { create: true })
				).createWritable();
				await writer.write(content);
				await writer.close();
			}
			localStorage.setItem("ecad.active-project", "Library fixture");
		});
		await page.reload();
		await ready(page);
		await projectRail(page)
			.getByRole("button", { name: "Project actions", exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: "Symbol libraries...", exact: true })
			.click();
		const user = page.getByRole("group", {
			name: "User libraries",
			exact: true,
		});
		await expect(user.getByRole("checkbox")).toHaveCount(11);
		await interaction(page, "library.disable", async () => {
			await user
				.getByRole("checkbox", { name: "user 0", exact: true })
				.uncheck();
			await expect(
				user.getByRole("checkbox", { name: "user 0", exact: true }),
			).toBeEnabled();
		});
		await page.getByRole("button", { name: "Done", exact: true }).click();
		await projectRail(page)
			.getByRole("link", { name: "Schematic editor", exact: true })
			.click();
		await interaction(page, "library.picker", async () => {
			await page.getByRole("button", { name: "Symbols", exact: true }).click();
			await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(
				380 + defaultSymbolRows().symbols,
			);
		});
		await interaction(page, "library.search", async () => {
			const search = page.getByRole("searchbox", { name: "Search symbols" });
			await expect(search).toBeFocused();
			await search.fill("project point 9-19");
			await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(
				1,
			);
			await search.fill("");
			await expect(page.getByRole("button", { name: /^Insert / })).toHaveCount(
				380 + defaultSymbolRows().symbols,
			);
		});
		const search = page.getByRole("searchbox", { name: "Search symbols" });
		await expect(search).toBeFocused();
		const keyboardTarget = required(
			await page
				.getByRole("button", { name: /^Insert / })
				.nth(10)
				.getAttribute("id"),
		);
		await interaction(page, "library.keyboard", async () => {
			for (let index = 0; index < 10; index++)
				await page.keyboard.press("ArrowDown");
			await expect(search).toHaveAttribute(
				"aria-activedescendant",
				keyboardTarget,
			);
			await page.keyboard.press("Enter");
			await expect(
				page.getByRole("button", { name: "Symbols", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
		});
		const value = await report(page);
		await finish(page, testInfo, "symbol-libraries", {
			libraryLoadMs: required(metric(value, "symbol-library.load")),
			libraryResolveMs: required(metric(value, "symbol-library.resolve")),
			interactionP95Ms: required(metric(value, "scenario.interaction")),
		});
	},
);
