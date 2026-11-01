import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Capture the actual bundled renderer, with the native bridge represented by
// sample-document actions. No documents from the user's filesystem are read.
const output = resolve("docs/assets");
const frames = join(tmpdir(), "folio-demo-frames");
await mkdir(output, { recursive: true });
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = path === "/" ? "index.html" : path.slice(1);
    if (file.includes("..")) throw Error("Invalid path");
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html",
    );
    res.end(await readFile(join("build/web", file)));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  headless: true,
  channel: process.env.FOLIO_TEST_BROWSER === "chromium" ? undefined : "chrome",
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 820 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => window.folioReady);
  const md = await readFile("examples/reading-room.md", "utf8");
  const html = await readFile("examples/diagram.html", "utf8");
  await page.evaluate(
    async ({ md, html }) => {
      const documents = [
        {
          path: "Examples/reading-room.md",
          name: "reading-room.md",
          source: md,
          kind: "md",
          base: "",
        },
        {
          path: "Examples/diagram.html",
          name: "diagram.html",
          source: html,
          kind: "html",
          base: "",
        },
      ];
      const activate = async (id) => {
        window.setTabs(
          documents.map((d) => ({ id: d.path, name: d.name })),
          id,
        );
        await window.loadDocument(documents.find((d) => d.path === id));
      };
      window.webkit = {
        messageHandlers: {
          folio: {
            postMessage: (message) => {
              if (message.action === "activateTab") return activate(message.id);
            },
          },
        },
      };
      await activate(documents[0].path);
    },
    { md, html },
  );
  let index = 0;
  const frame = async (name, copies = 2) => {
    await page.evaluate(() => document.fonts.ready);
    if (name) await page.screenshot({ path: join(output, name + ".png") });
    for (let i = 0; i < copies; i++)
      await page.screenshot({
        path: join(frames, String(index++).padStart(3, "0") + ".png"),
      });
  };
  await frame("reading-light", 3);
  await page.click("#sourceToggle");
  await frame(null, 2);
  await page.click("#sourceToggle");
  await page.getByRole("tab", { name: "diagram.html", exact: true }).click();
  await page.frameLocator("#htmlPreview").locator("svg").waitFor();
  await frame("html-preview", 3);
  await page.getByRole("tab", { name: "reading-room.md", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".mermaid svg").length === 2,
  );
  await page.click("#theme");
  await page.waitForFunction(
    () => document.querySelectorAll(".mermaid svg").length === 2,
  );
  await frame("reading-dark", 3);
  await page.click("#sidebarToggle");
  await frame(null, 2);
  await page.click("#sidebarToggle");
  await page.click("#theme");
  await page.waitForFunction(
    () => document.querySelectorAll(".mermaid svg").length === 2,
  );
  await page.locator("#export").selectOption("pdf");
  await frame(null, 1);
  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      "1",
      "-i",
      join(frames, "%03d.png"),
      "-vf",
      "fps=4,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop",
      "0",
      join(output, "folio-demo.gif"),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw Error(result.stderr || "Install ffmpeg to generate the GIF.");
  console.log("Saved screenshots and demo GIF to docs/assets");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
