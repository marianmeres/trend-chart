/**
 * Build the npm (dual CJS/ESM) distribution of this package into `.npm-dist`.
 *
 * Run via `deno task npm:build` (or `npm:publish`, which builds and publishes).
 * Name/version/deps are read from `deno.json` — this file needs no edits.
 */
import { npmBuild, versionizeDeps } from "@marianmeres/npmbuild";

const denoJson = JSON.parse(Deno.readTextFileSync("deno.json"));

await npmBuild({
	name: denoJson.name,
	version: denoJson.version,
	repository: denoJson.name.replace(/^@/, ""),
	dependencies: versionizeDeps([], denoJson),
});
