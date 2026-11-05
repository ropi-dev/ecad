import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { openProjectFiles } from "../browser/project-files.ts";
import { toolbarButton } from "../browser/toolbar.ts";

// Launches the built desktop app (`pnpm run build:desktop`) in real Electron.
// Only the native folder picker is replaced, because a test cannot click it.

const desktop = fileURLToPath(
	new URL("../../packages/desktop/", import.meta.url),
);

function electronBinary() {
	try {
		const path = createRequire(join(desktop, "package.json"))(
			"electron",
		) as string;
		return existsSync(path) ? path : undefined;
	} catch {
		return undefined;
	}
}

/** Why this machine can't run the test, if it can't. */
function missingPrerequisite(executable: string | undefined) {
	if (!executable)
		return "The Electron binary is not installed. Run `node install.js` in the electron package directory, or reinstall without ELECTRON_SKIP_BINARY_DOWNLOAD.";
	if (!existsSync(join(desktop, "dist/main.cjs")))
		return "The desktop app is not built. Run `pnpm run build:desktop`.";
	if (
		process.platform === "linux" &&
		!process.env.DISPLAY &&
		!process.env.WAYLAND_DISPLAY
	)
		return "No display is available. Run under `xvfb-run -a`.";
}

const executable = electronBinary();
const missing = missingPrerequisite(executable);
// CI must run this test, so a missing prerequisite there is a failure.
if (missing && process.env.CI) throw new Error(missing);
test.skip(!!missing, missing);

async function launch(home: string) {
	const app = await electron.launch({
		executablePath: executable,
		args: [
			desktop,
			"--use-angle=swiftshader",
			// CI runners don't allow the Chromium sandbox's user namespaces.
			...(process.platform === "linux" ? ["--no-sandbox"] : []),
		],
		env: {
			...process.env,
			HOME: home,
			XDG_CONFIG_HOME: join(home, ".config"),
		},
	});
	try {
		return { app, page: await app.firstWindow() };
	} catch (error) {
		// The caller only cleans up an app it received, so close it here.
		await app.close().catch(() => {});
		throw error;
	}
}

/** Replaces the native folder picker, which a test cannot operate. */
async function chooseFolder(app: ElectronApplication, folder: string) {
	await app.evaluate(({ dialog }, folder) => {
		dialog.showOpenDialog = async () => ({
			canceled: false,
			filePaths: [folder],
		});
	}, folder);
}

async function editorReady(page: Page) {
	await page.waitForFunction(
		() =>
			document
				.querySelector("h1")
				?.textContent?.startsWith("Schematic editor ·") &&
			document.querySelector<HTMLButtonElement>('button[aria-label="Select"]')
				?.disabled === false,
		undefined,
		{ polling: "raf", timeout: 30_000 },
	);
}

async function projectAction(page: Page, name: string) {
	await (await openProjectFiles(page))
		.getByRole("button", { name: "Project actions", exact: true })
		.click();
	await page.getByRole("menuitem", { name, exact: true }).click();
}

test("the desktop app saves a project to disk and reopens it after a relaunch", async ({
	browserName: _browserName,
}, testInfo) => {
	const home = testInfo.outputPath("home");
	const parent = testInfo.outputPath("projects");
	await mkdir(home, { recursive: true });
	await mkdir(parent, { recursive: true });

	let { app, page } = await launch(home);
	try {
		await (await openProjectFiles(page))
			.getByRole("link", { name: /^Open .+\.ecaddraw$/ })
			.first()
			.click();
		await editorReady(page);
		await (await toolbarButton(page, "Rectangle")).click();
		await page.mouse.move(600, 300);
		await page.mouse.down();
		await page.mouse.move(710, 400, { steps: 4 });
		await page.mouse.up();

		await chooseFolder(app, parent);
		await projectAction(page, "Save project");
		await expect(
			page.getByText("Project saved", { exact: true }),
		).toBeVisible();
	} finally {
		await app.close();
	}
	const [saved] = await readdir(parent);
	const directory = join(parent, saved);
	const files = await readdir(directory, { recursive: true });
	const drawings = files.filter((file) => file.endsWith(".ecaddraw"));
	expect(drawings).toHaveLength(1);
	expect(await readFile(join(directory, drawings[0]), "utf8")).toContain(
		'"rectangle"',
	);

	({ app, page } = await launch(home));
	try {
		await chooseFolder(app, directory);
		await projectAction(page, "Open project...");
		// The relaunched app starts in an empty in-memory project.
		await page
			.getByRole("button", { name: "Discard and open", exact: true })
			.click();
		await (await openProjectFiles(page))
			.getByRole("link", { name: `Open ${basename(drawings[0])}`, exact: true })
			.click();
		await editorReady(page);
		await page.mouse.move(560, 260);
		await page.mouse.down();
		await page.mouse.move(760, 440, { steps: 4 });
		await page.mouse.up();
		await expect(
			page.getByRole("button", { name: "Clear selection", exact: true }),
		).toBeVisible();
	} finally {
		await app.close();
	}
});
