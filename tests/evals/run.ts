/**
 * Live Persian quality eval: `pnpm eval`. Sends every case in persian.json to a running server
 * (EVAL_BASE_URL, EVAL_ACCESS_KEY) on a fresh thread and checks the answer. Not part of
 * `pnpm test`, because it calls the real model.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type EvalCase, runChecks } from "./checks.ts";

const baseUrl = process.env.EVAL_BASE_URL?.replace(/\/+$/, "");
const accessKey = process.env.EVAL_ACCESS_KEY;
const only = process.env.EVAL_ONLY?.split(",").map((id) => id.trim());

async function login() {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accessKey }),
  });
  if (!response.ok) throw new Error(`login failed: HTTP ${response.status}`);
  const { token } = (await response.json()) as { token: string };
  return token;
}

async function ask(token: string, prompt: string) {
  const response = await fetch(`${baseUrl}/api/copilotkit/agent/default/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      threadId: randomUUID(),
      runId: randomUUID(),
      messages: [{ id: randomUUID(), role: "user", content: prompt }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  });
  if (!response.ok || !response.body) throw new Error(`run failed: HTTP ${response.status}`);
  let answer = "";
  let model = "";
  let error = "";
  let buffer = "";
  const decoder = new TextDecoder();
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const event = JSON.parse(line.slice(5)) as Record<string, unknown>;
    if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CHUNK")
      answer += typeof event.delta === "string" ? event.delta : "";
    if (event.type === "CUSTOM" && event.name === "dastyar.model")
      model = String((event.value as { model?: string })?.model ?? "");
    if (event.type === "RUN_ERROR") error = String(event.message ?? "run error");
  };
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line.trim());
  }
  consume(buffer.trim());
  if (error && !answer) throw new Error(error);
  return { answer, model };
}

async function main() {
  if (!baseUrl || !accessKey) {
    console.error(
      "Set EVAL_BASE_URL and EVAL_ACCESS_KEY to run the Persian eval against a live server.",
    );
    process.exit(2);
  }
  const cases = JSON.parse(
    await readFile(new URL("./persian.json", import.meta.url), "utf8"),
  ) as EvalCase[];
  const selected = only ? cases.filter((item) => only.includes(item.id)) : cases;
  const token = await login();
  let failed = 0;
  for (const item of selected) {
    const started = Date.now();
    try {
      const { answer, model } = await ask(token, item.prompt);
      const failures = runChecks(answer, item.checks);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (failures.length) {
        failed += 1;
        console.log(`FAIL ${item.id} (${item.category}, ${model || "?"}, ${seconds}s)`);
        for (const failure of failures) console.log(`  - ${failure}`);
        console.log(`  answer: ${answer.slice(0, 300).replace(/\s+/g, " ")}`);
      } else console.log(`PASS ${item.id} (${model || "?"}, ${seconds}s)`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n${selected.length - failed}/${selected.length} passed`);
  process.exit(failed ? 1 : 0);
}

await main();
