import { marked } from "marked";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import readerCSS from "./style.css";
const $ = (id) => document.getElementById(id);
const native = (action, data = {}) =>
  window.webkit?.messageHandlers?.folio?.postMessage({ action, ...data });
const welcome = `# A little space to read.

Open a Markdown or HTML file and settle in. Your documents, diagrams, and ideas belong together.

> **Made for your Mac.** Render locally, read comfortably, and take your work anywhere.

## See the whole picture

Mermaid diagrams render right alongside your writing. No connection required.

\`\`\`mermaid
flowchart LR
    A[Open a file] --> B[Make sense of it]
    B --> C[Share your ideas]
    style A fill:#e4efe8,stroke:#7b9d88,color:#284837
    style B fill:#e4efe8,stroke:#7b9d88,color:#284837
    style C fill:#e4efe8,stroke:#7b9d88,color:#284837
\`\`\`

## Bring your own format

| Open | Take away |
| --- | --- |
| Markdown & Mermaid | PDF, HTML, PNG, plain text |
| HTML & SVG diagrams | PDF, HTML, PNG, original source |
| Mermaid diagrams | Individual SVG files |

## Make yourself at home

- **Open a file** with ⌘O, or drop it anywhere in the window.
- Use **Source** to see the original alongside the preview.
- Switch appearance with **◐** and adjust the reading size below.
- Jump between headings in the sidebar.
- Use **⌘F** to find text and **⌘R** to reload a file.

Your original files are opened read-only. Exports are saved as new files.
`;
let state = {
  source: welcome,
  name: "Welcome to Folio",
  kind: "md",
  base: "",
  dark: localStorage.getItem("dark") === "true",
  size: Number(localStorage.getItem("size")) || 17,
};
let generation = 0;
function toast(message) {
  $("toast").textContent = message;
  $("toast").style.opacity = 1;
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => ($("toast").style.opacity = 0), 3500);
}
window.folioToast = toast;
function documentCSS() {
  return readerCSS;
}
function resolveAssets(root) {
  for (const element of root.querySelectorAll("[src],[href]")) {
    for (const attr of ["src", "href"]) {
      const value = element.getAttribute(attr);
      if (
        value &&
        !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(value) &&
        state.base
      ) {
        try {
          element.setAttribute(attr, new URL(value, state.base).href);
        } catch {}
      }
    }
  }
}
async function render() {
  const ticket = ++generation;
  document.body.classList.toggle("dark", state.dark);
  document.documentElement.style.setProperty("--size", state.size + "px");
  $("zoomLabel").textContent = state.size + " px";
  $("filename").textContent = state.name;
  $("filetype").textContent =
    state.kind === "html" ? "HTML DOCUMENT" : "MARKDOWN";
  $("breadcrumb").textContent = state.path || "Your reading space";
  $("source").textContent = state.source;
  $("htmlOptions").hidden = state.kind !== "html";
  $("document").hidden = state.kind === "html";
  $("htmlPreview").hidden = state.kind !== "html";
  $("outline").replaceChildren();
  $("status").textContent = "Rendering…";
  if (state.kind === "html") {
    // Recreate the iframe when changing HTML documents so a browsing context
    // previously hidden by a Markdown tab cannot retain a suspended layout.
    const previousFrame = $("htmlPreview");
    const frame = previousFrame.cloneNode(false);
    frame.removeAttribute("srcdoc");
    previousFrame.replaceWith(frame);
    frame.hidden = false;
    frame.setAttribute("sandbox", $("scripts").checked ? "allow-scripts" : "");
    const parsed = new DOMParser().parseFromString(state.source, "text/html");
    for (const base of parsed.querySelectorAll("base")) base.remove();
    const base = parsed.createElement("base");
    base.href = state.base || "about:blank";
    parsed.head.prepend(base);
    // CSP blocks navigation to local native APIs. The iframe has an opaque origin and no bridge.
    const policy = parsed.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content =
      "default-src 'self' data: blob: https: http: folio-local:; script-src 'unsafe-inline' 'unsafe-eval' https: http: folio-local:; style-src 'unsafe-inline' https: http: folio-local:; connect-src https: http:; object-src 'none'; frame-src 'none'; form-action 'none'";
    parsed.head.prepend(policy);
    frame.srcdoc = "<!doctype html>" + parsed.documentElement.outerHTML;
    $("outline").textContent = "HTML preview";
    $("stats").textContent = "Isolated HTML preview";
    $("status").textContent =
      "HTML · " + ($("scripts").checked ? "Scripts enabled" : "Scripts off");
    window.folioReady = true;
    return;
  }
  $("htmlPreview").srcdoc = "";
  $("document").innerHTML = DOMPurify.sanitize(
    marked.parse(state.source, { gfm: true, breaks: false }),
    {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_TAGS: ["input"],
      ADD_ATTR: ["checked", "disabled"],
    },
  );
  resolveAssets($("document"));
  const headings = [...$("document").querySelectorAll("h1,h2,h3")];
  headings.forEach((heading, index) => {
    heading.id = "heading-" + index;
    const a = document.createElement("a");
    a.href = "#" + heading.id;
    a.textContent = heading.textContent;
    a.dataset.depth = heading.tagName.slice(1);
    a.onclick = (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: "smooth" });
    };
    $("outline").append(a);
  });
  const words = $("document")
    .textContent.trim()
    .split(/\s+/)
    .filter(Boolean).length;
  $("stats").textContent =
    words.toLocaleString() +
    " words · " +
    Math.max(1, Math.ceil(words / 220)) +
    " min read";
  mermaid.initialize({
    startOnLoad: false,
    theme: state.dark ? "dark" : "base",
    securityLevel: "strict",
    themeVariables: {
      primaryColor: "#e4efe8",
      primaryTextColor: state.dark ? "#e2e7df" : "#284837",
      primaryBorderColor: "#7b9d88",
      lineColor: "#7b9d88",
      fontFamily: "-apple-system, sans-serif",
    },
  });
  let diagrams = 0,
    errors = 0;
  for (const code of [
    ...$("document").querySelectorAll("pre code.language-mermaid"),
  ]) {
    const block = document.createElement("div");
    block.className = "mermaid";
    const src = code.textContent;
    code.parentElement.replaceWith(block);
    try {
      const { svg } = await mermaid.render(
        "diagram-" + ticket + "-" + diagrams,
        src,
      );
      if (ticket !== generation) return;
      block.innerHTML = svg;
      diagrams++;
    } catch (error) {
      if (ticket !== generation) return;
      errors++;
      block.className = "diagram-error";
      block.textContent =
        "Diagram could not render: " +
        String(error.message || error).slice(0, 300);
      document
        .querySelectorAll('body > div[id^="ddiagram-"]')
        .forEach((el) => el.remove());
    }
  }
  if (ticket === generation) {
    $("status").textContent = errors
      ? errors + " diagram error(s)"
      : diagrams
        ? diagrams + " diagram" + (diagrams === 1 ? "" : "s") + " · Ready"
        : "Ready";
    window.folioReady = true;
  }
}
const positions = new Map();
let loading = false;
window.setTabs = (tabs, active) => {
  const list = $("tabs");
  list.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className = "file-tab" + (tab.id === active ? " selected" : "");
    const button = document.createElement("button");
    button.className = "tab-title";
    button.textContent = tab.name;
    button.title = tab.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab.id === active));
    button.onclick = () => native("activateTab", { id: tab.id });
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close " + tab.name);
    close.onclick = () => native("closeTab", { id: tab.id });
    item.append(button, close);
    list.append(item);
  }
  list
    .querySelector(".selected")
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
};
window.loadDocument = async (data) => {
  if (state.path && !loading)
    positions.set(state.path, {
      scroll: $("reader").scrollTop,
      scripts: $("scripts").checked,
    });
  state = { ...state, ...data };
  const saved = positions.get(state.path);
  if (state.kind === "html")
    $("reader").scrollTo({ top: 0, left: 0, behavior: "instant" });
  $("scripts").checked = saved?.scripts || false;
  window.folioReady = false;
  loading = true;
  const ticket = generation + 1;
  await render();
  if (ticket !== generation) return;
  if (state.kind !== "html")
    $("reader").scrollTo({ top: saved?.scroll || 0, behavior: "instant" });
  loading = false;
};
window.showWelcome = () =>
  window.loadDocument({
    source: welcome,
    name: "Welcome to Folio",
    kind: "md",
    base: "",
    path: "",
  });
