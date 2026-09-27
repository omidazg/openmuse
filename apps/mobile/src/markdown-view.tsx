import { Check, Copy } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, type TextStyle, View } from "react-native";
import { copyText } from "./clipboard";
import { FONT, faDigits, fw } from "./locale";
import {
  type Block,
  type Inline,
  inlineText,
  latexToText,
  parseInline,
  parseMarkdown,
} from "./markdown";
import { colors, s } from "./ui";

const mono = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});
const mathFont = Platform.select({
  ios: "Times New Roman",
  android: "serif",
  default: "'Cambria Math', 'STIX Two Math', 'Latin Modern Math', 'Times New Roman', serif",
});
/** Code, formulas and URLs read left-to-right inside the RTL app. */
const ltr = { writingDirection: "ltr", textAlign: "auto" } as const;
/** Unicode isolates keep inline code and math LTR without breaking the Persian line around them. */
const isolate = (text: string) => `\u2066${text}\u2069`;

const body: TextStyle = {
  fontFamily: FONT,
  color: colors.text,
  fontSize: 16,
  lineHeight: 28,
  // Mixed Persian/English: follow each paragraph's own direction.
  textAlign: "auto",
  writingDirection: "auto",
};
const headingSize = [22, 19, 17, 16, 16, 16];

/** A small «کپی» button that confirms with «کپی شد» for a moment. */
export function CopyButton({ text, label = "کپی" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const Icon = state === "copied" ? Check : Copy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      hitSlop={6}
      onPress={() => {
        clearTimeout(timer.current);
        void copyText(text)
          .then((copied) => setState(copied ? "copied" : "idle"))
          .catch(() => setState("failed"))
          .finally(() => {
            timer.current = setTimeout(() => setState("idle"), 1800);
          });
      }}
      style={({ pressed }) => [
        s.row,
        {
          gap: 5,
          paddingHorizontal: 9,
          paddingVertical: 4,
          borderRadius: 14,
          backgroundColor: pressed ? colors.line : "transparent",
        },
      ]}
    >
      <Icon size={14} color={state === "failed" ? colors.danger : colors.muted} />
      <Text style={[s.small, { color: state === "failed" ? colors.danger : colors.muted }]}>
        {state === "copied" ? "کپی شد" : state === "failed" ? "کپی نشد" : "کپی"}
      </Text>
    </Pressable>
  );
}

function openLink(url: string) {
  void Linking.openURL(url).catch(() => {});
}

function renderInline(nodes: Inline[], keyPrefix = ""): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.type) {
      case "text":
        return node.text;
      case "break":
        return "\n";
      case "strong":
        return (
          <Text key={key} style={fw("700")}>
            {renderInline(node.children, `${key}.`)}
          </Text>
        );
      // Vazirmatn has no italic face and synthetic italics are off-limits: emphasis is weight.
      case "em":
        return (
          <Text key={key} style={fw("600")}>
            {renderInline(node.children, `${key}.`)}
          </Text>
        );
      case "strike":
        return (
          <Text key={key} style={{ textDecorationLine: "line-through" }}>
            {renderInline(node.children, `${key}.`)}
          </Text>
        );
      case "code":
        return (
          <Text
            key={key}
            style={{
              fontFamily: mono,
              fontSize: 14,
              backgroundColor: colors.line,
              borderRadius: 5,
            }}
          >
            {isolate(` ${node.text} `)}
          </Text>
        );
      case "math":
        return (
          <Text key={key} style={{ fontFamily: mathFont, fontSize: 17 }}>
            {isolate(latexToText(node.tex))}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            accessibilityRole="link"
            onPress={() => openLink(node.url)}
            style={{ color: colors.blueDark, textDecorationLine: "underline" }}
          >
            {renderInline(node.children, `${key}.`)}
          </Text>
        );
    }
    return null;
  });
}

function Rich({ text, style }: { text: string; style?: TextStyle }) {
  return (
    <Text selectable style={[body, style]}>
      {renderInline(parseInline(text))}
    </Text>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.card,
        overflow: "hidden",
      }}
    >
      <View
        style={[
          s.between,
          { paddingStart: 12, paddingEnd: 4, paddingVertical: 3, backgroundColor: colors.line },
        ]}
      >
        <Text style={[s.small, ltr, { fontFamily: mono }]}>{lang || "کد"}</Text>
        <CopyButton text={code} label="کپی کد" />
      </View>
      {/* direction: "ltr" so code starts at the left edge and scrolls from there. */}
      <ScrollView horizontal style={{ direction: "ltr" }} contentContainerStyle={{ padding: 12 }}>
        <Text
          selectable
          style={[ltr, { fontFamily: mono, fontSize: 13.5, lineHeight: 21, color: colors.text }]}
        >
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

