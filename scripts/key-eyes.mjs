// Turn the opaque, checkerboard-backed eye sheet into a real transparent PNG.
//
// The generator baked a light "transparency checkerboard" onto an opaque white
// background, and the eye whites are the same white as that background — so a
// plain colour key would eat the sclera too. Instead we flood-fill LIGHT pixels
// inward from the image border: the black eye outlines dam the fill, so only the
// outside background is cleared while the enclosed whites survive.
import { writeFileSync } from "fs";
import { chromium } from "playwright";

const OUT = process.argv[2] || "public/rock-eyes-grid.png";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:8742/admin.html");

const dataUrl = await page.evaluate(async () => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = "rock-eyes-grid.png"; });
  const w = img.width, h = img.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;

  const LIGHT = 180; // min channel value counted as "light" (bg or sclera)
  const isLight = (p) => d[p] > LIGHT && d[p + 1] > LIGHT && d[p + 2] > LIGHT;

  // BFS flood fill of light pixels starting from every border pixel
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i]) return;
    if (!isLight(i * 4)) return;
    bg[i] = 1; stack.push(i);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }

  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (bg[i]) {
      d[p + 3] = 0;                 // background -> transparent
    } else if (isLight(p)) {
      d[p] = d[p + 1] = d[p + 2] = 255; d[p + 3] = 255; // clean the sclera to pure white
    }
    // dark outline / antialiased edge pixels keep their colour + full alpha
  }
  g.putImageData(im, 0, 0);
  return c.toDataURL("image/png");
});

await browser.close();
writeFileSync(OUT, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("wrote", OUT);
