import { useState } from "react";

export const CHAT_API_URL = "/api/chatbot/";

export type ChatButton = { text?: string; action?: string };

export type ChatTable = {
    headers?: string[];
    rows?: Array<Array<string>>;
    reschedule_mode?: boolean;
    doctor_metadata?: Array<{ doctor_code?: string; doctor_id?: string }>;
};

export type Msg = { role: "user" | "bot"; text: string; table?: ChatTable; buttons?: ChatButton[]; requestId?: string };

export type FetchAvailableTimeSlots = (params: {
    date: string;
    doctorId?: string;
    doctorCode?: string;
}) => Promise<{ status?: string; booked_times?: string[] }>;

export const formatYmd = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
};

export const formatKoreanDate = (ymd: string) => {
    const parsed = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return ymd;
    return new Intl.DateTimeFormat("ko-KR", {
        month: "numeric",
        day: "numeric",
        weekday: "short",
    }).format(parsed);
};

export const generateTimeSlots = () => {
    const slots: string[] = [];
    for (let hour = 9; hour <= 18; hour += 1) {
        slots.push(`${String(hour).padStart(2, "0")}:00`);
        if (hour < 18) {
            slots.push(`${String(hour).padStart(2, "0")}:30`);
        }
    }
    return slots;
};

export function ChatTableCards({
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

export function ChatActionButtons({
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

export function DoctorCard({
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
        // 의사 코드 포함해서 백엔드가 예약 생성할 수 있도록 함
        const doctorInfo = doctorCode ? `${doctorName} (${doctorCode})` : doctorName;
        const message = `${doctorInfo} ${dateLabel} ${Number(hour)}시${Number(minute)}분 예약`;
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
                                            className={`rounded-lg px-2 py-1 text-xs ${disabled
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

export function ReservationCard({
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
                                            className={`rounded-lg px-2 py-1 text-xs ${disabled
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