function MathBlock({ tex }: { tex: string }) {
  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
      <Text
        selectable
        accessibilityLabel={tex}
        style={[
          ltr,
          {
            fontFamily: mathFont,
            fontSize: 19,
            lineHeight: 30,
            color: colors.text,
            textAlign: "center",
            paddingVertical: 4,
          },
        ]}
      >
        {latexToText(tex)}
      </Text>
    </ScrollView>
  );
}

function Table({ block }: { block: Extract<Block, { type: "table" }> }) {
  // Columns share one width per column; long cells wrap inside a readable maximum.
  const widths = block.header.map((cell, column) => {
    const longest = Math.max(
      ...[cell, ...block.rows.map((row) => row[column])].map(
        (value) => inlineText(parseInline(value)).length,
      ),
    );
    return Math.max(72, Math.min(240, longest * 8 + 26));
  });
  const row = (cells: string[], header: boolean, key: string) => (
    <View
      key={key}
      style={{
        flexDirection: "row",
        borderTopWidth: header ? 0 : 1,
        borderColor: colors.line,
        backgroundColor: header ? colors.line : "transparent",
      }}
    >
      {cells.map((cell, column) => {
        // Parsed content never reorders, so position is a stable key.
        const cellKey = `${key}-${column}`;
        return (
          <View
            key={cellKey}
            style={{ width: widths[column], paddingHorizontal: 10, paddingVertical: 7 }}
          >
            <Rich
              text={cell}
              style={{
                fontSize: 14,
                lineHeight: 24,
                ...(header ? fw("600") : null),
                ...(block.center[column] ? { textAlign: "center" } : null),
              }}
            />
          </View>
        );
      })}
    </View>
  );
  return (
    // flexGrow lets a narrow table sit at the start (right) edge instead of the physical left.
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
      <View
        style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: "hidden" }}
      >
        {row(block.header, true, "header")}
        {block.rows.map((cells, index) => row(cells, false, `row-${index}`))}
      </View>
    </ScrollView>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case "heading":
            return (
              <Rich
                key={key}
                text={block.text}
                style={{
                  fontSize: headingSize[block.level - 1],
                  lineHeight: Math.round(headingSize[block.level - 1] * 1.5),
                  ...fw(block.level <= 2 ? "700" : "600"),
                  marginTop: 4,
                }}
              />
            );
          case "paragraph":
            return <Rich key={key} text={block.text} />;
          case "code":
            return <CodeBlock key={key} lang={block.lang} code={block.code} />;
          case "math":
            return <MathBlock key={key} tex={block.tex} />;
          case "table":
            return <Table key={key} block={block} />;
          case "rule":
            return <View key={key} style={{ height: 1, backgroundColor: colors.line }} />;
          case "quote":
            return (
              <View
                key={key}
                style={{
                  borderStartWidth: 3,
                  borderColor: colors.faint,
                  paddingStart: 12,
                  gap: 8,
                }}
              >
                <Blocks blocks={block.blocks} />
              </View>
            );
          case "list":
            return (
              <View key={key} style={{ gap: 4 }}>
                {block.items.map((item, itemIndex) => {
                  const itemKey = `${key}-${itemIndex}`;
                  return (
                    <View
                      key={itemKey}
                      style={{ flexDirection: "row", gap: 6, marginStart: item.depth * 18 }}
                    >
                      <Text style={[body, { minWidth: 18, color: colors.muted }]}>
                        {item.checked !== undefined
                          ? item.checked
                            ? "☑"
                            : "☐"
                          : item.number !== undefined
                            ? `${faDigits(item.number)}.`
                            : item.depth
                              ? "◦"
                              : "•"}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Rich text={item.text} />
                      </View>
                    </View>
                  );
                })}
              </View>
            );
        }
        return null;
      })}
    </>
  );
}

/** Assistant answer rendered from Markdown. */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View style={{ gap: 10 }}>
      <Blocks blocks={blocks} />
    </View>
  );
}
