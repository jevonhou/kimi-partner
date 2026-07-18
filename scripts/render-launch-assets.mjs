import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const jobs = [
  ["assets/launch/source/launch-cover-16x9.html", "assets/launch/kimi-partner-launch-cover-16x9.png", 1280, 720],
  ["assets/launch/source/launch-cover-4x5.html", "assets/launch/kimi-partner-launch-cover-4x5.png", 1080, 1350],
];

await mkdir(path.join(root, "assets/launch"), { recursive: true });

for (const [source, output, width, height] of jobs) {
  const result = spawnSync(chrome, [
    "--headless=new",
    "--hide-scrollbars",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    `--window-size=${width},${height}`,
    `--screenshot=${path.join(root, output)}`,
    pathToFileURL(path.join(root, source)).href,
  ], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
