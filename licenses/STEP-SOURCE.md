# STEP importer source and replacement

ECAD uses the unmodified WebAssembly binary from `occt-import-js` 0.0.23. Its npm release records upstream commit `c2148e54b456b571238d35cac037d304053d64b2`. That commit's `occt` submodule points to Open CASCADE commit `d2abb6d844231cb8f29be6894440874a4700e4a5`.

Production web and desktop builds include both complete upstream source archives in `licenses/sources`. The importer archive contains its C++ interface, CMake files, build scripts, and upstream build workflow. The Open CASCADE archive supplies the submodule's source. The binary in the importer archive matches the distributed npm WebAssembly binary byte for byte. The JavaScript loader matches after normalizing line endings.

`step-sources.json` records the archive URLs and SHA-256 checksums, plus hashes of the installed WebAssembly binary and normalized JavaScript loader. Builds fail if the installed importer no longer matches, a download fails, or a cached archive fails verification. Dependency updates require a new source review and manifest update.

## Rebuild the library

1. Extract the importer archive.
2. Extract the Open CASCADE archive and move its extracted directory to `occt` inside the importer directory.
3. Install CMake, Git, and Emscripten SDK 3.1.69. Activate that SDK and load its environment in your shell. The upstream Windows scripts also install MinGW 7.1.0. The pinned importer archive includes those scripts and the Windows build workflow.
4. From the importer directory, run:

```sh
emcmake cmake -S . -B build/wasm -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release
cmake --build build/wasm --parallel
```

The output files are `build/wasm/Release/occt-import-js.js` and `build/wasm/Release/occt-import-js.wasm`. On Windows, the upstream alternatives are `tools/setup_emscripten_win.bat` and `tools/build_wasm_win.bat Release`.

## Replace the library in ECAD

For an existing web or desktop renderer distribution, the WebAssembly library is a separate `assets/occt-import-js-*.wasm` file. Replace that file with a rebuilt binary under the same filename. Keep the same Emscripten version, build settings, and JavaScript interface so the bundled loader can use it. ECAD does not check a runtime checksum or signature and does not require an application rebuild for this compatible replacement. The content hash in the filename is a cache key. Clear the browser cache or test from a fresh local origin after replacing the file.

If your changes also require a different JavaScript loader, rebuild the STEP worker with the application:

In an ECAD source checkout with dependencies installed, replace the two files in the installed `occt-import-js/dist` directory with your rebuilt files. Update `licenses/step-sources.json` to identify your modified source archives, their SHA-256 checksums, and the new binary and loader hashes. Hash the loader after converting CRLF line endings to LF. Keep the package version field consistent with the installed package. Record your modifications and retain the upstream licenses.

Run `pnpm run build:web` or `pnpm run build:desktop`. Vite rebuilds the STEP worker and updates its hashed asset references. Deploy or package the complete output, including its notices and matching source archives. No signing key or ECAD service is needed to rebuild or run this application with a modified importer.

## Source cache and offline builds

The first production build downloads about 53 MB of source archives. It caches them in `ecad-license-sources` under the operating system's temporary directory. Set `ECAD_LICENSE_CACHE` to use a persistent cache directory. An offline build needs both archives preloaded there with the exact filenames and checksums in the manifest. Development servers and CLI builds do not download these archives.

The archives are static downloads. Opening the editor does not load them. Distributors must retain them alongside the application so recipients can obtain the matching source without relying on an upstream server.
