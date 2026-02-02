import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
    CHAT_API_URL,
    ChatButton,
    ChatTable,
    Msg,
    ChatTableCards,
    ChatActionButtons
} from "@/components/ChatbotCommon";

const createId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export default function PatientChatbotWidget() {
    const { patientUser } = useAuth();
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<Msg[]>([
        { role: "bot", text: "안녕하세요! 건양대학교병원 챗봇입니다. 무엇을 도와드릴까요?" },
    ]);

    const listRef = useRef<HTMLDivElement | null>(null);
    const sessionIdRef = useRef<string>(createId());

    useEffect(() => {
        if (!open) return;
        requestAnimationFrame(() => {
            listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
        });
    }, [open, messages.length]);

    const buildMetadata = () => {
        const metadata: Record<string, unknown> = {};
        if (patientUser) {
            metadata.patient_id = patientUser.patient_id;
            metadata.patient_identifier = patientUser.patient_id;
            metadata.account_id = patientUser.account_id;
            metadata.patient_name = patientUser.name;
            if (patientUser.patient_pk != null) {
                metadata.patient_pk = patientUser.patient_pk;
            }
        }
        return metadata;
    };

    const sendMessage = async (text: string) => {
        if (!text || loading) return;

        setMessages((prev) => [...prev, { role: "user", text }]);
        setLoading(true);

        try {
            const res = await fetch(CHAT_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    session_id: sessionIdRef.current,
                    request_id: createId(),
                    metadata: buildMetadata(),
                }),
            });

            const data = await res.json();

            if (!res.ok) throw new Error("HTTP error");

            let table: ChatTable | undefined;
            if (data?.table && typeof data.table === "object") {
                table = data.table as ChatTable;
                if (data?.reschedule_mode === true && !table.reschedule_mode) {
                    table = { ...table, reschedule_mode: true };
                }
            }
            const buttons = Array.isArray(data?.buttons) ? (data.buttons as ChatButton[]) : undefined;

            const botText =
                typeof data?.reply === "string"
                    ? data.reply
                    : typeof data?.message === "string"
                        ? data.message
                        : "응답을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.";

            setMessages((prev) => [
                ...prev,
                { role: "bot", text: botText, table, buttons, requestId: data?.request_id },
            ]);
        } catch {
            setMessages((prev) => [
                ...prev,
                { role: "bot", text: "오류가 발생했어요. 잠시 후 다시 시도해주세요." },
            ]);
        } finally {
            setLoading(false);
        }
    };

    const send = async () => {
        const text = input.trim();
        if (!text) return;
        setInput("");
        await sendMessage(text);
    };

    const fetchAvailableTimeSlots = async (params: { date: string; doctorId?: string; doctorCode?: string }) => {
        try {
            const res = await fetch(`${CHAT_API_URL}available-time-slots/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: params.date,
                    session_id: sessionIdRef.current,
                    doctor_id: params.doctorId,
                    doctor_code: params.doctorCode,
                    metadata: buildMetadata(),
                }),
            });
            const data = await res.json();
            return data as { status?: string; booked_times?: string[] };
        } catch {
            return { status: "error", booked_times: [] };
        }
    };


    return (
        <>
            {!open && (
                <div
                    onClick={() => setOpen(true)}
                    className="absolute bottom-10 right-10 hidden lg:block cursor-pointer animate-in slide-in-from-bottom-10 duration-1000 delay-300 fade-in"
                >
                    <div className="glass-panel p-6 rounded-2xl max-w-xs backdrop-blur-md bg-white/90 dark:bg-black/60 shadow-xl border border-white/20">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                                🤖
                            </div>
                            <div>
                                <p className="text-sm text-muted-foreground font-medium">AI 챗봇</p>
                                <p className="text-lg font-bold text-foreground">상담 시작하기</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {open && (
                <div className="fixed bottom-10 right-10 z-[9999] w-[360px] h-[520px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
                        <div>
                            <div className="font-bold text-sm">건양대병원 AI 챗봇</div>
                            <div className="text-xs text-slate-500">안내 · 예약 · 준비물 · 증상</div>
                        </div>
                        <button
                            className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                            onClick={() => setOpen(false)}
                            aria-label="닫기"
                        >
                            ✕
                        </button>
                    </div>

                    <div ref={listRef} className="flex-1 p-3 overflow-y-auto space-y-2 text-sm">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                <div className="flex flex-col gap-2 max-w-[85%]">
                                    <div
                                        className={`px-3 py-2 rounded-2xl whitespace-pre-wrap ${m.role === "user"
                                            ? "bg-blue-100 dark:bg-blue-900/40"
                                            : "bg-slate-100 dark:bg-slate-800"
                                            }`}
                                    >
                                        {m.text}
                                    </div>
                                    {m.role !== "user" && m.table && (
                                        <ChatTableCards
                                            table={m.table}
                                            onSendMessage={sendMessage}
                                            fetchAvailableTimeSlots={fetchAvailableTimeSlots}
                                        />
                                    )}
                                    {m.role !== "user" && m.buttons && m.buttons.length > 0 && (
                                        <ChatActionButtons buttons={m.buttons} onSendMessage={sendMessage} />
                                    )}
                                </div>
                            </div>
                        ))}
                        {loading && (
                            <div className="flex justify-start">
                                <div className="max-w-[85%] px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800">
                                    답변 생성 중…
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                        <input
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && send()}
                            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-sm outline-none"
                            placeholder="메시지를 입력하세요"
                            disabled={loading}
                        />
                        <button
                            onClick={send}
                            disabled={loading}
                            className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-bold disabled:opacity-60"
                        >
                            전송
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
