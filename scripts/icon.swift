import Cocoa

let out = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedRed: 0.15, green: 0.30, blue: 0.24, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 20, y: 20, width: 984, height: 984), xRadius: 215, yRadius: 215)
  .fill()
NSColor(calibratedRed: 0.94, green: 0.93, blue: 0.87, alpha: 1).setFill()
let page = NSBezierPath(
  roundedRect: NSRect(x: 230, y: 210, width: 570, height: 640), xRadius: 30, yRadius: 30)
page.fill()
let style = NSMutableParagraphStyle()
style.alignment = .center
let text: NSString = "f."
text.draw(
  in: NSRect(x: 235, y: 210, width: 540, height: 650),
  withAttributes: [
    .font: NSFont(name: "Georgia-Italic", size: 540) ?? NSFont.systemFont(ofSize: 540),
    .foregroundColor: NSColor(calibratedRed: 0.21, green: 0.40, blue: 0.31, alpha: 1),
    .paragraphStyle: style,
  ])
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
