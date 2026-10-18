// Records the 60-second demo script (DESIGN.md §3) on the live demo and turns it into
// docs/demo.gif (ENGINEERING.md §15: 10–20 s, under 8 MB). Needs ffmpeg on the PATH.
// `pnpm record-demo` (DEMO_URL picks another deployment). It deletes the dashboard it saves.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const url = process.env.DEMO_URL ?? "https://dashboard-builder-rose.vercel.app";
const gif = new URL("../../../docs/demo.gif", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const videos = mkdtempSync(join(tmpdir(), "dash-demo-"));
const size = { width: 1200, height: 760 };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: videos, size } });
const page = await context.newPage();
const recording = Date.now();
const pause = (ms) => page.waitForTimeout(ms);

/** A pointer drag dnd-kit recognizes, slow enough to watch. */
async function drag(source, target) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 });
  await page.mouse.up();
  await pause(400);
}

let started;
let ended;
try {
  await page.goto(url);
  const hide = page.getByRole("button", { name: "Hide" });
  if (await hide.isVisible().catch(() => false)) await hide.click();
  await page.locator('[data-visual="kpi-revenue"][data-state="ready"]').waitFor();
  started = Date.now();
  await pause(1500);

  // Build: a bar of Revenue by Category.
  await page.getByRole("button", { name: "New dashboard" }).click();
  await page.getByRole("button", { name: "Add Bar" }).click();
  const category = page.getByRole("group", { name: "Category", exact: true });
  const value = page.getByRole("group", { name: "Value", exact: true });
  await drag(page.getByRole("button", { name: "Category, dimension" }), category);
  await drag(page.getByRole("button", { name: "Revenue", exact: true }), value);
  await page.getByRole("textbox", { name: "Dashboard title" }).fill("Revenue by category");
  await pause(600);
  await page.getByRole("button", { name: "Save" }).click();
  await page.locator('[data-visual="bar-1"] [data-ready="true"]').waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await pause(1500);

  // Cross-filter: click the sample's first bar on the home dashboard.
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator('[data-visual="bar-category"] [data-ready="true"]').waitFor();
  await pause(800);
  const revenue = page.locator('[data-visual="kpi-revenue"]');
  const total = await revenue.textContent();
  await page
    .locator('[data-visual="bar-category"] svg path[fill]:not([fill="none"])')
    .first()
    .click();
  await page.getByRole("button", { name: /^Clear filter/ }).waitFor();
  // Hold until the other visuals show the filtered numbers.
  await page.waitForFunction(
    (before) => document.querySelector('[data-visual="kpi-revenue"]')?.textContent !== before,
    total,
  );
  await pause(2500);

  // Under the hood: security context, SQL, cache status.
  await page.getByText("Under the hood").scrollIntoViewIfNeeded();
  await page.getByText("Under the hood").click();
  await pause(600);
  await page.mouse.wheel(0, 350);
  await pause(2500);
  ended = Date.now();
} finally {
  // Remove the dashboard this run saved (the visitor is a fresh guest, so it is the only one).
  const open = page.getByRole("button", { name: "Open Revenue by category" });
  if (await open.isVisible().catch(() => false)) {
    await open.click();
    await page.getByRole("button", { name: "Delete dashboard" }).click();
    await pause(500);
  }
  await context.close();
  await browser.close();
}

const [video] = readdirSync(videos).filter((f) => f.endsWith(".webm"));
// From the first loaded dashboard to the drawer (the sign-in and the cleanup are cut), at 10 fps
// with one shared palette.
const skip = started ? (started - recording) / 1000 : 0;
const length = started && ended ? (ended - started) / 1000 : 20;
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    "-ss",
    String(skip),
    "-t",
    String(length),
    "-i",
    join(videos, video),
    "-vf",
    "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
    gif,
  ],
  { stdio: "inherit" },
);
rmSync(videos, { recursive: true, force: true });
console.log(
  `docs/demo.gif: ${(statSync(gif).size / 1e6).toFixed(1)} MB, about ${length.toFixed(0)} s`,
);
