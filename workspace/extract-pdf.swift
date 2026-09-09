import Foundation
import PDFKit
if CommandLine.arguments.count != 2 { exit(1) }
guard let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else { exit(2) }
let text = doc.string ?? ""
print(String(text.prefix(100000)))
