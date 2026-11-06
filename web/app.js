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
- Use **Edit** (⌘U) to type and change text, with a live preview. Save with **⌘S**.
- Select any text in the preview and click **Comment** to leave a note on it.
- Switch appearance with **◐** and adjust the reading size below.
- Jump between headings in the sidebar.
- Use **⌘F** to find text and **⌘R** to reload a file.

Nothing is written to your files until you save. Exports are saved as new files.
`;
let state = {
  source: welcome,
  name: "Welcome to Folio",
  kind: "md",
  base: "",
  dark: localStorage.getItem("dark") === "true",
  size: Number(localStorage.getItem("size")) || 17,
  comments: [],
};
let generation = 0;

// ---- Editing and comments -------------------------------------------------
// Comments live at the end of the Markdown file in one HTML comment block, so
// they travel with the document and stay invisible in other Markdown viewers.
const COMMENTS_RE = /\n*<!-- folio-comments\n([\s\S]*?)\n-->\s*$/;
function splitComments(text) {
  const match = text.match(COMMENTS_RE);
  if (match) {
    try {
      const list = JSON.parse(match[1]);
      if (Array.isArray(list))
        return {
          body: text.slice(0, match.index) + "\n",
          comments: list.filter(
            (c) =>
              c && typeof c.quote === "string" && typeof c.text === "string",
          ),
        };
    } catch {}
  }
  return { body: text, comments: [] };
}
function joinComments(body, comments) {
  if (!comments?.length) return body;
  const json = comments
    .map((c) =>
      JSON.stringify({
        id: c.id,
        quote: c.quote,
        prefix: c.prefix || "",
        suffix: c.suffix || "",
        text: c.text,
        created: c.created,
      }).replace(/-->/g, "--\\u003e"),
    )
    .join(",\n");
  return (
    body.replace(/\s*$/, "\n") + "\n<!-- folio-comments\n[\n" + json + "\n]\n-->\n"
  );
}
// Unsaved work per document path ("" is the welcome page).
const drafts = new Map();
const keyOf = () => state.path || "";
function isDirty(key = keyOf()) {
  return drafts.get(key)?.dirty === true;
}
function markDirty() {
  drafts.set(keyOf(), {
    body: state.source,
    comments: state.comments,
    dirty: true,
  });
  native("dirty", { id: keyOf(), dirty: true });
  updateDirtyUI();
}
function updateDirtyUI() {
  const dirty = isDirty();
  $("dirty").hidden = !dirty;
  $("save").hidden = !dirty;
  if (lastTabs) window.setTabs(...lastTabs);
}
window.folioContent = (path) => {
  const key = path ?? keyOf();
  if (key === keyOf())
    return {
      content: joinComments(state.source, state.comments),
      name: state.name,
      kind: state.kind,
      dirty: isDirty(key),
    };
  const draft = drafts.get(key);
  return draft
    ? { content: joinComments(draft.body, draft.comments), dirty: true }
    : null;
};
window.folioSaved = (path) => {
  drafts.delete(path ?? keyOf());
  updateDirtyUI();
};
window.folioDiscard = (path) => {
  drafts.delete(path ?? keyOf());
  updateDirtyUI();
};
const diagramCache = new Map();
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
  if ($("source").value !== state.source) {
    // A new document opens at the top; typing never reaches this branch.
    $("source").value = state.source;
    $("source").setSelectionRange(0, 0);
    $("source").scrollTop = 0;
  }
  $("source").placeholder =
    state.kind === "html" ? "Type HTML here…" : "Type Markdown here…";
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
    renderComments();
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
    const cacheKey = (state.dark ? "dark:" : "light:") + src;
    if (diagramCache.has(cacheKey)) {
      block.innerHTML = diagramCache.get(cacheKey);
      diagrams++;
      continue;
    }
    try {
      const { svg } = await mermaid.render(
        "diagram-" + ticket + "-" + diagrams,
        src,
      );
      if (ticket !== generation) return;
      block.innerHTML = svg;
      if (diagramCache.size > 50) diagramCache.clear();
      diagramCache.set(cacheKey, svg);
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
    applyHighlights();
    renderComments();
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
let lastTabs = null;
window.setTabs = (tabs, active) => {
  lastTabs = [tabs, active];
  const list = $("tabs");
  list.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement("div");
    item.className =
      "file-tab" +
      (tab.id === active ? " selected" : "") +
      (isDirty(tab.id) ? " dirty" : "");
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
  const key = "path" in data ? data.path || "" : keyOf();
  const draft = drafts.get(key);
  const parsed = draft?.dirty
    ? { body: draft.body, comments: draft.comments }
    : splitComments(data.source ?? "");
  state = { ...state, ...data, source: parsed.body, comments: parsed.comments };
  hideCommentUI();
  updateDirtyUI();
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
  if (command === "source" || command === "edit") $("sourceToggle").click();
  if (command === "editOn" && $("source").hidden) $("sourceToggle").click();
  if (command === "comments") $("commentsToggle").click();
  if (command === "comment") startComment();
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
    for (const mark of content.querySelectorAll("mark.comment-mark"))
      mark.replaceWith(...mark.childNodes);
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
    source: joinComments(state.source, state.comments),
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
  if (!$("source").hidden) $("source").focus();
};
let editTimer;
$("source").addEventListener("input", () => {
  state.source = $("source").value;
  markDirty();
  clearTimeout(editTimer);
  editTimer = setTimeout(render, state.kind === "html" ? 700 : 250);
});
$("source").addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    document.execCommand("insertText", false, "  ");
  }
});
$("save").onclick = () =>
  window.webkit ? native("save") : toast("Saving needs the Folio app.");
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
  const mark = e.target.closest?.("mark.comment-mark");
  if (mark && window.getSelection().isCollapsed)
    focusComment(mark.dataset.comment, false);
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

// ---- Comment anchoring --------------------------------------------------
// Each comment stores the quoted text plus a little context on either side,
// then is re-found in the rendered document every time it renders.
function textIndex() {
  const root = $("document");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement.closest(".mermaid, .diagram-error, svg")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  let text = "";
  for (let n; (n = walker.nextNode()); ) {
    nodes.push({ node: n, start: text.length });
    text += n.data;
  }
  return { nodes, text };
}
function offsetOf(index, container, offset) {
  const probe = document.createRange();
  probe.setStart(container, offset);
  for (const { node, start } of index.nodes) {
    if (node === container) return start + offset;
    if (probe.comparePoint(node, 0) >= 0) return start;
  }
  return index.text.length;
}
function sharedEnd(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function sharedStart(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
function locate(text, c) {
  let best = -1,
    bestScore = -1;
  if (!c.quote) return -1;
  for (let i = text.indexOf(c.quote); i !== -1; i = text.indexOf(c.quote, i + 1)) {
    const end = i + c.quote.length;
    const score =
      sharedEnd(text.slice(Math.max(0, i - (c.prefix || "").length), i), c.prefix || "") +
      sharedStart(text.slice(end, end + (c.suffix || "").length), c.suffix || "");
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return best;
}
function wrapRange(s, e, id) {
  const index = textIndex();
  for (const { node, start } of index.nodes) {
    const end = start + node.data.length;
    if (end <= s || start >= e) continue;
    const a = Math.max(s, start) - start,
      b = Math.min(e, end) - start;
    if (!node.data.slice(a, b).trim()) continue;
    const range = document.createRange();
    range.setStart(node, a);
    range.setEnd(node, b);
    const mark = document.createElement("mark");
    mark.className = "comment-mark";
    mark.dataset.comment = id;
    range.surroundContents(mark);
  }
}
const orphans = new Set();
function applyHighlights() {
  const root = $("document");
  for (const mark of root.querySelectorAll("mark.comment-mark"))
    mark.replaceWith(...mark.childNodes);
  root.normalize();
  orphans.clear();
  if (state.kind === "html") return;
  for (const c of state.comments) {
    const at = locate(textIndex().text, c);
    if (at < 0) orphans.add(c.id);
    else wrapRange(at, at + c.quote.length, c.id);
  }
}
function formatDate(value) {
  const date = new Date(value);
  return isNaN(date)
    ? ""
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
function renderComments() {
  const list = $("commentList");
  list.replaceChildren();
  const count = state.comments.length;
  $("commentCount").textContent = count ? String(count) : "";
  if (state.kind === "html") {
    const note = document.createElement("p");
    note.className = "comments-empty";
    note.textContent =
      "Comments work on Markdown documents. You can still edit this HTML with Edit.";
    list.append(note);
    return;
  }
  if (!count) {
    const note = document.createElement("p");
    note.className = "comments-empty";
    note.textContent =
      "Select any text in the document, then click Comment to add a note.";
    list.append(note);
    return;
  }
  // Show comments in reading order; ones whose text was removed go last.
  const index = textIndex();
  const order = (c) => (orphans.has(c.id) ? Infinity : locate(index.text, c));
  for (const c of [...state.comments].sort((a, b) => order(a) - order(b))) {
    const card = document.createElement("div");
    card.className = "comment-card" + (orphans.has(c.id) ? " orphan" : "");
    card.dataset.id = c.id;
    const quote = document.createElement("blockquote");
    quote.textContent =
      c.quote.length > 140 ? c.quote.slice(0, 140) + "…" : c.quote;
    const body = document.createElement("div");
    body.className = "comment-text";
    body.textContent = c.text;
    const meta = document.createElement("div");
    meta.className = "comment-meta";
    const when = document.createElement("span");
    when.textContent = orphans.has(c.id)
      ? "Text no longer in document"
      : formatDate(c.created);
    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.onclick = (e) => {
      e.stopPropagation();
      editComment(card, c);
    };
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.setAttribute("aria-label", "Delete comment");
    del.onclick = (e) => {
      e.stopPropagation();
      state.comments = state.comments.filter((x) => x.id !== c.id);
      markDirty();
      applyHighlights();
      renderComments();
    };
    const actions = document.createElement("span");
    actions.className = "comment-actions";
    actions.append(edit, del);
    meta.append(when, actions);
    card.append(quote, body, meta);
    card.onclick = () => focusComment(c.id, true);
    list.append(card);
  }
}
function editComment(card, c) {
  const body = card.querySelector(".comment-text");
  const area = document.createElement("textarea");
  area.value = c.text;
  area.rows = 3;
  const done = (save) => {
    if (save && area.value.trim() && area.value.trim() !== c.text) {
      state.comments = state.comments.map((x) =>
        x.id === c.id ? { ...x, text: area.value.trim() } : x,
      );
      markDirty();
    }
    renderComments();
  };
  area.onkeydown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) done(true);
    if (e.key === "Escape") done(false);
  };
  area.onclick = (e) => e.stopPropagation();
  area.onblur = () => done(true);
  body.replaceWith(area);
  area.focus();
}
function setCommentsPanel(open) {
  $("comments").hidden = !open;
  $("commentsToggle").classList.toggle("active", open);
  try {
    localStorage.setItem("commentsOpen", String(open));
  } catch {}
}
function focusComment(id, scroll) {
  setCommentsPanel(true);
  for (const el of document.querySelectorAll(".comment-card.active, mark.comment-mark.active"))
    el.classList.remove("active");
  const card = $("commentList").querySelector(`[data-id="${CSS.escape(id)}"]`);
  card?.classList.add("active");
  card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const marks = $("document").querySelectorAll(
    `mark.comment-mark[data-comment="${CSS.escape(id)}"]`,
  );
  marks.forEach((m) => m.classList.add("active"));
  if (scroll) marks[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
}
let pendingAnchor = null;
function selectionAnchor() {
  if (state.kind === "html") return null;
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!$("document").contains(range.commonAncestorContainer)) return null;
  const index = textIndex();
  let s = offsetOf(index, range.startContainer, range.startOffset);
  let e = offsetOf(index, range.endContainer, range.endOffset);
  while (s < e && /\s/.test(index.text[s])) s++;
  while (e > s && /\s/.test(index.text[e - 1])) e--;
  if (e <= s) return null;
  return {
    quote: index.text.slice(s, e),
    prefix: index.text.slice(Math.max(0, s - 32), s),
    suffix: index.text.slice(e, e + 32),
    rect: range.getBoundingClientRect(),
  };
}
function place(el, rect, below) {
  el.hidden = false;
  const width = el.offsetWidth,
    height = el.offsetHeight;
  let left = Math.min(
    Math.max(12, rect.left + rect.width / 2 - width / 2),
    window.innerWidth - width - 12,
  );
  let top = below ? rect.bottom + 8 : rect.top - height - 8;
  if (top < 12) top = rect.bottom + 8;
  if (top + height > window.innerHeight - 12)
    top = Math.max(12, window.innerHeight - height - 12);
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function hideCommentUI() {
  $("commentButton").hidden = true;
  $("composer").hidden = true;
  pendingAnchor = null;
}
function showCommentButton() {
  if (!$("composer").hidden) return;
  const anchor = selectionAnchor();
  if (!anchor) {
    $("commentButton").hidden = true;
    return;
  }
  pendingAnchor = anchor;
  place($("commentButton"), anchor.rect, false);
}
function startComment() {
  const anchor = selectionAnchor() || pendingAnchor;
  if (!anchor) {
    toast("Select some text in the document to comment on it.");
    return;
  }
  pendingAnchor = anchor;
  $("commentButton").hidden = true;
  $("composerQuote").textContent =
    anchor.quote.length > 120 ? anchor.quote.slice(0, 120) + "…" : anchor.quote;
  $("composerText").value = "";
  place($("composer"), anchor.rect, true);
  $("composerText").focus();
}
function saveComment() {
  const text = $("composerText").value.trim();
  if (!text || !pendingAnchor) return;
  const { quote, prefix, suffix } = pendingAnchor;
  const id =
    "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  state.comments = [
    ...state.comments,
    { id, quote, prefix, suffix, text, created: new Date().toISOString() },
  ];
  hideCommentUI();
  window.getSelection().removeAllRanges();
  markDirty();
  applyHighlights();
  renderComments();
  focusComment(id, false);
}
$("reader").addEventListener("mouseup", () => setTimeout(showCommentButton));
$("reader").addEventListener("keyup", (e) => {
  if (e.shiftKey) showCommentButton();
});
$("reader").addEventListener("scroll", () => {
  $("commentButton").hidden = true;
});
document.addEventListener("selectionchange", () => {
  if (window.getSelection().isCollapsed) $("commentButton").hidden = true;
});
$("commentButton").onmousedown = (e) => e.preventDefault();
$("commentButton").onclick = startComment;
$("composerSave").onclick = saveComment;
$("composerCancel").onclick = hideCommentUI;
$("composerText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveComment();
  if (e.key === "Escape") hideCommentUI();
});
$("commentsToggle").onclick = () => setCommentsPanel($("comments").hidden);
$("commentsClose").onclick = () => setCommentsPanel(false);
try {
  setCommentsPanel(localStorage.getItem("commentsOpen") === "true");
} catch {}
render().then(() => native("ready"));
