import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildBundle({
  outfile = path.join(projectRoot, "dist", "mcp-server.mjs"),
} = {}) {
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(projectRoot, "src", "server.mjs")],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    packages: "bundle",
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
  });
  const bundledSource = await readFile(outfile, "utf8");
  await writeFile(outfile, bundledSource.replace(/[ \t]+$/gm, ""), "utf8");
  await chmod(outfile, 0o755);
  return outfile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outfile = await buildBundle();
  process.stdout.write(`Built ${outfile}\n`);
}
