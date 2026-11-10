import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { askTern, stepHint, stepLabel } from "../utils/ternStream";
import type { TernEvent } from "../utils/ternStream";

// What a race engineer asks mid-run. Short, data-only (Tern answers RED in 1-3 sentences).
const SUGGESTIONS = [
  "Lap times this run?",
  "How many laps so far?",
  "Energy used this run?",
  "Efficiency on the last lap?",
  "Compare the last two laps",
  "Which turn is slowest?",
];

type Step = { tool: string; hint: string; state: "running" | "ok" | "error"; summary?: string };

type Exchange = {
  id: number;
  question: string;
  steps: Step[];
  status: "queued" | "thinking" | "done" | "error";
  queuePosition?: number;
  answer?: string;
  startedAt: number;
  endedAt?: number;
};

export default function SideBar({ open }: { open: boolean }) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const pending = exchanges.some((e) => e.status === "queued" || e.status === "thinking");
  const threadRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  // the elapsed-seconds counter next to "Thinking"
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [pending]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [exchanges]);

  const update = (id: number, fn: (e: Exchange) => Exchange) =>
    setExchanges((prev) => prev.map((e) => (e.id === id ? fn(e) : e)));

  const apply = (id: number, event: TernEvent) =>
    update(id, (e) => {
      switch (event.type) {
        case "queued":
          return { ...e, status: "queued", queuePosition: event.position };
        case "started":
        case "thinking":
          return { ...e, status: "thinking" };
        case "tool":
          return {
            ...e,
            status: "thinking",
            steps: [...e.steps, { tool: event.name, hint: stepHint(event.args), state: "running" }],
          };
        case "tool_done": {
          const steps = [...e.steps];
          const i = steps.map((s) => s.tool).lastIndexOf(event.name);
          if (i !== -1) steps[i] = { ...steps[i], state: event.ok ? "ok" : "error", summary: event.summary };
          return { ...e, steps };
        }
        case "answer":
          return { ...e, status: "done", answer: event.text, endedAt: Date.now() };
        case "error":
          return { ...e, status: "error", answer: event.detail, endedAt: Date.now() };
        default:
          return e;
      }
    });

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    const id = nextId.current++;
    setDraft("");
    setExchanges((prev) => [
      ...prev,
      { id, question, steps: [], status: "thinking", startedAt: Date.now() },
    ]);
    let finished = false;
    await askTern(question, (event) => {
      if (event.type === "answer" || event.type === "error") finished = true;
      apply(id, event);
    });
    if (!finished) {
      apply(id, { type: "error", detail: "Tern stopped without an answer" });
    }
  };

  return (
    <div
      className={`min-w-72 w-[22%] h-full m-0 bg-[#232526] text-gray-200 px-5 pb-5 pt-12 fixed top-0 ${open ? "right-0" : "right-[min(-22%,calc(var(--spacing)*(-80)))]"} z-99 transition-all duration-300 ease-in-out shadow-[-10px_0px_15px_-3px_rgba(0,0,0,0.1)] flex flex-col gap-3`}
    >
      <div className="mt-[4vh] flex items-center justify-between">
        <div>
          <h2
            className="text-lg font-semibold uppercase tracking-[0.26em] text-white/78"
            data-testid="tern-panel"
          >
            Tern Copilot
          </h2>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/40">
            answers from EVIL's data
          </p>
        </div>
        {exchanges.length > 0 && !pending ? (
          <button
            type="button"
            onClick={() => setExchanges([])}
            className="rounded-full! border! border-white/15! bg-transparent! px-2.5! py-1! text-[10px]! font-semibold uppercase tracking-[0.18em] text-white/55 transition hover:border-white/40! hover:text-white/85 active:bg-white/10! focus:outline-0"
            data-testid="tern-clear"
          >
            Clear
          </button>
        ) : null}
      </div>

      <SideBarTile className="min-h-0 flex-1">
        {exchanges.length === 0 ? (
          <div className="flex h-full flex-col justify-center gap-4 px-1" data-testid="tern-empty">
            <p className="text-center text-sm text-white/55">
              Ask about the run being recorded, or any past run.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <SuggestionChip key={s} text={s} onPick={ask} />
              ))}
            </div>
          </div>
        ) : (
          <div
            ref={threadRef}
            data-testid="tern-answers"
            className="flex h-full flex-col gap-4 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
          >
            {exchanges.map((e) => (
              <ExchangeView key={e.id} exchange={e} now={now} />
            ))}
          </div>
        )}
      </SideBarTile>

      {exchanges.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <SuggestionChip key={s} text={s} onPick={ask} disabled={pending} compact />
          ))}
        </div>
      ) : null}

      <form
        className="flex items-end gap-2 rounded-[1.25rem] border border-white/10 bg-black/20 p-2 focus-within:border-white/30"
        onSubmit={(ev) => {
          ev.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          value={draft}
          onChange={(ev) => setDraft(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              void ask(draft);
            }
          }}
          rows={1}
          placeholder={pending ? "Tern is answering..." : "Ask Tern..."}
          className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-100 placeholder:text-white/35 focus:outline-0"
          data-testid="tern-input"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full! border-0! p-0! bg-[var(--primary-accent)]! text-white transition enabled:hover:brightness-110 disabled:cursor-default disabled:bg-white/10! disabled:text-white/30 focus:outline-0"
          data-testid="tern-ask"
        >
          {pending ? <Spinner /> : <span className="text-base leading-none">&#8593;</span>}
        </button>
      </form>
    </div>
  );
}

