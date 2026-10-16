"use client";

import { FormEvent, useMemo, useState } from "react";
import { Bot, LoaderCircle, Send, Sparkles } from "lucide-react";
import { adviseLocally, type CopilotAnswer, type CopilotMessage } from "../lib/ops-copilot";
import { buildOpsSnapshot } from "../lib/ops-snapshot";
import type { SimulationState } from "../simulation/types";

const prompts = [
  "What is the bottleneck?",
  "Who is at deterioration risk?",
  "What should I do next?",
  "Summarize inbound ambulances",
];

export default function OpsCopilotPanel({
  state,
  onSelectEntity,
}: {
  state: SimulationState;
  onSelectEntity: (id: string) => void;
}) {
  const snapshot = useMemo(() => buildOpsSnapshot(state), [state]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>(() => [
    { role: "assistant", content: adviseLocally(buildOpsSnapshot(state), "brief the floor").reply },
  ]);
  const [answer, setAnswer] = useState<CopilotAnswer>(() => adviseLocally(buildOpsSnapshot(state), "brief the floor"));

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || pending) return;
    const history = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(history);
    setInput("");
    setPending(true);
    const fallback = adviseLocally(snapshot, trimmed);
    try {
      const response = await fetch("/api/ops-copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, snapshot, history: messages }),
      });
      const payload = response.ok ? ((await response.json()) as CopilotAnswer) : fallback;
      setAnswer(payload);
      setMessages([...history, { role: "assistant", content: payload.reply }]);
    } catch {
      setAnswer(fallback);
      setMessages([...history, { role: "assistant", content: fallback.reply }]);
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  return (
    <section className="panel ops-copilot">
      <div className="panel-head compact">
        <div>
          <span className="eyebrow">Advisory only · does not control the twin</span>
          <h2>Ops copilot</h2>
        </div>
        <span className={`copilot-source ${answer.source}`}>{answer.source === "model" ? "Model + snapshot" : "Grounded local agent"}</span>
      </div>
      <div className="copilot-layout">
        <div className="copilot-chat">
          <div className="copilot-thread" aria-live="polite">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`copilot-bubble ${message.role}`}>
                {message.role === "assistant" && <Bot size={14} />}
                <p>{message.content}</p>
              </div>
            ))}
            {pending && (
              <div className="copilot-bubble assistant pending">
                <LoaderCircle size={14} className="spin" />
                <p>Reading live state v{snapshot.stateVersion}…</p>
              </div>
            )}
          </div>
          <div className="copilot-prompts">
            {prompts.map((prompt) => (
              <button key={prompt} type="button" onClick={() => void ask(prompt)} disabled={pending}>
                <Sparkles size={11} />
                {prompt}
              </button>
            ))}
          </div>
          <form className="copilot-composer" onSubmit={onSubmit}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about bottlenecks, risk, or the next operator move"
              disabled={pending}
            />
            <button type="submit" disabled={pending || !input.trim()} aria-label="Send">
              <Send size={15} />
            </button>
          </form>
        </div>
        <aside className="copilot-recs">
          <p>Recommended moves</p>
          {answer.recommendations.length ? (
            answer.recommendations.map((item) => (
              <button
                key={item.title}
                type="button"
                className="copilot-rec"
                onClick={() => item.entityId && onSelectEntity(item.entityId)}
              >
                <b>{item.title}</b>
                <span>{item.why}</span>
              </button>
            ))
          ) : (
            <small>No open conflicts. Step or run the twin, then ask again.</small>
          )}
        </aside>
      </div>
    </section>
  );
}
