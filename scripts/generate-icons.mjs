import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("../node_modules/sharp");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(join(root, "public/favicon.svg"));
const outDir = join(root, "public/icons");
await mkdir(outDir, { recursive: true });

const sizes = [16, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512];

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size, { fit: "contain", background: { r: 13, g: 15, b: 17, alpha: 1 } })
    .png()
    .toFile(join(outDir, `icon-${size}.png`));
}

const maskable = 512;
const inner = Math.round(maskable * 0.72);
const pad = Math.round((maskable - inner) / 2);
const core = await sharp(svg).resize(inner, inner).png().toBuffer();
await sharp({
  create: {
    width: maskable,
    height: maskable,
    channels: 4,
    background: { r: 13, g: 15, b: 17, alpha: 1 },
  },
})
  .composite([{ input: core, left: pad, top: pad }])
  .png()
  .toFile(join(outDir, "icon-512-maskable.png"));

await sharp(join(outDir, "icon-180.png")).toFile(join(root, "public/apple-touch-icon.png"));

console.log(`Wrote ${sizes.length} icons plus maskable and apple-touch-icon`);