function ExchangeView({ exchange: e, now }: { exchange: Exchange; now: number }) {
  const [showSteps, setShowSteps] = useState(false);
  const working = e.status === "thinking" || e.status === "queued";
  const seconds = (((e.endedAt ?? now) - e.startedAt) / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-2" data-testid="tern-exchange">
      <div className="ml-6 self-end rounded-2xl rounded-br-md bg-white/8 px-3 py-2 text-sm text-slate-100">
        {e.question}
      </div>

      <div className="flex flex-col gap-1.5">
        {working ? (
          <>
            {e.steps.map((s, i) => (
              <StepRow key={i} step={s} />
            ))}
            <div className="flex items-center gap-2 text-xs text-white/60" data-testid="tern-thinking">
              <Spinner />
              <span className="tracking-wide">
                {e.status === "queued"
                  ? `Waiting for Tern${e.queuePosition ? ` (${e.queuePosition} ahead)` : ""}`
                  : "Thinking"}
              </span>
              <span className="tabular-nums text-white/35">{seconds}s</span>
            </div>
          </>
        ) : (
          <>
            {e.steps.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowSteps((v) => !v)}
                className="flex items-center gap-1.5 self-start rounded-none! border-0! bg-transparent! p-0! text-[11px]! text-white/40 transition hover:text-white/70 active:bg-transparent! focus:outline-0"
                data-testid="tern-steps-toggle"
              >
                <span className={`inline-block transition-transform ${showSteps ? "rotate-90" : ""}`}>&#9656;</span>
                {e.steps.length} {e.steps.length === 1 ? "step" : "steps"} · {seconds}s
              </button>
            ) : (
              <span className="text-[11px] text-white/35">{seconds}s</span>
            )}
            {showSteps ? e.steps.map((s, i) => <StepRow key={i} step={s} />) : null}
            <div
              data-testid="tern-answer"
              className={`whitespace-pre-wrap rounded-2xl rounded-bl-md border border-white/8 bg-black/18 px-3 py-2.5 text-sm ${e.status === "error" ? "text-[#c41e3a]" : "text-slate-100"}`}
            >
              {e.answer}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 text-xs text-white/50" data-testid="tern-step">
      <span className="flex w-3 justify-center">
        {step.state === "running" ? (
          <Spinner />
        ) : step.state === "ok" ? (
          <span className="text-emerald-400/80">&#10003;</span>
        ) : (
          <span className="text-[#c41e3a]">&#10005;</span>
        )}
      </span>
      <span className="shrink-0 whitespace-nowrap text-white/70">{stepLabel(step.tool)}</span>
      {step.hint ? <span className="min-w-0 truncate text-white/35">{step.hint}</span> : null}
      {step.summary ? <span className="ml-auto shrink-0 text-white/30">{step.summary}</span> : null}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-white/80" />
  );
}

function SuggestionChip({
  text,
  onPick,
  disabled,
  compact,
}: {
  text: string;
  onPick: (text: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(text)}
      className={`shrink-0 rounded-full! border! border-white/12! bg-white/4! font-normal! text-white/70 transition enabled:hover:border-white/35! enabled:hover:text-white active:bg-white/10! disabled:cursor-default disabled:opacity-40 focus:outline-0 ${compact ? "px-2.5! py-1! text-[11px]!" : "px-3! py-1.5! text-xs!"}`}
      data-testid="tern-suggestion"
    >
      {text}
    </button>
  );
}

function SideBarTile({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex w-full flex-col overflow-hidden rounded-[1.25rem] border border-white/8 bg-[linear-gradient(180deg,#242424,#252525)] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.24)] ${className}`}
    >
      {children}
    </section>
  );
}
