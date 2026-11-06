## Folio 1.1.0

Folio can now edit documents and hold comments.

- **Edit and save.** Press **Edit** (⌘U) to type in the Markdown or HTML source with a live preview. Save with ⌘S, Save As with ⌘⇧S, or start a new document with ⌘N. Folio asks before closing a tab or quitting with unsaved changes, and never overwrites unsaved edits when a file changes on disk.
- **Comments.** Select text in the preview and click **Comment** (or ⌘⌥M). Comments are highlighted in the document and listed in a side panel (⌘⇧K), where you can edit or delete them. They are saved inside the Markdown file as one hidden HTML comment block, so they travel with the file and stay invisible in other Markdown viewers. They follow their text through edits.
- Undo, Redo, Cut, and Paste in the Edit menu.

Comments are available for Markdown documents; HTML documents can be edited but not commented.

**Install:** download Folio.zip, unzip, and move Folio.app into Applications. Same requirements as 1.0: Apple Silicon, macOS 14 or later, ad-hoc signed and not notarized.

## Folio 1.0.0

Folio's first public release: a small native macOS reader for Markdown, Mermaid diagrams, and HTML.

- Multiple document tabs, with multi-file Open and drag-and-drop.
- Offline Markdown and Mermaid rendering, including SVG diagrams.
- HTML/SVG previews with an optional isolated script mode.
- Light/dark appearance, a collapsible heading sidebar, source view, and search.
- PDF, HTML, PNG, text, source, and Mermaid SVG exports, plus native printing.

**Install:** download Folio.zip, unzip, and move Folio.app into Applications.

**Requirements:** Apple Silicon, macOS 14 or later. This build is ad-hoc signed and is not notarized by Apple; macOS may require approval before opening a downloaded app. Source and build instructions are included in the repository.

**Known limits:** PDF export is one continuous page (use Print for paginated output); tabs last for the current session; parent-relative assets are blocked; dynamic HTML chart exports may not capture transient state.
