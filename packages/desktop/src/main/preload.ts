import type { ProjectStorage } from "@ecad/core/projects/storage.ts";
import { contextBridge, ipcRenderer } from "electron";
import {
	type DesktopSymbolLibraryBridge,
	libraryChannels,
	projectChannels,
} from "#/bridge.ts";

const bridge: DesktopSymbolLibraryBridge = {
	load: () => ipcRenderer.invoke(libraryChannels.load),
	save: (symbols, additions) =>
		ipcRenderer.invoke(libraryChannels.save, symbols, additions),
	openDirectory: () => ipcRenderer.invoke(libraryChannels.openDirectory),
};

contextBridge.exposeInMainWorld("ecadSymbolLibrary", bridge);

const projects: ProjectStorage = {
	mode: "desktop",
	load: () => ipcRenderer.invoke(projectChannels.load),
	list: async () => [],
	create: (name) => ipcRenderer.invoke(projectChannels.create, name),
	open: () => ipcRenderer.invoke(projectChannels.open),
	save: (directory, document) =>
		ipcRenderer.invoke(projectChannels.save, directory, document),
	importAssets: (directory, assets) =>
		ipcRenderer.invoke(projectChannels.importAssets, directory, assets),
	readAsset: (directory, path) =>
		ipcRenderer.invoke(projectChannels.readAsset, directory, path),
};
contextBridge.exposeInMainWorld("ecadProjects", projects);
