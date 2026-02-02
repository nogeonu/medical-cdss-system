import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Phone,
    MessageSquare,
    HelpCircle,
    User,
    Home,
    Activity,
    Send,
    Bot,
    CheckCircle2,
    AlertCircle,
    FileText
} from "lucide-react";
import { cn } from "@/lib/utils";
import axios from "axios";
import {
    CHAT_API_URL,
    ChatButton,
    ChatTable,
    Msg,
    ChatTableCards,
    ChatActionButtons
} from "@/components/ChatbotCommon";

// 타입 정의
type ViewState = 'voice' | 'chatbot' | 'contact' | 'faq';

// 챗봇 관련 타입
const createId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export default function CustomerSupport() {
    const [currentView, setCurrentView] = useState<ViewState>('voice');
    const { patientUser, user } = useAuth();
    const isAuthenticated = !!patientUser || !!user;

    // 뷰 전환 시 스크롤 상단 이동
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [currentView]);

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            {/* Header */}
            <header className="bg-white border-b sticky top-0 z-50 h-16 flex items-center shadow-sm">
                <div className="container max-w-7xl mx-auto px-4 md:px-6 flex justify-between items-center">
                    <Link to="/" className="flex items-center gap-2 font-bold text-xl text-blue-600 group">
                        <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                            <Activity className="w-5 h-5" />
                        </div>
                        <span>CDSS Health</span>
                    </Link>
                    <Link to="/">
                        <Button variant="ghost" size="sm" className="gap-2 text-slate-500 hover:text-slate-900">
                            <Home className="w-4 h-4" /> 홈으로
                        </Button>
                    </Link>
                </div>
            </header>

            <main className="container max-w-7xl mx-auto px-4 md:px-6 py-12">
                <div className="flex flex-col lg:flex-row gap-8">

                    {/* Left Sidebar Navigation */}
                    <aside className="w-full lg:w-64 shrink-0 space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
                        <div>
                            <h1 className="text-2xl font-bold mb-2">고객센터</h1>
                            <p className="text-sm text-slate-500">무엇을 도와드릴까요?</p>
                        </div>

                        <nav className="flex flex-col gap-1">
                            <SidebarButton
                                active={currentView === 'voice'}
                                icon={User}
                                label="고객의 소리"
                                onClick={() => setCurrentView('voice')}
                            />
                            <SidebarButton
                                active={currentView === 'chatbot'}
                                icon={MessageSquare}
                                label="챗봇 상담"
                                onClick={() => setCurrentView('chatbot')}
                            />
                            <SidebarButton
                                active={currentView === 'contact'}
                                icon={Phone}
                                label="주요 전화번호"
                                onClick={() => setCurrentView('contact')}
                            />
                            <SidebarButton
                                active={currentView === 'faq'}
                                icon={HelpCircle}
                                label="자주 묻는 질문"
                                onClick={() => setCurrentView('faq')}
                            />
                        </nav>

                        <div className="bg-blue-600 rounded-2xl p-6 text-white shadow-lg shadow-blue-200">
                            <p className="font-bold text-lg mb-2">응급의료센터</p>
                            <p className="text-3xl font-black mb-1">042-600-9119</p>
                            <p className="text-blue-200 text-sm">365일 24시간 연중무휴</p>
                        </div>
                    </aside>

                    {/* Right Content Area */}
                    <div className="flex-1 min-h-[600px] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
                        {currentView === 'voice' && <VoiceView user={patientUser} />}
                        {currentView === 'chatbot' && <EmbeddedChatbot user={patientUser} isAuthenticated={isAuthenticated} />}
                        {currentView === 'contact' && <ContactView />}
                        {currentView === 'faq' && <FaqView />}
                    </div>
                </div>
            </main>
        </div>
    );
}

function SidebarButton({ active, icon: Icon, label, onClick }: { active: boolean, icon: any, label: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-3 px-4 py-4 text-left font-medium rounded-xl transition-all duration-200",
                active
                    ? "bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
        >
            <Icon className={cn("w-5 h-5", active ? "text-blue-600" : "text-slate-400")} />
            {label}
        </button>
    );
}