$("newTab").onclick = () =>
  window.webkit ? native("open") : $("browserFile").click();

window.folioCommand = (command) => {
  if (command === "sidebar") $("sidebarToggle").click();
  if (command === "source") $("sourceToggle").click();
  if (command === "theme") $("theme").click();
  if (command === "larger") $("larger").click();
  if (command === "smaller") $("smaller").click();
};
window.folioExport = async (format) => {
  if ($("status").textContent === "Rendering…")
    throw Error("Wait for diagrams to finish rendering.");
  const diagrams = [...$("document").querySelectorAll(".mermaid svg")].map(
    (svg) => new XMLSerializer().serializeToString(svg),
  );
  let html = state.source;
  if (state.kind !== "html") {
    const content = $("document").cloneNode(true);
    // Embed local images so Markdown HTML exports remain portable.
    for (const img of content.querySelectorAll("img")) {
      if (img.src.startsWith("folio-local:")) {
        try {
          const response = await fetch(img.src);
          const blob = await response.blob();
          img.src = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
          });
        } catch {}
      }
    }
    html =
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      state.name.replace(/[<>&"]/g, "") +
      "</title><style>" +
      documentCSS() +
      '\nbody{padding:0}.prose{max-width:900px} .mermaid{break-inside:avoid} @media print{.prose{padding:20px}pre,blockquote,tr{break-inside:avoid}}</style></head><body class="' +
      (state.dark ? "dark" : "") +
      '"><article class="prose">' +
      content.innerHTML +
      "</article></body></html>";
  }
  return {
    html,
    text:
      state.kind === "html"
        ? new DOMParser().parseFromString(state.source, "text/html").body
            .textContent
        : $("document").innerText,
    source: state.source,
    diagrams,
    scripts: state.kind === "html" && $("scripts").checked,
    name: state.name,
    format,
  };
};
function setSidebar(collapsed) {
  $("sidebar").hidden = collapsed;
  $("sidebarToggle").setAttribute("aria-expanded", String(!collapsed));
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  $("sidebarToggle").setAttribute("aria-label", label);
  $("sidebarToggle").title = label + " (⌃⌘S)";
}
setSidebar(localStorage.getItem("sidebarCollapsed") === "true");
$("sidebarToggle").onclick = () => {
  const collapsed = !$("sidebar").hidden;
  setSidebar(collapsed);
  localStorage.setItem("sidebarCollapsed", String(collapsed));
};
$("open").onclick = () =>
  window.webkit ? native("open") : $("browserFile").click();
