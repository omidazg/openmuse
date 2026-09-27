import { randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";
import { type BaseEvent, EventType, type Message, type RunAgentInput } from "@ag-ui/core";
import type { Observable } from "rxjs";
import { BRAND } from "../../../../packages/domain/src/brand.ts";
import { ConversationAgent } from "../engine/conversation.ts";
import type { AgentService } from "../engine/service.ts";
import type { BotPlatform } from "./api.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  at: string;
}
export interface AssistantRequest {
  owner: string;
  platform: BotPlatform;
  threadId: string;
  history: ChatTurn[];
  text: string;
}
export type AssistantReply = (request: AssistantRequest) => Promise<string>;

const platformNames: Record<BotPlatform, string> = { bale: "Bale (بله)", telegram: "Telegram" };

/** Channel rules added to the same system prompt the in-app chat uses. */
export function channelInstructions(platform: BotPlatform) {
  return [
    `The user is chatting with you through the ${platformNames[platform]} messenger bot, not inside the ${BRAND.name} app.`,
    "Reply in plain text: no Markdown tables, headings, bold markers or code fences. Use short paragraphs and simple lines starting with «•» for lists.",
    `Nothing can be shown in the app from here. Anything that needs the user's review or approval (sending email, calendar changes, filled PDFs, purchases) must be done in the ${BRAND.nameFa} app; say that clearly in Persian and point to «فعالیت».`,
    "For background work (کار پس‌زمینه) or long jobs, use delegate_task and tell the user they will get a message in this chat when it finishes.",
  ].join(" ");
}

/**
 * Run the owner's assistant (the same ConversationAgent used by /api/copilotkit, or the
 * configured AG-UI endpoint) on the stored chat history and collect the text it produces.
 */
export function assistantReply(service: AgentService, timeoutMs = 180_000): AssistantReply {
  return ({ owner, platform, threadId, history, text }) => {
    const config = service.config;
    const agent: { run(input: RunAgentInput): Observable<BaseEvent> } =
      config.agentBackend === "agui"
        ? new HttpAgent({
            url: config.agentUrl ?? "http://127.0.0.1:1/unconfigured",
            headers: config.agentToken ? { Authorization: `Bearer ${config.agentToken}` } : {},
          })
        : new ConversationAgent(config, service, owner);
    const messages: Message[] = [
      ...history.map(
        (turn) => ({ id: randomUUID(), role: turn.role, content: turn.content }) as Message,
      ),
      { id: randomUUID(), role: "user", content: text },
    ];
    const input: RunAgentInput = {
      threadId,
      runId: randomUUID(),
      state: {},
      messages,
      tools: [],
      context: [{ description: "Messenger channel", value: channelInstructions(platform) }],
      forwardedProps: {},
    };
    return new Promise<string>((resolve, reject) => {
      const parts: string[] = [];
      let current: string[] | undefined;
      const timer = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Assistant timed out"));
      }, timeoutMs);
      const done = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(parts.join("\n\n").trim());
      };
      const subscription = agent.run(input).subscribe({
        next: (event) => {
          if (event.type === EventType.TEXT_MESSAGE_START) {
            current = [];
            parts.push("");
          } else if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
            const delta = (event as BaseEvent & { delta?: string }).delta ?? "";
            if (!current) {
              current = [];
              parts.push("");
            }
            current.push(delta);
            parts[parts.length - 1] = current.join("");
          } else if (event.type === EventType.TEXT_MESSAGE_END) {
            current = undefined;
          } else if (event.type === EventType.RUN_ERROR) {
            subscription?.unsubscribe();
            done(new Error((event as BaseEvent & { message?: string }).message ?? "Run failed"));
          }
        },
        error: (error) => done(error instanceof Error ? error : new Error(String(error))),
        complete: () => done(),
      });
    });
  };
}
