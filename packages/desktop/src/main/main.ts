import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SymbolLibrary } from "@ecad/core/components/editor/symbolFormat.ts";
import {
	app,
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
	net,
	protocol,
} from "electron";
import { libraryChannels } from "#/bridge.ts";
import { DesktopSymbolLibrary } from "#/main/symbol-library.ts";

protocol.registerSchemesAsPrivileged([
	{
		scheme: "ecad",
		privileges: { standard: true, secure: true, supportFetchAPI: true },
	},
]);

function developmentRendererUrl(): string | undefined {
	const value = process.env.ECAD_RENDERER_URL;
	if (!value || app.isPackaged) return;
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		!["127.0.0.1", "localhost"].includes(url.hostname) ||
		url.username ||
		url.password
	) {
		throw new Error("The desktop development renderer must use localhost.");
	}
	return url.href;
}

const rendererUrl = developmentRendererUrl() ?? "ecad://app/index.html";
const directoryArgument = process.argv
	.slice(2)
	.find((argument) => !argument.startsWith("-"));
const library = new DesktopSymbolLibrary(
	directoryArgument &&
		resolve(process.env.INIT_CWD ?? process.cwd(), directoryArgument),
);
let window: BrowserWindow | null = null;

function assertSender(event: IpcMainInvokeEvent) {
	if (
		!window ||
		event.sender !== window.webContents ||
		event.senderFrame !== window.webContents.mainFrame ||
		event.senderFrame.url !== rendererUrl
	) {
		throw new Error("Symbol library access is limited to the desktop editor.");
	}
}

function registerLibraryHandlers() {
	ipcMain.handle(libraryChannels.load, (event) => {
		assertSender(event);
		return library.load();
	});
	ipcMain.handle(
		libraryChannels.save,
		(event, symbols: SymbolLibrary, additions: SymbolLibrary) => {
			assertSender(event);
			return library.save(symbols, additions);
		},
	);
	ipcMain.handle(libraryChannels.openDirectory, async (event) => {
		assertSender(event);
		const owner = window;
		if (!owner) throw new Error("The desktop editor is closed.");
		const selected = await dialog.showOpenDialog(owner, {
			title: "Open symbol directory",
			properties: ["openDirectory"],
		});
		if (selected.canceled || !selected.filePaths[0]) return null;
		return library.openDirectory(selected.filePaths[0]);
	});
}

function createWindow() {
	window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 720,
		minHeight: 480,
		title: "ECAD desktop",
		backgroundColor: "#111318",
		webPreferences: {
			preload: join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event, url) => {
		if (url !== rendererUrl) event.preventDefault();
	});
	window.webContents.session.setPermissionRequestHandler(
		(_contents, _permission, reply) => reply(false),
	);
	window.on("closed", () => {
		window = null;
	});
	void window.loadURL(rendererUrl);
}

void app.whenReady().then(() => {
	const rendererDirectory = resolve(__dirname, "renderer");
	protocol.handle("ecad", async (request) => {
		const url = new URL(request.url);
		if (url.hostname !== "app") return new Response(null, { status: 404 });
		const requested = resolve(
			rendererDirectory,
			`.${decodeURIComponent(url.pathname)}`,
		);
		const suffix = relative(rendererDirectory, requested);
		if (suffix.startsWith("..") || isAbsolute(suffix)) {
			return new Response(null, { status: 403 });
		}
		const response = await net.fetch(pathToFileURL(requested).href);
		const headers = new Headers(response.headers);
		// OCCT's bundled WASM loader evaluates generated code inside its worker.
		const scriptPolicy = url.pathname.includes(".worker-")
			? "'self' 'unsafe-eval'"
			: "'self' 'wasm-unsafe-eval'";
		headers.set(
			"Content-Security-Policy",
			`default-src 'self'; script-src ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'`,
		);
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	});
	registerLibraryHandlers();
	createWindow();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
});
