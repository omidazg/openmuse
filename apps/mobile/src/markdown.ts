/**
 * A small Markdown parser for assistant answers. It covers what chat models actually write
 * (headings, lists, emphasis, links, tables, code, quotes, rules and LaTeX math) and stays
 * forgiving while an answer is still streaming: an unclosed fence or `$$` runs to the end.
 * Pure TypeScript with no React Native imports, so it is unit-tested under Node.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "strike"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "math"; tex: string }
  | { type: "link"; url: string; children: Inline[] }
  | { type: "break" };

export type ListItem = {
  depth: number;
  /** Visible marker number for ordered items; undefined for bullets. */
  number?: number;
  /** Task-list state for `- [ ]` / `- [x]` items. */
  checked?: boolean;
  text: string;
};

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "math"; tex: string }
  | { type: "list"; items: ListItem[] }
  | { type: "quote"; blocks: Block[] }
  | { type: "table"; header: string[]; center: boolean[]; rows: string[][] }
  | { type: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function startsDisplayMath(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("$$") || trimmed.startsWith("\\[");
}

function isTableStart(lines: string[], i: number) {
  const next = lines[i + 1];
  return lines[i].includes("|") && !!next?.includes("-") && TABLE_DELIMITER.test(next);
}

function startsBlock(lines: string[], i: number) {
  const line = lines[i];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST.test(line) ||
    startsDisplayMath(line) ||
    isTableStart(lines, i)
  );
}

