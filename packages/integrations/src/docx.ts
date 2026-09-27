import { deflateRawSync } from "node:zlib";

/**
 * A small, dependency-free Word (.docx) writer for Persian documents: every paragraph is
 * bidi (right-to-left), Persian runs carry `w:rtl` and Vazirmatn is the default font for
 * both Latin and complex-script text. Latin words (URLs, code, names) stay in LTR runs so
 * Word orders them correctly inside the RTL paragraph.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A deflated ZIP archive (the OOXML container) from path → bytes. */
export function writeZip(entries: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);
    // Fixed DOS timestamp (1980-01-01 00:00) keeps output deterministic.
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, name, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

/** Drops the C0 controls (except tab, newline, carriage return) and U+FFFE/U+FFFF that XML 1.0 cannot carry. */
const xmlSafe = (text: string) =>
  Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        (code >= 32 || code === 9 || code === 10 || code === 13) &&
        code !== 0xfffe &&
        code !== 0xffff
      );
    })
    .join("");

const xmlEscape = (text: string) =>
  xmlSafe(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]/;
const LATIN = /[A-Za-z]/;

type Style = { bold?: boolean; code?: boolean; color?: string };

/** Runs for one span of text, split so Latin words are LTR runs and everything else is RTL. */
function runs(text: string, style: Style = {}): string {
  const tokens = text.split(/(\s+)/).filter(Boolean);
  const ltr = tokens.map((token) =>
    /^\s+$/.test(token) ? undefined : LATIN.test(token) && !ARABIC_SCRIPT.test(token),
  );
  // Whitespace joins an LTR run only when both neighbours are LTR.
  const resolved = ltr.map((value, i) => value ?? (ltr[i - 1] === true && ltr[i + 1] === true));
  const groups: { text: string; ltr: boolean }[] = [];
  tokens.forEach((token, i) => {
    const last = groups.at(-1);
    if (last && last.ltr === resolved[i]) last.text += token;
    else groups.push({ text: token, ltr: resolved[i] });
  });
  return groups
    .map((group) => {
      const props = [
        style.code
          ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Vazirmatn"/>'
          : undefined,
        style.bold ? "<w:b/><w:bCs/>" : undefined,
        style.color ? `<w:color w:val="${style.color}"/>` : undefined,
        group.ltr ? undefined : "<w:rtl/>",
      ]
        .filter(Boolean)
        .join("");
      return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlEscape(group.text)}</w:t></w:r>`;
    })
    .join("");
}

/** Inline markdown (**bold**, `code`) into runs. */
function inlineRuns(text: string, base: Style = {}): string {
  const parts: string[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(runs(text.slice(last, match.index), base));
    parts.push(
      match[1] !== undefined
        ? runs(match[1], { ...base, bold: true })
        : runs(match[2], { ...base, code: true }),
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(runs(text.slice(last), base));
  return parts.join("");
}

function paragraph(
  content: string,
  options: { style?: string; indent?: boolean; rule?: boolean; keepNext?: boolean } = {},
): string {
  const props = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : "",
    options.keepNext ? "<w:keepNext/>" : "",
    options.rule
      ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C8D0D2"/></w:pBdr>'
      : "",
    "<w:bidi/>",
    options.indent ? '<w:ind w:start="425" w:hanging="283"/>' : "",
  ].join("");
  return `<w:p><w:pPr>${props}</w:pPr>${content}</w:p>`;
}

const toPersianDigits = (text: string) => text.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

function table(rows: string[][]): string {
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const width = Math.floor(9000 / columns);
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="C8D0D2"/>`)
    .join("");
  const margins =
    '<w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/>';
  const grid = `<w:gridCol w:w="${width}"/>`.repeat(columns);
  const body = rows
    .map((row, index) => {
      const cells = Array.from(
        { length: columns },
        (_, i) =>
          `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(inlineRuns(row[i] ?? "", { bold: index === 0 }))}</w:tc>`,
      );
      return `<w:tr>${cells.join("")}</w:tr>`;
    })
    .join("");
  // bidiVisual puts the first column on the right, like the RTL PDF tables.
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders><w:tblCellMar>${margins}</w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

/** The markdown subset of pdf-html.ts (headings, lists, tables, rules, paragraphs) as Word XML. */
export function markdownToWordXml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraphLines: string[] = [];
  const flush = () => {
    if (paragraphLines.length)
      out.push(
        paragraph(paragraphLines.map((line) => inlineRuns(line)).join("<w:r><w:br/></w:r>")),
      );
    paragraphLines = [];
  };
  let number = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*([0-9۰-۹]+)[.)]\s+(.*)$/.exec(line);
    if (!numbered) number = 0;
    if (!line.trim()) flush();
    else if (heading) {
      flush();
      out.push(
        paragraph(inlineRuns(heading[2]), {
          style: `Heading${heading[1].length + 1}`,
          keepNext: true,
        }),
      );
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flush();
      out.push(paragraph("", { rule: true }));
    } else if (line.trim().startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) continue;
        rows.push(tableCells(lines[i]));
      }
      i--;
      if (rows.length) out.push(table(rows), paragraph(""));
    } else if (bullet) {
      flush();
      out.push(paragraph(runs("•\t") + inlineRuns(bullet[1]), { indent: true }));
    } else if (numbered) {
      flush();
      number++;
      out.push(
        paragraph(runs(`${toPersianDigits(String(number))}.\t`) + inlineRuns(numbered[2]), {
          indent: true,
        }),
      );
    } else paragraphLines.push(line.trim());
  }
  flush();
  return out.join("");
}

