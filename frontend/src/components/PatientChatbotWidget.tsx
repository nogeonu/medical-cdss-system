import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";

const API_URL = "/api/chatbot/"; // ✅ nginx가 8001의 /api/chat/ 로 프록시

const createId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

type ChatButton = { text?: string; action?: string };
type ChatTable = {
    headers?: string[];
    rows?: Array<Array<string>>;
    reschedule_mode?: boolean;
    doctor_metadata?: Array<{ doctor_code?: string; doctor_id?: string }>;
};
type Msg = { role: "user" | "bot"; text: string; table?: ChatTable; buttons?: ChatButton[]; requestId?: string };

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
            const res = await fetch(API_URL, {
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
            const res = await fetch(`${API_URL}available-time-slots/`, {
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

const formatYmd = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

const formatKoreanDate = (ymd: string) => {
    const parsed = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return ymd;
    return new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        weekday: "short",
    }).format(parsed);
};

const generateTimeSlots = () => {
    const slots: string[] = [];
    for (let hour = 9; hour <= 18; hour += 1) {
        slots.push(`${String(hour).padStart(2, "0")}:00`);
        if (hour < 18) {
            slots.push(`${String(hour).padStart(2, "0")}:30`);
        }
    }
    return slots;
};

type FetchAvailableTimeSlots = (params: {
    date: string;
    doctorId?: string;
    doctorCode?: string;
}) => Promise<{ status?: string; booked_times?: string[] }>;

function ChatTableCards({
    table,
    onSendMessage,
    fetchAvailableTimeSlots,
}: {
    table: ChatTable;
    onSendMessage: (text: string) => void;
    fetchAvailableTimeSlots: FetchAvailableTimeSlots;
}) {
    const headers = table.headers ?? [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const isDoctorList =
        (headers.length > 0 &&
            typeof headers[0] === "string" &&
            (headers[0].includes("의사") || headers[0].includes("의료진"))) ||
        (Array.isArray(table.doctor_metadata) && table.doctor_metadata.length > 0);

    return (
        <div className="space-y-2">
            {rows.map((row, idx) => {
                const rowData = Array.isArray(row) ? row : [];
                if (isDoctorList) {
                    const name = String(rowData[0] ?? "");
                    const title = String(rowData[1] ?? "");
                    const meta = table.doctor_metadata?.[idx] ?? {};
                    const parsedCode =
                        name.includes("(") && name.includes(")")
                            ? name.slice(name.indexOf("(") + 1, name.indexOf(")"))
                            : undefined;
                    return (
                        <DoctorCard
                            key={`${name}-${idx}`}
                            doctorName={name}
                            title={title}
                            doctorCode={meta.doctor_code ?? parsedCode}
                            doctorId={meta.doctor_id}
                            onSendMessage={onSendMessage}
                            fetchAvailableTimeSlots={fetchAvailableTimeSlots}
                        />
                    );
                }

                if (rowData.length < 4) return null;
                const date = String(rowData[0] ?? "");
                const time = String(rowData[1] ?? "");
                const department = String(rowData[2] ?? "");
                const doctor = String(rowData[3] ?? "");

                return (
                    <ReservationCard
                        key={`${date}-${time}-${idx}`}
                        date={date}
                        time={time}
                        department={department}
                        doctor={doctor}
                        rescheduleMode={table.reschedule_mode === true}
                        onSendMessage={onSendMessage}
                        fetchAvailableTimeSlots={fetchAvailableTimeSlots}
                    />
                );
            })}
        </div>
    );
}

function ChatActionButtons({
    buttons,
    onSendMessage,
}: {
    buttons: ChatButton[];
    onSendMessage: (text: string) => void;
}) {
    return (
        <div className="space-y-2">
            {buttons.map((button, idx) => {
                const label = button.text ?? button.action ?? "";
                const action = button.action ?? button.text ?? "";
                if (!label) return null;
                return (
                    <button
                        key={`${label}-${idx}`}
                        className="flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                        onClick={() => action && onSendMessage(action)}
                    >
                        <span>{label}</span>
                        <span className="text-xs">›</span>
                    </button>
                );
            })}
        </div>
    );
}

function DoctorCard({
    doctorName,
    title,
    doctorCode,
    doctorId,
    onSendMessage,
    fetchAvailableTimeSlots,
}: {
    doctorName: string;
    title: string;
    doctorCode?: string;
    doctorId?: string;
    onSendMessage: (text: string) => void;
    fetchAvailableTimeSlots: FetchAvailableTimeSlots;
}) {
    const [expanded, setExpanded] = useState(false);
    const [selectedDate, setSelectedDate] = useState("");
    const [selectedTime, setSelectedTime] = useState("");
    const [bookedTimes, setBookedTimes] = useState<string[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);

    const handleDateChange = async (value: string) => {
        setSelectedDate(value);
        setSelectedTime("");
        setBookedTimes([]);
        if (!value) return;
        setLoadingSlots(true);
        const result = await fetchAvailableTimeSlots({
            date: value,
            doctorId,
            doctorCode,
        });
        setBookedTimes(result.booked_times ?? []);
        setLoadingSlots(false);
    };

    const handleReserve = () => {
        if (!selectedDate || !selectedTime) return;
        const [hour, minute] = selectedTime.split(":");
        const dateLabel = formatKoreanDate(selectedDate);
        const message = `${doctorName} ${dateLabel} ${Number(hour)}시${Number(minute)}분 예약`;
        onSendMessage(message);
        setExpanded(false);
    };

    return (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-800">{doctorName}</div>
                    <div className="text-xs text-slate-500">{title || "-"}</div>
                </div>
                <button
                    className="text-xs font-semibold text-sky-600"
                    onClick={() => setExpanded((prev) => !prev)}
                >
                    {expanded ? "닫기" : "예약하기"}
                </button>
            </div>
            {expanded && (
                <div className="mt-3 space-y-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-slate-600">예약 날짜</label>
                        <input
                            type="date"
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={selectedDate}
                            min={formatYmd(new Date())}
                            onChange={(e) => handleDateChange(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-slate-600">예약 시간</label>
                        {loadingSlots ? (
                            <div className="text-xs text-slate-400">시간 조회 중...</div>
                        ) : (
                            <div className="grid grid-cols-4 gap-2">
                                {generateTimeSlots().map((slot) => {
                                    const now = new Date();
                                    const isToday = selectedDate === formatYmd(now);
                                    const [h, m] = slot.split(":").map(Number);
                                    const slotMinutes = h * 60 + m;
                                    const nowMinutes = now.getHours() * 60 + now.getMinutes();
                                    const isPast = isToday && slotMinutes <= nowMinutes;
                                    const isBooked = bookedTimes.includes(slot);
                                    const disabled = isPast || isBooked;
                                    const selected = selectedTime === slot;
                                    return (
                                        <button
                                            key={slot}
                                            disabled={disabled}
                                            className={`rounded-lg px-2 py-1 text-xs ${
                                                disabled
                                                    ? "bg-slate-100 text-slate-400"
                                                    : selected
                                                        ? "bg-primary text-white"
                                                        : "bg-white text-slate-700 border border-slate-200"
                                            }`}
                                            onClick={() => setSelectedTime(slot)}
                                        >
                                            {slot}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button
                        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={!selectedDate || !selectedTime}
                        onClick={handleReserve}
                    >
                        예약 완료
                    </button>
                </div>
            )}
        </div>
    );
}

function ReservationCard({
    date,
    time,
    department,
    doctor,
    rescheduleMode,
    onSendMessage,
    fetchAvailableTimeSlots,
}: {
    date: string;
    time: string;
    department: string;
    doctor: string;
    rescheduleMode: boolean;
    onSendMessage: (text: string) => void;
    fetchAvailableTimeSlots: FetchAvailableTimeSlots;
}) {
    const [expanded, setExpanded] = useState(false);
    const [selectedDate, setSelectedDate] = useState(date || "");
    const [selectedTime, setSelectedTime] = useState(time || "");
    const [bookedTimes, setBookedTimes] = useState<string[]>([]);
    const [loadingSlots, setLoadingSlots] = useState(false);

    const doctorCode =
        doctor.includes("(") && doctor.includes(")")
            ? doctor.slice(doctor.indexOf("(") + 1, doctor.indexOf(")"))
            : undefined;

    const handleDateChange = async (value: string) => {
        setSelectedDate(value);
        setSelectedTime("");
        setBookedTimes([]);
        if (!value) return;
        setLoadingSlots(true);
        const result = await fetchAvailableTimeSlots({
            date: value,
            doctorCode,
        });
        setBookedTimes(result.booked_times ?? []);
        setLoadingSlots(false);
    };

    const handleReschedule = () => {
        if (!selectedDate || !selectedTime) return;
        const originalDateTime = `${date} ${time}`.trim();
        const newDateTime = `${selectedDate} ${selectedTime}`.trim();
        const message = `${doctor} 의료진 예약을 ${originalDateTime}에서 ${newDateTime}로 변경`;
        onSendMessage(message);
        setExpanded(false);
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-800">
                        {time ? `${date} ${time}` : date}
                    </div>
                    <div className="text-xs text-slate-500">{department}</div>
                    <div className="text-xs text-slate-500">{doctor}</div>
                </div>
                {rescheduleMode && (
                    <button
                        className="text-xs font-semibold text-primary"
                        onClick={() => setExpanded((prev) => !prev)}
                    >
                        {expanded ? "닫기" : "예약 변경"}
                    </button>
                )}
            </div>
            {rescheduleMode && expanded && (
                <div className="mt-3 space-y-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-slate-600">변경 날짜</label>
                        <input
                            type="date"
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={selectedDate}
                            min={formatYmd(new Date())}
                            onChange={(e) => handleDateChange(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-slate-600">변경 시간</label>
                        {loadingSlots ? (
                            <div className="text-xs text-slate-400">시간 조회 중...</div>
                        ) : (
                            <div className="grid grid-cols-4 gap-2">
                                {generateTimeSlots().map((slot) => {
                                    const now = new Date();
                                    const isToday = selectedDate === formatYmd(now);
                                    const [h, m] = slot.split(":").map(Number);
                                    const slotMinutes = h * 60 + m;
                                    const nowMinutes = now.getHours() * 60 + now.getMinutes();
                                    const isPast = isToday && slotMinutes <= nowMinutes;
                                    const isBooked = bookedTimes.includes(slot);
                                    const disabled = isPast || isBooked;
                                    const selected = selectedTime === slot;
                                    return (
                                        <button
                                            key={slot}
                                            disabled={disabled}
                                            className={`rounded-lg px-2 py-1 text-xs ${
                                                disabled
                                                    ? "bg-slate-100 text-slate-400"
                                                    : selected
                                                        ? "bg-primary text-white"
                                                        : "bg-white text-slate-700 border border-slate-200"
                                            }`}
                                            onClick={() => setSelectedTime(slot)}
                                        >
                                            {slot}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button
                        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={!selectedDate || !selectedTime}
                        onClick={handleReschedule}
                    >
                        변경 완료
                    </button>
                </div>
            )}
        </div>
    );
}