$("browserFile").onchange = async (e) => {
  for (const file of e.target.files)
    await window.loadDocument({
      source: await file.text(),
      name: file.name,
      kind: /\.html?$/i.test(file.name) ? "html" : "md",
      base: "",
      path: file.name,
    });
};
$("reload").onclick = () => native("reload");
$("theme").onclick = () => {
  state.dark = !state.dark;
  localStorage.setItem("dark", state.dark);
  render();
};
$("sourceToggle").onclick = () => {
  $("source").hidden = !$("source").hidden;
  $("sourceToggle").classList.toggle("active", !$("source").hidden);
};
$("scripts").onchange = render;
for (const [id, delta] of [
  ["larger", 1],
  ["smaller", -1],
])
  $(id).onclick = () => {
    state.size = Math.max(12, Math.min(28, state.size + delta));
    localStorage.setItem("size", state.size);
    document.documentElement.style.setProperty("--size", state.size + "px");
    $("zoomLabel").textContent = state.size + " px";
  };
$("export").onchange = (e) => {
  if (e.target.value) native("export", { format: e.target.value });
  e.target.value = "";
};
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a || a.closest("nav")) return;
  const href = a.getAttribute("href");
  if (href?.startsWith("#")) return;
  e.preventDefault();
  if (/^https?:/i.test(href)) native("link", { url: href });
  else if (href?.startsWith("folio-local:"))
    native("openRelative", { url: href });
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () =>
  document.body.classList.remove("dragging"),
);
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  document.body.classList.remove("dragging");
  const file = e.dataTransfer.files[0];
  if (file) {
    if (window.webkit) native("dropped", { name: file.name });
    else
      await window.loadDocument({
        source: await file.text(),
        name: file.name,
        kind: /\.html?$/i.test(file.name) ? "html" : "md",
      });
  }
});
render().then(() => native("ready"));
