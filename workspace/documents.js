import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
const exec = promisify(execFile);
export async function extractDocument(document) {
  try {
    let text;
    if (/\.txt$/i.test(document.name))
      text = await readFile(document.path, "utf8");
    else if (/\.docx$/i.test(document.name) && process.platform === "darwin")
      text = (
        await exec(
          "/usr/bin/textutil",
          ["-convert", "txt", "-stdout", document.path],
          { timeout: 20000, maxBuffer: 1000000 },
        )
      ).stdout;
    else if (/\.pdf$/i.test(document.name) && process.platform === "darwin")
      text = (
        await exec(
          "/usr/bin/swift",
          [
            fileURLToPath(new URL("./extract-pdf.swift", import.meta.url)),
            document.path,
          ],
          { timeout: 45000, maxBuffer: 1000000 },
        )
      ).stdout;
    else
      return {
        text: null,
        proposals: [],
        note: "Text extraction is unavailable on this system. Upload is retained; enter facts manually.",
      };
    text = text.slice(0, 100000);
    const emails = [
      ...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []),
    ];
    return {
      text,
      proposals:
        emails.length === 1
          ? [
              {
                key: "email",
                value: emails[0],
                sourceDocumentId: document.id,
                status: "unconfirmed",
              },
            ]
          : [],
      note: "Review extracted text and proposals; nothing is saved as a fact until you confirm your profile.",
    };
  } catch {
    return {
      text: null,
      proposals: [],
      note: "Text extraction failed or timed out. Original document retained. Enter profile facts manually.",
    };
  }
}