export interface WordBlock {
  /** A small bold label above the block (e.g. who wrote a message). */
  label?: string;
  labelColor?: string;
  markdown: string;
}

/** A complete Persian RTL .docx with a title, a meta line and labelled markdown blocks. */
export function createPersianDocx(options: {
  title: string;
  meta?: string;
  blocks: WordBlock[];
  created?: Date;
}): Uint8Array<ArrayBuffer> {
  const body = [
    paragraph(inlineRuns(options.title), { style: "Title" }),
    options.meta ? paragraph(runs(options.meta), { style: "Meta" }) : "",
    ...options.blocks.map(
      (block) =>
        (block.label
          ? paragraph(runs(block.label, { bold: true, color: block.labelColor }), {
              style: "Label",
              keepNext: true,
            })
          : "") + markdownToWordXml(block.markdown),
    ),
  ].join("");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1021" w:bottom="1134" w:left="1021" w:header="708" w:footer="708" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
  const font =
    '<w:rFonts w:ascii="Vazirmatn" w:hAnsi="Vazirmatn" w:eastAsia="Vazirmatn" w:cs="Vazirmatn"/>';
  const style = (id: string, name: string, pPr: string, rPr: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr>${pPr}<w:bidi/></w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
  const size = (halfPoints: number) =>
    `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr>${font}${size(22)}<w:lang w:val="fa-IR" w:bidi="fa-IR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/></w:pPr><w:rPr><w:color w:val="111A1C"/></w:rPr></w:style>${style(
    "Title",
    "Title",
    '<w:spacing w:after="80" w:line="276" w:lineRule="auto"/>',
    `<w:b/><w:bCs/>${size(40)}`,
  )}${style("Meta", "Subtitle", '<w:spacing w:after="360"/>', `<w:color w:val="5F686C"/>${size(19)}`)}${style(
    "Heading2",
    "heading 2",
    '<w:keepNext/><w:spacing w:before="240" w:after="80" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="1"/>',
    `<w:b/><w:bCs/>${size(30)}`,
  )}${style(
    "Heading3",
    "heading 3",
    '<w:keepNext/><w:spacing w:before="200" w:after="60" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="2"/>',
    `<w:b/><w:bCs/>${size(26)}`,
  )}${style(
    "Heading4",
    "heading 4",
    '<w:keepNext/><w:spacing w:before="160" w:after="60" w:line="276" w:lineRule="auto"/><w:outlineLvl w:val="3"/>',
    `<w:b/><w:bCs/>${size(23)}`,
  )}${style(
    "Label",
    "Message label",
    '<w:keepNext/><w:spacing w:before="280" w:after="60"/><w:pBdr><w:top w:val="single" w:sz="4" w:space="6" w:color="E3E8E9"/></w:pBdr>',
    size(20),
  )}</w:styles>`;
  const created = (options.created ?? new Date()).toISOString().replace(/\.\d+Z$/, "Z");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(options.title)}</dc:title><dc:language>fa-IR</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const text = (value: string) => new TextEncoder().encode(value);
  return writeZip([
    { name: "[Content_Types].xml", data: text(contentTypes) },
    { name: "_rels/.rels", data: text(rels) },
    { name: "docProps/core.xml", data: text(core) },
    { name: "word/document.xml", data: text(document) },
    { name: "word/_rels/document.xml.rels", data: text(documentRels) },
    { name: "word/styles.xml", data: text(styles) },
  ]);
}
