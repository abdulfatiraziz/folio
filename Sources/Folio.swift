import Cocoa
import UniformTypeIdentifiers
import WebKit

final class LocalFiles: NSObject, WKURLSchemeHandler {
  var roots: [String: URL] = [:]
  func resolve(_ url: URL) -> URL? {
    let parts = url.pathComponents.filter { $0 != "/" }
    guard url.scheme == "folio-local", url.host == "document", let token = parts.first,
      let root = roots[token]
    else { return nil }
    let file = root.appendingPathComponent(parts.dropFirst().joined(separator: "/"))
      .standardizedFileURL.resolvingSymlinksInPath()
    guard file.path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else { return nil }
    return file
  }
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, let file = resolve(url),
      let data = try? Data(contentsOf: file)
    else {
      task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let mime =
      UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    task.didReceive(
      URLResponse(
        url: url, mimeType: mime, expectedContentLength: data.count,
        textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
    task.didReceive(data)
    task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
final class ReaderView: WKWebView {
  var onDrop: (([URL]) -> Void)?
  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { .copy }
  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    guard
      let urls = sender.draggingPasteboard.readObjects(
        forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL], !urls.isEmpty
    else { return false }
    onDrop?(urls)
    return true
  }
}
final class App: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
  var window: NSWindow!
  var web: ReaderView!
  let files = LocalFiles()
  var current: URL?
  var pending: [URL] = []
  var tabs: [URL] = []
  var tokens: [String: String] = [:]
  var ready = false
  var exportWeb: WKWebView?
  var exportWindow: NSWindow?
  var exportLoaded: (() -> Void)?
  var busy = false
  var timer: Timer?
  var lastModified: Date?
  var smokeDir: URL?
  var findPanel: NSPanel?
  var tabSmoke = false
  var tabSmokeStage = 0
  let allowed = ["md", "markdown", "mdown", "mkd", "mdwn", "mmd", "txt", "html", "htm"]
  func applicationDidFinishLaunching(_ notification: Notification) {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: "--smoke"), args.count > i + 1 {
      pending = [URL(fileURLWithPath: args[i + 1])]
    }
    if let i = args.firstIndex(of: "--out"), args.count > i + 1 {
      smokeDir = URL(fileURLWithPath: args[i + 1])
      try? FileManager.default.createDirectory(at: smokeDir!, withIntermediateDirectories: true)
    }
    if let i = args.firstIndex(of: "--tab-check"), args.count > i + 1 {
      pending.append(URL(fileURLWithPath: args[i + 1]))
      tabSmoke = true
    }
    NSApp.setActivationPolicy(.regular)
    buildMenu()
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(files, forURLScheme: "folio-local")
    config.userContentController.add(self, name: "folio")
    web = ReaderView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.onDrop = { [weak self] urls in self?.openFiles(urls) }
    web.registerForDraggedTypes([.fileURL])
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1200, height: 850),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
    )
    window.title = "Folio"
    window.minSize = NSSize(width: 820, height: 540)
    window.contentView = web
    window.center()
    window.setFrameAutosaveName("FolioReader")
    window.makeKeyAndOrderFront(nil)
    let url = Bundle.main.resourceURL!.appendingPathComponent("web/index.html")
    web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    NSApp.activate(ignoringOtherApps: true)
    timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
      self?.checkFile()
    }
    if smokeDir != nil {
      DispatchQueue.main.asyncAfter(deadline: .now() + 60) {
        print("SMOKE TIMEOUT")
        exit(2)
      }
    }
  }
  func buildMenu() {
    let menu = NSMenu()
    let a = NSMenu(title: "Folio")
    a.addItem(withTitle: "About Folio", action: #selector(about), keyEquivalent: "")
    a.addItem(.separator())
    a.addItem(
      withTitle: "Quit Folio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let ai = NSMenuItem()
    ai.submenu = a
    menu.addItem(ai)
    let f = NSMenu(title: "File")
    f.addItem(withTitle: "New Tab…", action: #selector(openPanel), keyEquivalent: "t")
    f.addItem(withTitle: "Open…", action: #selector(openPanel), keyEquivalent: "o")
    f.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
    f.addItem(.separator())
    for (title, format, key) in [
      ("Export PDF…", "pdf", "e"), ("Export HTML…", "html", ""), ("Export PNG…", "png", ""),
      ("Export Text…", "txt", ""), ("Export Source…", "source", ""),
      ("Export Diagram SVGs…", "svg", ""), ("Print…", "print", "p"),
    ] {
      let item = NSMenuItem(title: title, action: #selector(exportMenu(_:)), keyEquivalent: key)
      item.representedObject = format
      f.addItem(item)
    }
    f.addItem(.separator())
    f.addItem(withTitle: "Close Tab", action: #selector(closeCurrentTab), keyEquivalent: "w")
    let closeWindow = NSMenuItem(
      title: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "W")
    closeWindow.keyEquivalentModifierMask = [.command, .shift]
    f.addItem(closeWindow)
    let fi = NSMenuItem()
    fi.submenu = f
    menu.addItem(fi)
    let e = NSMenu(title: "Edit")
    for (title, action, key) in [
      ("Copy", #selector(NSText.copy(_:)), "c"),
      ("Select All", #selector(NSText.selectAll(_:)), "a"), ("Find…", #selector(find), "f"),
    ] { e.addItem(withTitle: title, action: action, keyEquivalent: key) }
    let ei = NSMenuItem()
    ei.submenu = e
    menu.addItem(ei)
    let v = NSMenu(title: "View")
    for (title, cmd, key) in [
      ("Next Tab", "nextTab", "]"), ("Previous Tab", "previousTab", "["),
      ("Toggle Sidebar", "sidebar", "s"), ("Toggle Source", "source", "u"),
      ("Switch Appearance", "theme", "d"), ("Larger Text", "larger", "+"),
      ("Smaller Text", "smaller", "-"),
    ] {
      let item = NSMenuItem(title: title, action: #selector(viewCommand(_:)), keyEquivalent: key)
      item.representedObject = cmd
      if cmd == "sidebar" { item.keyEquivalentModifierMask = [.command, .control] }
      if cmd == "nextTab" || cmd == "previousTab" {
        item.keyEquivalentModifierMask = [.command, .shift]
      }
      v.addItem(item)
    }
    let vi = NSMenuItem()
    vi.submenu = v
    menu.addItem(vi)
    NSApp.mainMenu = menu
  }
  @objc func about() {
    let a = NSAlert()
    a.messageText = "Folio"
    a.informativeText =
      "A local Markdown, Mermaid & HTML reader.\nVersion 1.0 · Built for your Mac."
    a.runModal()
  }
  @objc func openPanel() {
    let p = NSOpenPanel()
    p.allowedContentTypes = allowed.compactMap { UTType(filenameExtension: $0) }
    p.canChooseDirectories = false
    p.allowsMultipleSelection = true
    p.beginSheetModal(for: window) { [weak self] response in
      if response == .OK { self?.openFiles(p.urls) }
    }
  }
  func openFiles(_ urls: [URL]) {
    guard !busy else {
      toast("Finish the export before changing tabs.")
      return
    }
    let valid = urls.filter { allowed.contains($0.pathExtension.lowercased()) }.map {
      $0.standardizedFileURL.resolvingSymlinksInPath()
    }
    guard !valid.isEmpty else {
      alert("Choose Markdown, text, or HTML files.")
      return
    }
    guard ready else {
      pending.append(contentsOf: valid)
      return
    }
    var selected: URL?
    for url in valid {
      guard FileManager.default.isReadableFile(atPath: url.path) else {
        alert("Could not read \(url.lastPathComponent).")
        continue
      }
      if !tabs.contains(url) {
        tabs.append(url)
        let token = UUID().uuidString
        tokens[url.path] = token
        files.roots[token] = url.deletingLastPathComponent()
      }
      selected = url
      NSDocumentController.shared.noteNewRecentDocumentURL(url)
    }
    if let selected { activateTab(selected) }
  }
  func openFile(_ url: URL) { openFiles([url]) }
  func activateTab(_ url: URL) {
    guard !busy else {
      toast("Finish the export before changing tabs.")
      return
    }
    guard tabs.contains(url), let token = tokens[url.path] else { return }
    do {
      let source = try String(contentsOf: url, encoding: .utf8)
      current = url
      lastModified = modified(url)
      window.title = "\(url.lastPathComponent) — Folio"
      window.representedURL = url
      let data: [String: Any] = [
        "source": source, "name": url.lastPathComponent,
        "kind": ["html", "htm"].contains(url.pathExtension.lowercased()) ? "html" : "md",
        "base": "folio-local://document/\(token)/", "path": url.path,
      ]
      let list = tabs.map { ["id": $0.path, "name": $0.lastPathComponent] }
      web.callAsyncJavaScript(
        "window.setTabs(tabs, active); await window.loadDocument(data); return true",
        arguments: ["tabs": list, "active": url.path, "data": data], in: nil, in: .page
      ) { [weak self] result in
        if case .failure(let error) = result { self?.alert(error.localizedDescription) }
        if self?.smokeDir != nil { self?.runSmoke() }
      }
    } catch { alert("Could not read file: \(error.localizedDescription)") }
  }
  @objc func closeCurrentTab() {
    guard let current else { return }
    closeTab(current.path)
  }
  func closeTab(_ path: String) {
    guard !busy, let index = tabs.firstIndex(where: { $0.path == path }) else { return }
    let removed = tabs.remove(at: index)
    if let token = tokens.removeValue(forKey: removed.path) {
      files.roots.removeValue(forKey: token)
    }
    if tabs.isEmpty {
      current = nil
      lastModified = nil
      window.title = "Folio"
      window.representedURL = nil
      web.callAsyncJavaScript(
        "window.setTabs([], ''); await window.showWelcome()", arguments: [:], in: nil, in: .page,
        completionHandler: nil)
    } else if current == removed {
      activateTab(tabs[min(index, tabs.count - 1)])
    } else {
      web.callAsyncJavaScript(
        "window.setTabs(tabs, active)",
        arguments: [
          "tabs": tabs.map { ["id": $0.path, "name": $0.lastPathComponent] },
          "active": current?.path ?? "",
        ], in: nil, in: .page, completionHandler: nil)
    }
  }
  func stepTab(_ delta: Int) {
    guard !tabs.isEmpty else { return }
    let index = current.flatMap { tabs.firstIndex(of: $0) } ?? 0
    activateTab(tabs[(index + delta + tabs.count) % tabs.count])
  }
  func modified(_ url: URL) -> Date? {
    (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
  }
  func checkFile() {
    guard ready, !busy, let current else { return }
    let date = modified(current)
    if date != nil && date != lastModified { openFile(current) }
  }
  @objc func reload() { if let current { openFile(current) } }
  func application(_ sender: NSApplication, openFiles filenames: [String]) {
    openFiles(filenames.map { URL(fileURLWithPath: $0) })
    sender.reply(toOpenOrPrint: .success)
  }
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool
  {
    window.makeKeyAndOrderFront(nil)
    return true
  }
  @objc func viewCommand(_ sender: NSMenuItem) {
    if let cmd = sender.representedObject as? String {
      if cmd == "nextTab" {
        stepTab(1)
        return
      }
      if cmd == "previousTab" {
        stepTab(-1)
        return
      }
      web.evaluateJavaScript("window.folioCommand('\(cmd)')", completionHandler: nil)
    }
  }
  @objc func exportMenu(_ sender: NSMenuItem) {
    if let format = sender.representedObject as? String { requestExport(format) }
  }
  @objc func find() {
    if findPanel == nil {
      let p = NSPanel(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 95), styleMask: [.titled, .closable],
        backing: .buffered, defer: false)
      p.title = "Find in Document"
      let field = NSSearchField(frame: NSRect(x: 20, y: 35, width: 360, height: 28))
      field.target = self
      field.action = #selector(search(_:))
      field.placeholderString = "Find text, then press Return"
      p.contentView?.addSubview(field)
      findPanel = p
    }
    findPanel?.center()
    findPanel?.makeKeyAndOrderFront(nil)
  }
  @objc func search(_ field: NSSearchField) {
    let config = WKFindConfiguration()
    config.wraps = true
    web.find(field.stringValue, configuration: config) { _ in }
  }
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard message.frameInfo.isMainFrame, let origin = message.frameInfo.request.url,
      origin.isFileURL, origin.lastPathComponent == "index.html",
      let data = message.body as? [String: Any], let action = data["action"] as? String
    else { return }
    switch action {
    case "ready":
      ready = true
      if !pending.isEmpty {
        let urls = pending
        pending = []
        openFiles(urls)
      }
    case "activateTab":
      if let path = data["id"] as? String, let url = tabs.first(where: { $0.path == path }) {
        activateTab(url)
      }
    case "closeTab": if let path = data["id"] as? String { closeTab(path) }
    case "open": openPanel()
    case "reload": reload()
    case "export": if let format = data["format"] as? String { requestExport(format) }
    case "link":
      if let text = data["url"] as? String, let url = URL(string: text),
        ["http", "https"].contains(url.scheme ?? "")
      {
        NSWorkspace.shared.open(url)
      }
    case "openRelative":
      if let text = data["url"] as? String, let url = URL(string: text),
        let target = files.resolve(url)
      {
        openFile(target)
      }
    default: break
    }
  }
  func alert(_ message: String) {
    if smokeDir != nil {
      print("ERROR: \(message)")
      exit(1)
    }
    let a = NSAlert()
    a.messageText = "Folio"
    a.informativeText = message
    a.beginSheetModal(for: window)
  }
  func toast(_ message: String) {
    web.callAsyncJavaScript(
      "window.folioToast(message)", arguments: ["message": message], in: nil, in: .page,
      completionHandler: nil)
  }
  var stem: String { current?.deletingPathExtension().lastPathComponent ?? "Folio" }
  func requestExport(_ format: String) {
    guard !busy else {
      toast("An export is already in progress.")
      return
    }
    busy = true
    web.callAsyncJavaScript(
      "return await window.folioExport(format)", arguments: ["format": format], in: nil, in: .page
    ) { [weak self] result in
      guard let self else { return }
      switch result {
      case .failure(let error):
        self.busy = false
        self.alert(error.localizedDescription)
      case .success(let value):
        guard let data = value as? [String: Any] else {
          self.busy = false
          return
        }
        self.chooseExport(format, data: data)
      }
    }
  }
  func chooseExport(_ format: String, data: [String: Any]) {
    if format == "print" {
      renderExport(data: data) { [weak self] view in
        guard let self else { return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.topMargin = 36
        info.bottomMargin = 36
        info.leftMargin = 36
        info.rightMargin = 36
        let op = view.printOperation(with: info)
        op.runModal(for: self.window, delegate: nil, didRun: nil, contextInfo: nil)
        self.busy = false
      }
      return
    }
    if format == "svg" {
      let diagrams = data["diagrams"] as? [String] ?? []
      guard !diagrams.isEmpty else {
        busy = false
        toast("This document has no rendered Mermaid diagrams.")
        return
      }
      let p = NSOpenPanel()
      p.canChooseDirectories = true
      p.canChooseFiles = false
      p.canCreateDirectories = true
      p.prompt = "Export SVGs"
      p.beginSheetModal(for: window) { [weak self] response in
        guard let self else { return }
        defer { self.busy = false }
        if response == .OK, let dir = p.url {
          do {
            for (i, svg) in diagrams.enumerated() {
              try svg.write(
                to: dir.appendingPathComponent(
                  "\(self.stem)-diagram-\(i+1)-\(UUID().uuidString.prefix(6)).svg"),
                atomically: true, encoding: .utf8)
            }
            self.toast("Exported \(diagrams.count) SVG diagram(s).")
          } catch { self.alert(error.localizedDescription) }
        }
      }
      return
    }
    let ext = format == "source" ? (current?.pathExtension ?? "md") : format
    let p = NSSavePanel()
    p.nameFieldStringValue = "\(stem)-export.\(ext)"
    p.allowedContentTypes = [UTType(filenameExtension: ext) ?? .data]
    p.canCreateDirectories = true
    p.beginSheetModal(for: window) { [weak self] response in
      guard let self else { return }
      guard response == .OK, let url = p.url else {
        self.busy = false
        return
      }
      if self.tabs.contains(url.resolvingSymlinksInPath()) {
        self.busy = false
        self.alert("Choose a new filename to preserve your original.")
        return
      }
      self.save(format, data: data, to: url) { result in
        self.busy = false
        switch result {
        case .success: self.toast("Saved \(url.lastPathComponent)")
        case .failure(let error): self.alert(error.localizedDescription)
        }
      }
    }
  }
  func renderExport(data: [String: Any], completion: @escaping (WKWebView) -> Void) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(files, forURLScheme: "folio-local")
    config.defaultWebpagePreferences.allowsContentJavaScript = (data["scripts"] as? Bool) ?? false
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 800), configuration: config)
    view.navigationDelegate = self
    exportWeb = view
    let host = NSWindow(
      contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
    host.contentView = view
    host.orderBack(nil)
    exportWindow = host
    exportLoaded = { [weak self, weak view] in
      guard let self, let view else { return }
      view.callAsyncJavaScript(
        "await document.fonts.ready; await Promise.all(Array.from(document.images).map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r;setTimeout(r,4000)}))); return Math.max(document.body.scrollHeight,document.documentElement.scrollHeight)",
        arguments: [:], in: nil, in: .page
      ) { result in
        var height: CGFloat = 800
        if case .success(let value) = result, let h = value as? Double { height = CGFloat(h) }
        view.setFrameSize(NSSize(width: 1000, height: max(800, height)))
        self.exportWindow?.setContentSize(view.frame.size)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { completion(view) }
      }
    }
    view.loadHTMLString(
      data["html"] as? String ?? "", baseURL: URL(string: "folio-local://document/"))
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === exportWeb {
      let callback = exportLoaded
      exportLoaded = nil
      callback?()
    }
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    decisionHandler(webView === web && action.navigationType == .linkActivated ? .cancel : .allow)
  }
  func save(
    _ format: String, data: [String: Any], to url: URL,
    completion: @escaping (Result<Void, Error>) -> Void
  ) {
    if ["html", "txt", "source"].contains(format) {
      do {
        let key = format == "txt" ? "text" : format
        try (data[key] as? String ?? "").write(to: url, atomically: true, encoding: .utf8)
        completion(.success(()))
      } catch { completion(.failure(error)) }
      return
    }
    renderExport(data: data) { [weak self] view in
      let finish: (Result<Void, Error>) -> Void = { result in
        self?.exportWindow?.orderOut(nil)
        self?.exportWindow = nil
        self?.exportWeb = nil
        completion(result)
      }
      if format == "pdf" {
        let config = WKPDFConfiguration()
        config.rect = CGRect(origin: .zero, size: view.frame.size)
        view.createPDF(configuration: config) { result in
          finish(result.flatMap { bytes in Result { try bytes.write(to: url) } })
        }
      } else if format == "png" {
        if view.frame.height > 30000 {
          finish(
            .failure(
              NSError(
                domain: "Folio", code: 3,
                userInfo: [
                  NSLocalizedDescriptionKey:
                    "This document is too tall for a PNG. Use PDF or HTML for the complete document."
                ])))
          return
        }
        let config = WKSnapshotConfiguration()
        config.rect = CGRect(origin: .zero, size: view.frame.size)
        config.snapshotWidth = 1000
        view.takeSnapshot(with: config) { image, error in
          if let error {
            finish(.failure(error))
            return
          }
          guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
          else {
            finish(
              .failure(
                NSError(
                  domain: "Folio", code: 1,
                  userInfo: [NSLocalizedDescriptionKey: "Could not create image."])))
            return
          }
          do {
            try png.write(to: url)
            finish(.success(()))
          } catch { finish(.failure(error)) }
        }
      } else {
        finish(.failure(NSError(domain: "Folio", code: 2)))
      }
    }
  }
  func runSmoke() {
    guard let dir = smokeDir else { return }
    if tabSmoke && tabSmokeStage == 0 {
      guard tabs.count == 2, let first = tabs.first else {
        print("TAB SMOKE FAILED: expected two tabs")
        exit(1)
      }
      tabSmokeStage = 1
      activateTab(first)
      return
    }
    if tabSmoke && tabSmokeStage == 1 {
      guard tabs.count == 2, current == tabs.first, let last = tabs.last, let first = tabs.first
      else {
        print("TAB SMOKE FAILED: switching")
        exit(1)
      }
      closeTab(last.path)
      tabSmokeStage = 2
      openFiles([first])
      return
    }
    if tabSmoke && tabSmokeStage == 2 {
      guard tabs.count == 1, current == tabs.first else {
        print("TAB SMOKE FAILED: close or deduplication")
        exit(1)
      }
      tabSmokeStage = 3
      print("TAB SMOKE OK: multi-open, switch, close background tab, deduplicate")
    }
    busy = true
    web.callAsyncJavaScript(
      "return await window.folioExport('html')", arguments: [:], in: nil, in: .page
    ) { [weak self] result in
      guard let self else { return }
      guard case .success(let value) = result, let data = value as? [String: Any] else {
        print("SMOKE FAILED: \(result)")
        exit(1)
      }
      do {
        try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys])
          .write(to: dir.appendingPathComponent("payload.json"))
        try (data["html"] as? String ?? "").write(
          to: dir.appendingPathComponent("document.html"), atomically: true, encoding: .utf8)
        try (data["text"] as? String ?? "").write(
          to: dir.appendingPathComponent("document.txt"), atomically: true, encoding: .utf8)
      } catch {
        print(error)
        exit(1)
      }
      self.web.takeSnapshot(with: nil) { image, _ in
        if let bytes = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: bytes),
          let png = bitmap.representation(using: .png, properties: [:])
        {
          try? png.write(to: dir.appendingPathComponent("app.png"))
        }
      }
      self.save("pdf", data: data, to: dir.appendingPathComponent("document.pdf")) { result in
        if case .failure(let error) = result {
          print(error)
          exit(1)
        }
        self.save("png", data: data, to: dir.appendingPathComponent("document.png")) { result in
          if case .failure(let error) = result {
            print(error)
            exit(1)
          }
          print("SMOKE OK: \(dir.path)")
          exit(0)
        }
      }
    }
  }
}
let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.run()
