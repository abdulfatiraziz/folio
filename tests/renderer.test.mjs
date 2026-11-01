import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
let server, browser, page, base;
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw Error();
      const data = await readFile(
        new URL("../build/web/" + file, import.meta.url),
      );
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    headless: true,
    channel:
      process.env.FOLIO_TEST_BROWSER === "chromium" ? undefined : "chrome",
  });
  page = await browser.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.folioReady);
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server?.close(r));
});
test("renders real Mermaid as SVG, tables and outline; exports SVG in standalone HTML", async () => {
  const source = await readFile(
    new URL("../examples/reading-room.md", import.meta.url),
    "utf8",
  );
  await page.evaluate(
    (source) => window.loadDocument({ source, name: "test.md", kind: "md" }),
    source,
  );
  assert.equal(await page.locator(".mermaid svg").count(), 2);
  assert.equal(await page.locator("#outline a").count(), 5);
  assert.equal(await page.locator("#document table").count(), 1);
  const output = await page.evaluate(() => window.folioExport("html"));
  assert.equal(output.diagrams.length, 2);
  assert.ok(output.html.includes("<svg"));
  assert.ok(output.text.includes("Details that matter"));
  assert.ok(!output.html.includes("bundle.js"));
});
test("strips active content from Markdown and keeps the source visible", async () => {
  await page.evaluate(() =>
    window.loadDocument({
      source:
        '# Safety\n<img src=x onerror="window.compromised=true"><script>window.compromised=true</script>',
      name: "unsafe.md",
      kind: "md",
    }),
  );
  assert.equal(await page.evaluate(() => window.compromised), undefined);
  assert.equal(
    await page.locator("#document script,#document [onerror]").count(),
    0,
  );
  await page.click("#sourceToggle");
  assert.ok(await page.locator("#source").isVisible());
});
test("reports malformed Mermaid without losing the document", async () => {
  await page.evaluate(() =>
    window.loadDocument({
      source: "# Still here\n```mermaid\nnot a diagram!!!\n```",
      name: "broken.md",
      kind: "md",
    }),
  );
  assert.equal(await page.locator(".diagram-error").count(), 1);
  assert.equal(await page.locator("#document h1").innerText(), "Still here");
});
test("HTML scripts are disabled by default, enabled in opaque-origin sandbox", async () => {
  const source = await readFile(
    new URL("../examples/diagram.html", import.meta.url),
    "utf8",
  );
  await page.evaluate(
    (source) =>
      window.loadDocument({ source, name: "diagram.html", kind: "html" }),
    source,
  );
  const frame = page.frameLocator("#htmlPreview");
  await frame.locator("#script-status").waitFor();
  assert.equal(
    await frame.locator("#script-status").innerText(),
    "Scripts are off.",
  );
  await page.check("#scripts");
  await page.waitForTimeout(300);
  assert.equal(
    await frame.locator("#script-status").innerText(),
    "Scripts are enabled in this isolated preview.",
  );
  assert.equal(
    await page.locator("#htmlPreview").getAttribute("sandbox"),
    "allow-scripts",
  );
  assert.ok(await frame.locator("svg").count());
});
test("tabs switch the document, preserve reading position, export the selected tab, and close independently", async () => {
  await page.evaluate(async () => {
    const docs = [
      {
        path: "/a/one.md",
        name: "one.md",
        kind: "md",
        source: "# First document\n\n" + "A paragraph to read.\n\n".repeat(150),
        base: "",
      },
      {
        path: "/b/two.md",
        name: "two.md",
        kind: "md",
        source: "# Second document\n\nDifferent content.",
        base: "",
      },
    ];
    let active = docs[0].path;
    const sync = () =>
      window.setTabs(
        docs.map((d) => ({ id: d.path, name: d.name })),
        active,
      );
    window.webkit = {
      messageHandlers: {
        folio: {
          postMessage: async (message) => {
            if (message.action === "activateTab") {
              active = message.id;
              sync();
              await window.loadDocument(docs.find((d) => d.path === active));
            } else if (message.action === "closeTab") {
              const i = docs.findIndex((d) => d.path === message.id);
              docs.splice(i, 1);
              sync();
            }
          },
        },
      },
    };
    sync();
    await window.loadDocument(docs[0]);
    document
      .getElementById("reader")
      .scrollTo({ top: 600, behavior: "instant" });
  });
  assert.equal(await page.getByRole("tab").count(), 2);
  await page.getByRole("tab", { name: "two.md", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#document h1")?.textContent === "Second document",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: "two.md", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.ok(
    (await page.evaluate(() => window.folioExport("html"))).source.includes(
      "Second document",
    ),
  );
  await page.getByRole("tab", { name: "one.md", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector("#document h1")?.textContent === "First document",
  );
  assert.ok(
    (await page.locator("#reader").evaluate((el) => el.scrollTop)) >= 590,
  );
  await page.getByRole("button", { name: "Close two.md", exact: true }).click();
  assert.equal(await page.getByRole("tab").count(), 1);
  assert.equal(
    await page.locator("#document h1").innerText(),
    "First document",
  );
});
test("HTML remains visible after repeated Markdown and source-view transitions", async () => {
  const html = await readFile(
    new URL("../examples/diagram.html", import.meta.url),
    "utf8",
  );
  for (let i = 0; i < 3; i++) {
    await page.evaluate(async (i) => {
      await window.loadDocument({
        path: "sample.md",
        name: "sample.md",
        kind: "md",
        source: "# Sample\n\n" + "Paragraph.\n\n".repeat(100),
      });
      document.getElementById("sourceToggle").click();
      document.getElementById("sourceToggle").click();
      document
        .getElementById("reader")
        .scrollTo({ top: 400, behavior: "instant" });
    }, i);
    await page.evaluate(
      (source) =>
        window.loadDocument({
          path: "diagram.html",
          name: "diagram.html",
          kind: "html",
          source,
        }),
      html,
    );
    assert.ok(
      await page.frameLocator("#htmlPreview").locator("svg").isVisible(),
    );
    assert.equal(
      await page
        .frameLocator("#htmlPreview")
        .locator("#script-status")
        .innerText(),
      "Scripts are off.",
    );
  }
});
