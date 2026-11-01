import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
await mkdir("build/web", { recursive: true });
const result = await build({
  entryPoints: ["web/app.js"],
  bundle: true,
  minify: true,
  format: "iife",
  loader: { ".css": "text" },
  target: "safari17",
  outfile: "build/web/bundle.js",
  legalComments: "eof",
  metafile: true,
});
for (const file of ["index.html", "style.css"])
  await copyFile("web/" + file, "build/web/" + file);
// Retain notices for every dependency actually included in the runtime bundle.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter((p) =>
  p.includes("node_modules/"),
)) {
  let dir = dirname(input);
  while (dir.includes("node_modules")) {
    try {
      const info = JSON.parse(
        await readFile(join(dir, "package.json"), "utf8"),
      );
      if (info.name && info.version) {
        packages.set(info.name + "@" + info.version, { dir, info });
        break;
      }
    } catch {
      /* Keep walking to the owning package. */
    }
    dir = dirname(dir);
  }
}
let notices =
  "Folio runtime third-party licenses\nGenerated from the bundled dependency graph.\n";
for (const [name, { dir, info }] of [...packages].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  notices +=
    "\n\n=== " +
    name +
    " (" +
    (info.license || "see package notice") +
    ") ===\n";
  const files = (await readdir(dir)).filter((f) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(f),
  );
  for (const file of files) {
    try {
      notices += "\n" + (await readFile(join(dir, file), "utf8"));
    } catch {
      /* Not a regular notice file. */
    }
  }
}
await writeFile("THIRD-PARTY-LICENSES.txt", notices);