// --- Views ---

function VoiceView({ user }: { user: any }) {
    const [formData, setFormData] = useState({
        name: user?.name || '',
        phone: user?.phone_number || '',
        email: user?.email || '',
        relation: 'self',
        type: 'compliment',
        title: '',
        content: ''
    });
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);

    // 유저 정보가 로드되면 자동 채움
    useEffect(() => {
        if (user) {
            setFormData(prev => ({
                ...prev,
                name: user.name || prev.name,
                phone: user.phone_number || prev.phone,
                email: user.email || prev.email
            }));
        }
    }, [user]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleRadioChange = (name: string, value: string) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await axios.post('/api/hospital/voc/', formData);
            setSubmitted(true);
        } catch (error) {
            console.error("Failed to submit VOC", error);
            alert("접수 중 오류가 발생했습니다. 다시 시도해주세요.");
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div className="bg-white rounded-3xl p-12 text-center shadow-sm border border-slate-100 h-full flex flex-col items-center justify-center animate-in zoom-in-95">
                <div className="w-24 h-24 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-6">
                    <CheckCircle2 className="w-12 h-12" />
                </div>
                <h2 className="text-3xl font-bold text-slate-900 mb-4">소중한 의견이 접수되었습니다.</h2>
                <p className="text-slate-500 mb-8 text-lg max-w-md mx-auto">
                    보내주신 내용은 담당 부서에서 확인 후 신속하게 답변 드리겠습니다. 감사합니다.
                </p>
                <div className="flex gap-4">
                    <Button onClick={() => setSubmitted(false)} variant="outline" className="h-12 px-8 text-base">
                        추가 접수하기
                    </Button>
                    <Link to="/">
                        <Button className="h-12 px-8 text-base">홈으로 돌아가기</Button>
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-3xl p-8 shadow-sm border border-slate-100">
                <div className="flex items-center gap-4 mb-8 pb-6 border-b border-slate-100">
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-inner">
                        <User className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">고객의 소리 작성</h2>
                        <p className="text-slate-500">칭찬, 제안, 불만 사항을 남겨주시면 더 나은 서비스로 보답하겠습니다.</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-8 max-w-3xl">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-base font-semibold text-slate-700">이름 <span className="text-red-500">*</span></Label>
                            <Input
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-base font-semibold text-slate-700">연락처 <span className="text-red-500">*</span></Label>
                            <Input
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                required
                                placeholder="010-0000-0000"
                                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label className="text-base font-semibold text-slate-700">이메일</Label>
                            <Input
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                type="email"
                                className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-base font-semibold text-slate-700">상담 유형</Label>
                        <div className="flex gap-3">
                            {[
                                { val: 'compliment', label: '칭찬', emoji: '👍' },
                                { val: 'suggestion', label: '제안', emoji: '📢' },
                                { val: 'complaint', label: '불만', emoji: '😓' }
                            ].map(item => (
                                <div
                                    key={item.val}
                                    onClick={() => handleRadioChange('type', item.val)}
                                    className={cn(
                                        "flex-1 cursor-pointer h-14 flex items-center justify-center rounded-xl border transition-all font-medium text-lg gap-2",
                                        formData.type === item.val
                                            ? "bg-blue-50 border-blue-500 text-blue-700 shadow-sm ring-1 ring-blue-500"
                                            : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                    )}
                                >
                                    <span>{item.emoji}</span> {item.label}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-base font-semibold text-slate-700">제목 <span className="text-red-500">*</span></Label>
                        <Input
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className="text-base font-semibold text-slate-700">내용 <span className="text-red-500">*</span></Label>
                        <Textarea
                            name="content"
                            value={formData.content}
                            onChange={handleChange}
                            required
                            className="h-48 p-4 rounded-xl bg-slate-50 border-slate-200 focus:bg-white transition-all resize-none text-base leading-relaxed"
                            placeholder="상세 내용을 입력해주세요."
                        />
                    </div>

                    <div className="pt-4">
                        <Button
                            type="submit"
                            disabled={submitting}
                            className="w-full h-14 text-lg font-bold rounded-xl bg-slate-900 hover:bg-slate-800 shadow-lg shadow-slate-200"
                        >
                            {submitting ? "접수 중..." : "접수하기"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function ContactView() {
    const contacts = [
        { label: "대표전화(예약/안내)", number: "042-600-9000", icon: Phone, color: "bg-blue-50 text-blue-600" },
        { label: "진료예약", number: "042-600-9001", icon: CheckCircle2, color: "bg-emerald-50 text-emerald-600" },
        { label: "건강검진예약", number: "042-600-9002", icon: Activity, color: "bg-orange-50 text-orange-600" },
        { label: "약처방문의", number: "042-600-9003", icon: FileText, color: "bg-purple-50 text-purple-600" },
        { label: "약처방전 재발급", number: "042-600-9004", icon: FileText, color: "bg-indigo-50 text-indigo-600" },
        { label: "입원비 확인 ARS", number: "042-600-9005", icon: Phone, color: "bg-pink-50 text-pink-600" },
        { label: "고객상담실", number: "042-600-9006", icon: MessageSquare, color: "bg-cyan-50 text-cyan-600" },
        { label: "응급실", number: "042-600-9119", icon: AlertCircle, color: "bg-red-50 text-red-600 border-red-100" },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {contacts.map((contact, idx) => (
                <div key={idx} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer group">
                    <div className={cn("w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:scale-110", contact.color)}>
                        <contact.icon className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm font-medium text-slate-500 mb-1">{contact.label}</p>
                        <p className="text-2xl font-bold text-slate-900 tracking-tight">{contact.number}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

function FaqView() {
    const [openIndices, setOpenIndices] = useState<number[]>([]);

    const toggleFaq = (index: number) => {
        setOpenIndices(prev =>
            prev.includes(index)
                ? prev.filter(i => i !== index)
                : [...prev, index]
        );
    };

    const faqs = [
        { q: "진료 예약은 어떻게 하나요?", a: "홈페이지 및 모바일 앱, 또는 대표전화(042-600-9001)를 통해 가능합니다." },
        { q: "주차 요금은 얼마인가요?", a: "외래 진료 시 4시간 무료이며, 이후 10분당 추가 요금이 발생합니다." },
        { q: "제증명 발급은 어떻게 하나요?", a: "본인 신분증을 지참하여 원무과 창구를 방문하시거나, 무인발급기/홈페이지에서 발급 가능합니다." },
        { q: "응급실은 언제 운영하나요?", a: "응급의료센터는 365일 24시간 연중무휴로 운영됩니다." },
        { q: "병원 위치가 어디인가요?", a: "대전광역시 서구 관저동언로 158 입니다." },
    ];

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold mb-6 px-2">자주 묻는 질문</h2>
            {faqs.map((faq, i) => {
                const isOpen = openIndices.includes(i);
                return (
                    <div
                        key={i}
                        onClick={() => toggleFaq(i)}
                        className={cn(
                            "bg-white rounded-2xl border transition-all cursor-pointer overflow-hidden",
                            isOpen ? "border-blue-200 shadow-md" : "border-slate-100 shadow-sm hover:border-blue-200"
                        )}
                    >
                        <div className="p-6 flex gap-4 items-start">
                            <span className={cn("font-bold text-lg shrink-0 mt-0.5 transition-colors", isOpen ? "text-blue-600" : "text-slate-400")}>Q.</span>
                            <div className="flex-1">
                                <h3 className={cn("font-bold text-lg transition-colors", isOpen ? "text-blue-700" : "text-slate-800")}>
                                    {faq.q}
                                </h3>
                                <div
                                    className={cn(
                                        "grid transition-all duration-300 ease-in-out",
                                        isOpen ? "grid-rows-[1fr] opacity-100 mt-4" : "grid-rows-[0fr] opacity-0 mt-0"
                                    )}
                                >
                                    <div className="overflow-hidden">
                                        <p className="text-slate-600 leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100/50">
                                            {faq.a}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div className={cn("mt-1 transition-transform duration-300 text-slate-400", isOpen && "rotate-180")}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m6 9 6 6 6-6" />
                                </svg>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// --- Embedded Chatbot ---

function EmbeddedChatbot({ user, isAuthenticated }: { user: any, isAuthenticated: boolean }) {
    const [messages, setMessages] = useState<Msg[]>([
        { role: "bot", text: "안녕하세요! 건양대학교병원 챗봇입니다. 무엇을 도와드릴까요?" },
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    // Auth Check


    // Refs
    const listRef = useRef<HTMLDivElement | null>(null);
    const sessionIdRef = useRef<string>(createId());

    useEffect(() => {
        // Scroll logic
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [messages]);

    const buildMetadata = () => {
        const metadata: Record<string, unknown> = {};
        if (user) {
            metadata.patient_id = user.patient_id;
            metadata.patient_identifier = user.patient_id;
            metadata.account_id = user.account_id;
            if (user.patient_pk != null) {
                metadata.patient_pk = user.patient_pk;
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

            const botText = typeof data?.reply === "string" ? data.reply :
                typeof data?.message === "string" ? data.message :
                    "응답을 불러오지 못했습니다.";

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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    }


    return (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col h-[700px]">
            {/* Chatbot Header inside embedded view */}
            <div className="bg-slate-50 border-b border-slate-100 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-primary animate-pulse">
                        <Bot className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">AI 스마트 챗봇</h3>
                        <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500 block"></span>
                            <span className="text-xs text-slate-500">운영중 • 실시간 답변</span>
                        </div>
                    </div>
                </div>

            </div>

            {/* Message List */}
            <div ref={listRef} className="flex-1 overflow-y-auto p-6 space-y-4 bg-white/50">
                {messages.map((m, i) => (
                    <div key={i} className={cn("flex w-full", m.role === "user" ? "justify-end" : "justify-start")}>
                        <div className={cn("flex flex-col gap-2 max-w-[85%]", m.role === "user" ? "items-end" : "items-start")}>
                            <div className={cn(
                                "rounded-2xl px-5 py-3 text-sm leading-relaxed shadow-sm block w-fit",
                                m.role === "user"
                                    ? "bg-blue-600 text-white rounded-tr-none"
                                    : "bg-white border border-slate-100 text-slate-800 rounded-tl-none"
                            )}>
                                <div className="whitespace-pre-wrap">{m.text}</div>
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
                        <div className="bg-slate-100 text-slate-500 rounded-2xl rounded-tl-none px-5 py-3 text-sm animate-pulse">
                            답변을 작성하고 있습니다...
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-slate-100 bg-white">
                <div className="relative flex items-center gap-2">
                    <Input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={isAuthenticated ? "메시지를 입력하세요..." : "궁금한 내용을 입력하세요..."}
                        className="h-14 pl-6 pr-14 rounded-full bg-slate-50 border-slate-200 focus-visible:ring-blue-500 focus-visible:ring-2 text-base shadow-inner"
                    />
                    <Button
                        onClick={send}
                        disabled={loading || !input.trim()}
                        className="absolute right-2 w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 p-0 shadow-md transition-all active:scale-95"
                    >
                        <Send className="w-5 h-5 ml-0.5" />
                    </Button>
                </div>
                <p className="text-center text-xs text-slate-400 mt-2">
                    {isAuthenticated
                        ? "개인정보 보호를 위해 주민등록번호 등 민감정보는 입력하지 마세요."
                        : "예약 및 진료 내역 조회는 로그인이 필요합니다."}
                </p>
            </div>
        </div>
    );
}
