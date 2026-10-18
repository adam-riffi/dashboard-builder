// Checks what npm would publish (DESIGN.md §9, M7): each package packs a built `dist` with JS and
// type declarations for every export, ships no sources or tests, and its Node entry points load.
// Run after `pnpm build`: `node scripts/check-packages.mjs`.
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PACKAGES = ["core", "gateway", "visuals", "react"];
// Entries Node can load on its own; the React packages are checked by their contents only.
const NODE_ENTRIES = { core: ["dist/index.js"], gateway: ["dist/index.js"] };

const problems = [];
const out = mkdtempSync(join(tmpdir(), "dash-pack-"));
try {
  for (const name of PACKAGES) {
    const dir = join(root, "packages", name);
    // One command string: pnpm is a .cmd on Windows, and `out` is a temp folder made here.
    const tarball = execSync(`pnpm pack --pack-destination "${out}"`, {
      cwd: dir,
      encoding: "utf8",
    })
      .trim()
      .split(/\r?\n/)
      .at(-1);
    // tar reads "C:" in a path as a remote host, so it runs beside the tarball.
    const tar = (...args) => execFileSync("tar", [...args], { cwd: out, encoding: "utf8" });
    const files = tar("-tzf", basename(tarball))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((f) => f.replace(/^package\//, ""));
    const manifest = JSON.parse(tar("-xzOf", basename(tarball), "package/package.json"));
    const where = `@adam-riffi/dash-${name}`;
    if (manifest.private) problems.push(`${where}: still private`);
    for (const dep of Object.values(manifest.dependencies ?? {})) {
      if (String(dep).startsWith("workspace:"))
        problems.push(`${where}: workspace dependency left`);
    }
    for (const [entry, target] of Object.entries(manifest.exports ?? {})) {
      const js = typeof target === "string" ? target : (target.import ?? target.default);
      const types = typeof target === "string" ? undefined : target.types;
      for (const file of [js, types]) {
        if (!file || !files.includes(file.replace(/^\.\//, ""))) {
          problems.push(`${where} ${entry}: ${file ?? "an entry"} is not in the package`);
        }
      }
      if (!String(js).endsWith(".js"))
        problems.push(`${where} ${entry}: exports ${js}, not built JS`);
      if (!String(types).endsWith(".d.ts"))
        problems.push(`${where} ${entry}: no type declarations`);
    }
    for (const file of files) {
      if (/^(src|test)\//.test(file) || /\.test\./.test(file)) {
        problems.push(`${where}: ships ${file}`);
      }
    }
    for (const entry of NODE_ENTRIES[name] ?? []) {
      try {
        await import(pathToFileURL(join(dir, entry)).href);
      } catch (error) {
        problems.push(`${where}: ${entry} does not load (${error.message})`);
      }
    }
    console.log(`${where}: ${files.length} files`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("✓ every package is publishable");