/** Splits `| a | b |` into cells, honouring `\|` and pipes inside backticks. */
export function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === "\\" && row[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cell += c;
    } else if (c === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const close = lines[i].trim();
        if (close.startsWith(marker[0].repeat(marker.length)) && /^[`~]+$/.test(close)) {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lang: fence[2] || "", code: body.join("\n") });
      continue;
    }
    if (startsDisplayMath(line)) {
      flush();
      const trimmed = line.trim();
      const open = trimmed.startsWith("$$") ? "$$" : "\\[";
      const close = open === "$$" ? "$$" : "\\]";
      let rest = trimmed.slice(2);
      const body: string[] = [];
      let end = rest.indexOf(close);
      i++;
      while (end < 0 && i < lines.length) {
        body.push(rest);
        rest = lines[i];
        end = rest.indexOf(close);
        i++;
      }
      body.push(end < 0 ? rest : rest.slice(0, end));
      blocks.push({ type: "math", tex: body.join("\n").trim() });
      const after = end < 0 ? "" : rest.slice(end + 2).trim();
      if (after) paragraph.push(after);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] || "" });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (isTableStart(lines, i)) {
      flush();
      const header = splitRow(line);
      const center = splitRow(lines[i + 1]).map((cell) => /^:-+:$/.test(cell));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, column) => cells[column] ?? ""));
        i++;
      }
      blocks.push({ type: "table", header, center, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE, ""));
        i++;
      }
      blocks.push({ type: "quote", blocks: parseMarkdown(body.join("\n")) });
      continue;
    }
    if (LIST.test(line)) {
      flush();
      const items: ListItem[] = [];
      const indents: number[] = [];
      const counters: (number | undefined)[] = [];
      while (i < lines.length) {
        const item = LIST.exec(lines[i]);
        if (item) {
          const indent = item[1].replace(/\t/g, "    ").length;
          while (indents.length && indent < indents[indents.length - 1] - 1) indents.pop();
          if (!indents.length || indent > indents[indents.length - 1] + 1) indents.push(indent);
          else indents[indents.length - 1] = Math.min(indents[indents.length - 1], indent);
          const depth = indents.length - 1;
          counters.length = depth + 1;
          const ordered = /\d/.test(item[2]);
          let number: number | undefined;
          if (ordered) {
            const previous = counters[depth];
            number = previous === undefined ? Number.parseInt(item[2], 10) : previous + 1;
            counters[depth] = number;
          } else counters[depth] = undefined;
          let text = item[3];
          let checked: boolean | undefined;
          const task = /^\[([ xX])\]\s+/.exec(text);
          if (task) {
            checked = task[1] !== " ";
            text = text.slice(task[0].length);
          }
          items.push({ depth, number, checked, text });
          i++;
          continue;
        }
        const current = lines[i];
        // An indented line continues the previous item; a blank line may separate loose items.
        if (current.trim() && /^\s+/.test(current) && !startsBlock(lines, i)) {
          const last = items[items.length - 1];
          last.text += `\n${current.trim()}`;
          i++;
          continue;
        }
        if (!current.trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) {
          i++;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    if (paragraph.length && startsBlock(lines, i)) flush();
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return blocks;
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const BARE_URL = /^https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*/;

/** Finds the closing delimiter that is not escaped. */
function findClose(src: string, delimiter: string, from: number) {
  let at = src.indexOf(delimiter, from);
  while (at > 0 && src[at - 1] === "\\") at = src.indexOf(delimiter, at + 1);
  return at;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const push = (node: Inline) => {
    if (text) out.push({ type: "text", text });
    text = "";
    out.push(node);
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (c === "\\" && i + 1 < src.length) {
      const next = src[i + 1];
      if (next === "(") {
        const end = src.indexOf("\\)", i + 2);
        if (end > 0) {
          push({ type: "math", tex: src.slice(i + 2, end).trim() });
          i = end + 2;
          continue;
        }
      }
      if (/[\\`*_{}[\]()#+\-.!|~$<>]/.test(next)) {
        text += next;
        i += 2;
        continue;
      }
    }
    if (c === "\n") {
      push({ type: "break" });
      i++;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(rest)?.[0] || "`";
      const end = src.indexOf(run, i + run.length);
      if (end > 0) {
        push({ type: "code", text: src.slice(i + run.length, end).trim() });
        i = end + run.length;
        continue;
      }
    }
    if (c === "$" && src[i + 1] !== "$") {
      // `$x$`: content must not touch spaces, and prices like «$5 and $10» stay text.
      const end = findClose(src, "$", i + 1);
      const tex = end > 0 ? src.slice(i + 1, end) : "";
      if (tex && !/^\s|\s$/.test(tex) && !/\n/.test(tex) && !/^\d/.test(src[end + 1] || "")) {
        push({ type: "math", tex });
        i = end + 1;
        continue;
      }
    }
    if (c === "$" && src[i + 1] === "$") {
      const end = src.indexOf("$$", i + 2);
      if (end > 0) {
        push({ type: "math", tex: src.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const delimiter = rest.slice(0, 2);
      const end = findClose(src, delimiter, i + 2);
      if (end > i + 2 && src[i + 2] !== " ") {
        push({ type: "strong", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (rest.startsWith("~~")) {
      const end = findClose(src, "~~", i + 2);
      if (end > i + 2) {
        push({ type: "strike", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === "*" || c === "_") {
      const before = src[i - 1] || " ";
      const end = findClose(src, c, i + 1);
      const inWord = c === "_" && /[\p{L}\p{N}]/u.test(before);
      if (!inWord && end > i + 1 && src[i + 1] !== " " && src[end - 1] !== " ") {
        const after = src[end + 1] || " ";
        if (c === "*" || !/[\p{L}\p{N}]/u.test(after)) {
          push({ type: "em", children: parseInline(src.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    }
    if (c === "[") {
      const link = /^\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest);
      if (link) {
        const children = parseInline(link[1]);
        if (SAFE_URL.test(link[2])) push({ type: "link", url: link[2], children });
        else {
          // Unsafe schemes (javascript:, data:) keep their label but lose the link.
          if (text) out.push({ type: "text", text });
          text = "";
          out.push(...children);
        }
        i += link[0].length;
        continue;
      }
    }
    if (c === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/i.exec(rest);
      if (auto) {
        push({ type: "link", url: auto[1], children: [{ type: "text", text: auto[1] }] });
        i += auto[0].length;
        continue;
      }
    }
    if ((c === "h" || c === "H") && !/[\p{L}\p{N}]/u.test(src[i - 1] || " ")) {
      const bare = BARE_URL.exec(rest);
      if (bare) {
        const url = bare[0].replace(/[.,;:!?،؛؟»)]+$/, "");
        push({ type: "link", url, children: [{ type: "text", text: url }] });
        i += url.length;
        continue;
      }
    }
    text += c;
    i++;
  }
  if (text) out.push({ type: "text", text });
  return out;
}

/** Plain text of inline nodes, used for sizing table columns. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") return node.text;
      if (node.type === "math") return latexToText(node.tex);
      if (node.type === "break") return "\n";
      return inlineText(node.children);
    })
    .join("");
}

const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  times: "×",
  cdot: "·",
  div: "÷",
  pm: "±",
  mp: "∓",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  propto: "∝",
  infty: "∞",
  sum: "∑",
  prod: "∏",
  int: "∫",
  iint: "∬",
  oint: "∮",
  partial: "∂",
  nabla: "∇",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  leftrightarrow: "↔",
  Leftrightarrow: "⇔",
  implies: "⇒",
  iff: "⇔",
  mapsto: "↦",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  lnot: "¬",
  land: "∧",
  wedge: "∧",
  lor: "∨",
  vee: "∨",
  oplus: "⊕",
  otimes: "⊗",
  angle: "∠",
  perp: "⊥",
  parallel: "∥",
  degree: "°",
  circ: "∘",
  ldots: "…",
  dots: "…",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  prime: "′",
  hbar: "ℏ",
  ell: "ℓ",
  langle: "⟨",
  rangle: "⟩",
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  lim: "lim",
  log: "log",
  ln: "ln",
  exp: "exp",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  cot: "cot",
  sec: "sec",
  csc: "csc",
  max: "max",
  min: "min",
  det: "det",
  mod: "mod",
  quad: "  ",
  qquad: "    ",
};
const BLACKBOARD: Record<string, string> = {
  R: "ℝ",
  N: "ℕ",
  Z: "ℤ",
  Q: "ℚ",
  C: "ℂ",
  P: "ℙ",
};
const TEXT_COMMANDS = new Set([
  "text",
  "textrm",
  "textbf",
  "textit",
  "mathrm",
  "mathbf",
  "mathit",
  "mathsf",
  "mathtt",
  "mathcal",
  "operatorname",
  "boldsymbol",
  "bm",
  "displaystyle",
  "vec",
  "hat",
  "bar",
  "overline",
  "underline",
  "tilde",
  "dot",
]);
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
  i: "ⁱ",
  x: "ˣ",
  y: "ʸ",
  a: "ᵃ",
  b: "ᵇ",
  c: "ᶜ",
  d: "ᵈ",
  e: "ᵉ",
  k: "ᵏ",
  m: "ᵐ",
  t: "ᵗ",
  T: "ᵀ",
  "′": "′",
  "∘": "°",
  "*": "*",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "−": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
  a: "ₐ",
  e: "ₑ",
  o: "ₒ",
  x: "ₓ",
  i: "ᵢ",
  j: "ⱼ",
  k: "ₖ",
  m: "ₘ",
  n: "ₙ",
  t: "ₜ",
};

/** Reads one argument: `{group}`, `\command` or a single character. */
function readArgument(src: string, at: number): [string, number] {
  let i = at;
  while (src[i] === " ") i++;
  if (src[i] === "{") {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === "\\") j++;
      else if (src[j] === "{") depth++;
      else if (src[j] === "}" && --depth === 0) return [src.slice(i + 1, j), j + 1];
    }
    return [src.slice(i + 1), src.length];
  }
  if (src[i] === "\\") {
    const name = /^\\([A-Za-z]+|.)/.exec(src.slice(i))?.[0] || "\\";
    return [name, i + name.length];
  }
  return [src[i] || "", i + 1];
}

/** Wraps compound expressions in parentheses so `a+b` over `c` reads «(a+b)/c». */
function group(text: string) {
  return /^[\p{L}\p{N}.′]+$/u.test(text) || /^\(.*\)$/.test(text) ? text : `(${text})`;
}

function script(text: string, map: Record<string, string>, marker: string) {
  const chars = [...text];
  if (chars.every((ch) => map[ch])) return chars.map((ch) => map[ch]).join("");
  return [...text].length > 1 && !/^\(.*\)$/.test(text) ? `${marker}(${text})` : marker + text;
}

/**
 * Turns LaTeX into readable Unicode math («\frac{a}{b}» → «a/b», «x^2» → «x²», «\alpha» → «α»).
 * Not typesetting, but readable on web and native without a math engine.
 */
export function latexToText(tex: string): string {
  let out = "";
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c === "\\") {
      const name = /^\\([A-Za-z]+|.)/.exec(tex.slice(i))?.[1] || "";
      i += name.length + 1;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const [top, afterTop] = readArgument(tex, i);
        const [bottom, afterBottom] = readArgument(tex, afterTop);
        out += `${group(latexToText(top))}/${group(latexToText(bottom))}`;
        i = afterBottom;
      } else if (name === "sqrt") {
        let index = "";
        if (tex[i] === "[") {
          const close = tex.indexOf("]", i);
          index = tex.slice(i + 1, close < 0 ? tex.length : close);
          i = close < 0 ? tex.length : close + 1;
        }
        const [body, next] = readArgument(tex, i);
        out += `${index ? script(latexToText(index), SUPERSCRIPT, "") : ""}√${group(latexToText(body))}`;
        i = next;
      } else if (name === "mathbb") {
        const [body, next] = readArgument(tex, i);
        out += BLACKBOARD[body] || latexToText(body);
        i = next;
      } else if (TEXT_COMMANDS.has(name)) {
        if (name === "displaystyle") continue;
        const [body, next] = readArgument(tex, i);
        out += name.startsWith("text") ? body : latexToText(body);
        i = next;
      } else if (name === "begin" || name === "end") {
        i = readArgument(tex, i)[1];
        if (tex[i] === "{") i = readArgument(tex, i)[1];
      } else if (name === "left" || name === "right" || name === "big" || name === "Big") {
        if (tex[i] === ".") i++;
      } else if (name === "\\") out += "\n";
      else if (name === "," || name === ";" || name === ":" || name === " ") out += " ";
      else if (name === "!") {
        // Negative thin space.
      } else if (name === "{" || name === "}" || name === "%" || name === "$" || name === "#")
        out += name;
      else if (name === "&" || name === "_") out += name;
      else out += SYMBOLS[name] ?? name;
    } else if (c === "^" || c === "_") {
      const [body, next] = readArgument(tex, i + 1);
      const text = latexToText(body);
      out += c === "^" ? script(text, SUPERSCRIPT, "^") : script(text, SUBSCRIPT, "_");
      i = next;
    } else if (c === "{") {
      const [body, next] = readArgument(tex, i);
      out += latexToText(body);
      i = next;
    } else if (c === "}" || c === "&") i++;
    else if (c === "~") {
      out += " ";
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/[ \t]{2,}/g, (spaces) => (spaces.length > 3 ? "    " : " ")).trim();
}
