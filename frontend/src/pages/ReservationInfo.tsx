import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { DateClickArg } from "@fullcalendar/interaction";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as MiniCalendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { getDoctorsApi, searchPatientsApi } from "@/lib/api";
import { useCalendar } from "@/context/CalendarContext";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronDown, Loader2, Search, Plus } from "lucide-react";

type DetailEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  type?: string;
  status?: string;
  memo?: string;
  patientId?: string;
  patientName?: string;
  patientGender?: string;
  patientAge?: number;
  doctorName?: string;
  doctorDepartment?: string;
  doctorId?: string;
  doctorDisplay?: string;
};

type DoctorOption = {
  id: number;
  username: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  doctor_id?: string;
  department?: string;
};

type PatientOption = {
  id: string;
  name: string;
  patientId: string | null;
  gender: string;
  age: number | null;
  recordId: number | null;
};

const reservationTypeOptions = [
  { value: "예약", label: "예약" },
  { value: "검진", label: "검진" },
  { value: "회의", label: "회의" },
  { value: "내근", label: "내근" },
  { value: "외근", label: "외근" },
];

const colorByType: Record<string, { bg: string; border: string; text: string }> = {
  검진: { bg: "#DBEAFE", border: "#93C5FD", text: "#0F172A" },
  회의: { bg: "#DCFCE7", border: "#86EFAC", text: "#0F172A" },
  내근: { bg: "#FEF3C7", border: "#FCD34D", text: "#0F172A" },
  외근: { bg: "#FFE4E6", border: "#FDA4AF", text: "#0F172A" },
  예약: { bg: "#E0E7FF", border: "#A5B4FC", text: "#1E1B4B" },
};

const viewOptions: { key: "day" | "week" | "month"; label: string }[] = [
  { key: "day", label: "일간" },
  { key: "week", label: "주간" },
  { key: "month", label: "월간" },
];

const toFcView = (view: "day" | "week" | "month") =>
  view === "day" ? "timeGridDay" : view === "week" ? "timeGridWeek" : "dayGridMonth";

// 9:00 AM ~ 5:00 PM (30분 간격)
const timeOptions = Array.from({ length: 17 }, (_, i) => {
  const hour = Math.floor(i / 2) + 9;
  const minute = i % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  return { value, label: value };
});

export default function ReservationInfo() {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [currentTitle, setCurrentTitle] = useState<string>(format(new Date(), "yyyy.MM"));
  const [activeView, setActiveView] = useState<"day" | "week" | "month">("month");
  const [openDetail, setOpenDetail] = useState(false);
  const [detailEvent, setDetailEvent] = useState<DetailEvent | null>(null);
  const { events, addEvent, refresh } = useCalendar();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [openCreate, setOpenCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [loadingDoctors, setLoadingDoctors] = useState(false);
  const [form, setForm] = useState({
    title: "",
    type: reservationTypeOptions[0]?.value ?? "예약",
    doctor: "",
    date: "",
    startTime: "",
    endTime: "",
    patientName: "",
    patientId: "",
    patientGender: "",
    patientAge: "",
    memo: "",
    patientRecordId: "",
  });
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientSearchTerm, setPatientSearchTerm] = useState("");
  const [patientResults, setPatientResults] = useState<PatientOption[]>([]);
  const [patientSearchLoading, setPatientSearchLoading] = useState(false);

  const resetForm = useCallback(() => {
    setForm({
      title: "",
      type: reservationTypeOptions[0]?.value ?? "예약",
      doctor: "",
      date: "",
      startTime: "",
      endTime: "",
      patientName: "",
      patientId: "",
      patientGender: "",
      patientAge: "",
      memo: "",
      patientRecordId: "",
    });
  }, []);

  const fetchDoctors = useCallback(async () => {
    setLoadingDoctors(true);
    try {
      const data = await getDoctorsApi();
      setDoctors(Array.isArray(data?.doctors) ? data.doctors : []);
    } catch (error) {
      console.error("의사 목록을 불러오지 못했습니다.", error);
      toast({
        title: "의사 목록 조회 실패",
        description: "담당 의사 정보를 가져오는 중 문제가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setLoadingDoctors(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!openCreate) return;
    if (doctors.length === 0 && !loadingDoctors) {
      fetchDoctors().catch(() => {});
    }
  }, [openCreate, doctors.length, loadingDoctors, fetchDoctors]);

  // 예약 생성 이벤트 리스닝 (다른 페이지에서 예약 생성 시 자동 새로고침)
  useEffect(() => {
    const handleAppointmentCreated = () => {
      console.log("📅 예약 생성 이벤트 수신 - 예약 목록 새로고침");
      refresh();
    };

    window.addEventListener('appointment-created', handleAppointmentCreated);
    
    return () => {
      window.removeEventListener('appointment-created', handleAppointmentCreated);
    };
  }, [refresh]);

  useEffect(() => {
    const searchPatients = async () => {
      if (!patientSearchTerm.trim()) {
        setPatientResults([]);
        return;
      }

      setPatientSearchLoading(true);
      try {
        const data = await searchPatientsApi(patientSearchTerm);
        const mapped: PatientOption[] = (data || []).map((p: any) => ({
          id: String(p.id),
          name: p.name || "",
          patientId: p.patient_id || null,
          gender: p.gender || "",
          age: p.age ?? null,
          recordId: p.id || null,
        }));
        setPatientResults(mapped);
      } catch (error) {
        console.error("환자 검색 실패:", error);
        setPatientResults([]);
      } finally {
        setPatientSearchLoading(false);
      }
    };

    const timer = setTimeout(searchPatients, 300);
    return () => clearTimeout(timer);
  }, [patientSearchTerm]);

  const handlePatientSelect = useCallback((patient: PatientOption) => {
    setForm((prev) => ({
      ...prev,
      patientName: patient.name,
      patientId: patient.patientId || "",
      patientGender: patient.gender || "",
      patientAge: patient.age ? String(patient.age) : "",
      patientRecordId: patient.recordId ? String(patient.recordId) : "",
    }));
    setPatientSearchOpen(false);
    setPatientSearchTerm("");
  }, []);

  const handleCreateSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!form.title.trim()) {
        toast({
          title: "예약 제목을 입력해주세요.",
          variant: "destructive",
        });
        return;
      }
      if (!form.date || !form.startTime) {
        toast({
          title: "날짜와 시작 시간을 선택해주세요.",
          variant: "destructive",
        });
        return;
      }
      if (!form.doctor) {
        toast({
          title: "담당 의사를 선택해주세요.",
          variant: "destructive",
        });
        return;
      }

      // 9 AM ~ 5 PM 검증
      const startHour = parseInt(form.startTime.split(":")[0], 10);
      const endHour = form.endTime ? parseInt(form.endTime.split(":")[0], 10) : null;
      if (startHour < 9 || startHour >= 17) {
        toast({
          title: "예약 시간은 오전 9시부터 오후 5시 사이만 가능합니다.",
          variant: "destructive",
        });
        return;
      }
      if (endHour !== null && (endHour < 9 || endHour > 17)) {
        toast({
          title: "예약 종료 시간은 오전 9시부터 오후 5시 사이만 가능합니다.",
          variant: "destructive",
        });
        return;
      }

      // 날짜와 시간을 결합
      const startDateTime = `${form.date}T${form.startTime}:00`;
      const endDateTime = form.endTime ? `${form.date}T${form.endTime}:00` : undefined;

      const doctorId = parseInt(form.doctor, 10);
      if (isNaN(doctorId)) {
        toast({
          title: "유효하지 않은 의사 ID입니다.",
          variant: "destructive",
        });
        return;
      }

      const eventData = {
        title: form.title.trim(),
        start: startDateTime,
        end: endDateTime,
        type: form.type,
        doctor: doctorId,
        patient: form.patientRecordId ? parseInt(form.patientRecordId, 10) : undefined,
        patientName: form.patientName.trim() || undefined,
        patientId: form.patientId.trim() || undefined,
        patientGender: form.patientGender || undefined,
        patientAge: form.patientAge !== "" ? Number(form.patientAge) : undefined,
        memo: form.memo.trim() || undefined,
      };
      console.log("addEvent에 전달할 데이터:", eventData);

      setSubmitting(true);
      try {
        await addEvent(eventData);
        toast({
          title: "예약이 등록되었습니다.",
        });
        setOpenCreate(false);
        resetForm();
        refresh();
      } catch (error: any) {
        console.error("예약 등록에 실패했습니다.", error);
        console.error("에러 상세:", error?.response?.data || error?.message);

        let errorMessage = "잠시 후 다시 시도해주세요.";
        if (error?.response?.data) {
          const data = error.response.data;
          if (typeof data === "string") {
            errorMessage = data;
          } else if (data.detail) {
            errorMessage = data.detail;
          } else if (data.error) {
            errorMessage = data.error;
          } else {
            const firstKey = Object.keys(data)[0];
            if (firstKey) {
              const val = data[firstKey];
              errorMessage = Array.isArray(val) ? val.join(", ") : String(val);
            }
          }
        }

        toast({
          title: "예약 등록에 실패했습니다.",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setSubmitting(false);
      }
    },
    [addEvent, form, navigate, refresh, resetForm, toast],
  );

  const handleCreateOpenChange = useCallback(
    (open: boolean) => {
      setOpenCreate(open);
      if (!open) {
        resetForm();
        setSubmitting(false);
      }
    },
    [resetForm],
  );

  const fcEvents = useMemo(
    () =>
      events.map((event: any) => {
        const palette = colorByType[event.type || "예약"] || colorByType["예약"];
        return {
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          textColor: palette.text,
          extendedProps: {
            type: event.type,
            status: event.status,
            memo: event.memo,
            patientId: event.patientId,
            patientName: event.patientName,
            patientGender: event.patientGender,
            patientAge: event.patientAge,
            doctorName: event.doctorName,
            doctorDepartment: event.doctorDepartment,
            doctorId: event.doctorId,
            doctorDisplay: event.doctorDisplay,
          },
        };
      }),
    [events],
  );

  const upcomingReservations = useMemo(() => {
    const today = new Date();
    return [...events]
      .filter((event: any) => new Date(event.start).getTime() >= today.setHours(0, 0, 0, 0))
      .sort((a: any, b: any) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, 5);
  }, [events]);

  const syncTitle = () => {
    const api = calendarRef.current?.getApi();
    if (api) {
      setCurrentTitle(format(api.getDate(), "yyyy.MM"));
    }
  };

  const handlePrev = () => {
    const api = calendarRef.current?.getApi();
    api?.prev();
    syncTitle();
  };

  const handleNext = () => {
    const api = calendarRef.current?.getApi();
    api?.next();
    syncTitle();
  };

  const handleToday = () => {
    const api = calendarRef.current?.getApi();
    api?.today();
    const now = new Date();
    setSelectedDate(now);
    setCurrentTitle(format(now, "yyyy.MM"));
  };

  const changeView = (view: "day" | "week" | "month") => {
    setActiveView(view);
    const api = calendarRef.current?.getApi();
    api?.changeView(toFcView(view));
    syncTitle();
  };

  const onDateClick = (arg: DateClickArg) => {
    setSelectedDate(arg.date);
  };

  const onMiniSelect = (date?: Date) => {
    if (!date) return;
    const api = calendarRef.current?.getApi();
    api?.gotoDate(date);
    setSelectedDate(date);
    setCurrentTitle(format(date, "yyyy.MM"));
  };

  const colorLegend = [
    { label: "검진", color: colorByType["검진"]?.border },
    { label: "회의", color: colorByType["회의"]?.border },
    { label: "내근", color: colorByType["내근"]?.border },
    { label: "외근", color: colorByType["외근"]?.border },
  ];

  const renderEventContent = useCallback((info: any) => {
    const event = info.event;
    const palette = colorByType[(event.extendedProps as any)?.type || "예약"] || colorByType["예약"];
    
    // 시작 시간과 종료 시간을 하나의 문자열로 표시
    let timeLabel = "";
    if (event.start) {
      const startTime = event.start.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", hour12: false });
      if (event.end) {
        const endTime = event.end.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit", hour12: false });
        timeLabel = `${startTime} - ${endTime}`;
      } else {
        timeLabel = startTime;
      }
    }

    const patientName = (event.extendedProps as any)?.patientName;

    return (
      <div
        className="fc-event-card"
        style={{
          backgroundColor: palette.bg,
          borderColor: palette.border,
          color: palette.text,
        }}
      >
        {timeLabel && (
          <div className="fc-event-card__time">
            {timeLabel}
          </div>
        )}
        <div className="fc-event-card__title">{event.title}</div>
        {patientName && <div className="fc-event-card__meta">{patientName}</div>}
      </div>
    );
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* 상단 헤더 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">예약 관리</h1>
            <p className="text-gray-600">예약 일정을 관리하고 확인할 수 있습니다</p>
          </div>
          <Button 
            className="bg-blue-600 hover:bg-blue-700 text-white"
            type="button" 
            onClick={() => setOpenCreate(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            예약 등록
          </Button>
        </div>

        {/* 날짜 네비게이션 */}
        <div className="flex items-center justify-between bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-center gap-6">
            <h2 className="text-3xl font-bold text-gray-800">{currentTitle}</h2>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handlePrev}
                className="h-10 w-10 p-0 rounded-full hover:bg-gray-100"
              >
                ‹
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleToday}
                className="h-10 px-6 rounded-full hover:bg-gray-100 font-medium"
              >
                오늘
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleNext}
                className="h-10 w-10 p-0 rounded-full hover:bg-gray-100"
              >
                ›
              </Button>
            </div>
          </div>
          
          {/* 보기 전환 버튼 */}
          <div className="inline-flex rounded-xl border-2 border-gray-200 bg-white shadow-sm overflow-hidden">
            {viewOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`px-6 py-2.5 text-sm font-semibold transition-all ${
                  activeView === option.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
                onClick={() => changeView(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="flex flex-col gap-6 p-6 xl:flex-row">
            <div className="w-full space-y-4 xl:w-80">
              <Card className="shadow-sm border-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-bold text-gray-800">미니 달력</CardTitle>
                  <span className="text-sm text-muted-foreground font-medium">{currentTitle}</span>
                </CardHeader>
                <CardContent className="pt-0 pl-2">
                  <MiniCalendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={onMiniSelect}
                    className="rounded-2xl bg-slate-50 px-4 py-3 w-full"
                    classNames={{
                      months: "flex flex-col gap-2",
                      month: "space-y-2",
                      caption: "flex items-center justify-between px-1 text-sm font-semibold text-slate-700",
                      table: "w-full border-collapse text-center text-sm text-slate-600",
                      head_row: "",
                      head_cell: "pb-1 font-semibold text-slate-400",
                      row: "",
                      cell: "h-8 w-8 text-center",
                      day: "mx-auto h-8 w-8 flex items-center justify-center rounded-full text-sm font-medium hover:bg-blue-50",
                      day_selected: "bg-blue-600 text-white shadow-sm hover:bg-blue-600",
                      day_today: "border border-blue-500 text-blue-600",
                      day_outside: "text-slate-300",
                      day_disabled: "opacity-50",
                      day_hidden: "invisible",
                    }}
                  />
                </CardContent>
              </Card>

              <Card className="shadow-sm border-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-bold text-gray-800">범례</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {colorLegend.map((item) => (
                    <div key={item.label} className="flex items-center gap-3 text-sm text-gray-700 font-medium">
                      <span className="h-3 w-3 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                      {item.label}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="shadow-sm border-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg font-bold text-gray-800">다가오는 예약</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {upcomingReservations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">예정된 예약이 없습니다.</p>
                  ) : (
                    upcomingReservations.map((event: any) => {
                      const palette = colorByType[event.type || "예약"] || colorByType["예약"];
                      return (
                        <div key={event.id} className="rounded-lg border-2 bg-white border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-900">{event.title}</span>
                            <Badge
                              variant="outline"
                              style={{
                                borderColor: palette.border,
                                color: palette.text,
                                backgroundColor: palette.bg,
                              }}
                              className="border-0 font-medium"
                            >
                              {event.type || "예약"}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground font-medium">
                            {format(new Date(event.start), "yyyy년 MM월 dd일 HH:mm")}
                          </div>
                          {event.patientName && (
                            <div className="mt-1 text-xs text-gray-600 font-medium">
                              환자: {event.patientName}
                              {event.patientId ? ` (${event.patientId})` : ""}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex-1 min-w-0">
              <Card className="shadow-sm border-2 h-full">
                <CardContent className="p-4 md:p-6">
                  <style>{`
                  .reservation-calendar .fc .fc-toolbar { margin-bottom: 0; }
                  .reservation-calendar .fc { font-family: 'Pretendard', 'Inter', sans-serif; }
                  .reservation-calendar .fc .fc-scrollgrid { border-radius: 12px; overflow: hidden; }
                  .reservation-calendar .fc table { width: 100%; table-layout: fixed; }
                  .reservation-calendar .fc .fc-col-header-cell-cushion { padding: 10px 8px; font-size: 13px; color: #475569; font-weight: 600; }
                  .reservation-calendar .fc .fc-daygrid-day-top { display: flex; align-items: center; justify-content: flex-end; padding: 8px; }
                  .reservation-calendar .fc .fc-daygrid-day-number { font-size: 13px; color: #475569; }
                  .reservation-calendar .fc .fc-daygrid-day-frame { padding: 6px 8px 12px; }
                  .reservation-calendar .fc .fc-daygrid-day.fc-day-today { background: #eef2ff; }
                  .reservation-calendar .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number { color: #4338ca; font-weight: 700; }
                  .reservation-calendar .fc .fc-daygrid-event { 
                    padding: 2px 4px; 
                    border: none; 
                    background: transparent !important;
                    overflow: hidden;
                    max-width: 100%;
                  }
                  .reservation-calendar .fc .fc-daygrid-event .fc-event-main {
                    overflow: hidden;
                    max-width: 100%;
                  }
                  .reservation-calendar .fc .fc-timegrid-event { border: none !important; box-shadow: none !important; }
                  .reservation-calendar .fc .fc-timegrid-event .fc-event-main { 
                    padding: 8px;
                    border-radius: 8px;
                  }
                  .reservation-calendar .fc .fc-event-card {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    padding: 6px 8px;
                    border-radius: 8px;
                    border: none;
                    overflow: hidden;
                    max-width: 100%;
                  }
                  .reservation-calendar .fc .fc-event-card__time {
                    font-size: 11px;
                    font-weight: 600;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                  }
                  .reservation-calendar .fc .fc-event-card__title {
                    font-size: 12px;
                    font-weight: 600;
                    line-height: 1.3;
                    color: inherit;
                    word-break: keep-all;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  }
                  .reservation-calendar .fc .fc-event-card__meta {
                    font-size: 10px;
                    color: rgba(15, 23, 42, 0.65);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                  }
                  .reservation-calendar .fc .fc-daygrid-day.fc-day-sat,
                  .reservation-calendar .fc .fc-daygrid-day.fc-day-sun { background: #fafafa; }
                  .reservation-calendar .fc .fc-timegrid-slot { height: 40px; }
                  .reservation-calendar .fc .fc-timegrid-axis-cushion { font-size: 12px; color: #64748b; font-weight: 500; }
                  .reservation-calendar .fc .fc-timegrid-event .fc-event-main-frame {
                    border-radius: 8px;
                    overflow: hidden;
                  }
                `}</style>
                  <div
                    className="reservation-calendar"
                    style={{
                      ["--fc-border-color" as any]: "#e5e7eb",
                      ["--fc-page-bg-color" as any]: "transparent",
                      ["--fc-neutral-bg-color" as any]: "transparent",
                      ["--fc-today-bg-color" as any]: "transparent",
                    }}
                  >
                    <FullCalendar
                      ref={calendarRef as any}
                      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                      initialView={toFcView(activeView)}
                      headerToolbar={false}
                      height="auto"
                      events={fcEvents}
                      dayMaxEventRows={3}
                      eventDisplay="block"
                      displayEventTime={true}
                      displayEventEnd={false}
                      eventTimeFormat={{
                        hour: 'numeric',
                        minute: '2-digit',
                        meridiem: false
                      }}
                      slotMinTime="08:00:00"
                      slotMaxTime="20:00:00"
                      allDaySlot={false}
                      locale="ko"
                      firstDay={0}
                      dateClick={onDateClick}
                      eventContent={renderEventContent}
                      eventClick={(info) => {
                        const event = info.event;
                        const props = event.extendedProps as any;
                        setDetailEvent({
                          id: event.id,
                          title: event.title,
                          start: event.startStr,
                          end: event.endStr || undefined,
                          type: props?.type,
                          status: props?.status,
                          memo: props?.memo,
                          patientId: props?.patientId,
                          patientName: props?.patientName,
                          patientGender: props?.patientGender,
                          patientAge: props?.patientAge,
                          doctorName: props?.doctorName,
                          doctorDepartment: props?.doctorDepartment,
                          doctorId: props?.doctorId,
                          doctorDisplay: props?.doctorDisplay,
                        });
                        setOpenDetail(true);
                      }}
                      eventDidMount={(info) => {
                        const event = info.event;
                        const type = (event.extendedProps as any)?.type || "";
                        const patient = (event.extendedProps as any)?.patientName || "";
                        const memo = (event.extendedProps as any)?.memo || "";
                        const tooltipLines = [
                          event.title,
                          patient ? `환자: ${patient}` : "",
                          type ? `유형: ${type}` : "",
                          event.start ? `시작: ${new Date(event.start).toLocaleString("ko-KR")}` : "",
                          event.end ? `종료: ${new Date(event.end).toLocaleString("ko-KR")}` : "",
                          memo ? `메모: ${memo}` : "",
                        ].filter(Boolean);
                        info.el.setAttribute("title", tooltipLines.join("\n"));
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>

      <Dialog open={openCreate} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg font-semibold">예약 등록</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-3">
            <div className="grid gap-3 grid-cols-3">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="reservation-title" className="text-sm">예약 제목</Label>
                <Input id="reservation-title" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="예: 호흡기 진료 예약" required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reservation-type" className="text-sm">예약 유형</Label>
                <Select value={form.type} onValueChange={(value) => setForm((prev) => ({ ...prev, type: value }))}>
                  <SelectTrigger id="reservation-type" className="h-9">
                    <SelectValue placeholder="유형" />
                  </SelectTrigger>
                  <SelectContent>
                    {reservationTypeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="reservation-date" className="text-sm">예약 날짜</Label>
                <Input id="reservation-date" type="date" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="reservation-start-time" className="text-sm">시작 시간</Label>
                <Select value={form.startTime} onValueChange={(value) => setForm((prev) => ({ ...prev, startTime: value }))}>
                  <SelectTrigger id="reservation-start-time" className="h-9">
                    <SelectValue placeholder="시작" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reservation-end-time" className="text-sm">종료 시간</Label>
                <Select value={form.endTime || "none"} onValueChange={(value) => setForm((prev) => ({ ...prev, endTime: value === "none" ? "" : value }))}>
                  <SelectTrigger id="reservation-end-time" className="h-9">
                    <SelectValue placeholder="종료" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">선택 안 함</SelectItem>
                    {timeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="reservation-doctor" className="text-sm">담당 의사</Label>
              <Select value={form.doctor} onValueChange={(value) => setForm((prev) => ({ ...prev, doctor: value }))} disabled={loadingDoctors}>
                <SelectTrigger id="reservation-doctor" className="h-9">
                  <SelectValue placeholder={loadingDoctors ? "불러오는 중..." : "담당 의사 선택"} />
                </SelectTrigger>
                <SelectContent>
                  {loadingDoctors ? (
                    <SelectItem value="__loading" disabled>
                      불러오는 중...
                    </SelectItem>
                  ) : doctors.length > 0 ? (
                    doctors.map((doctor) => {
                      const fullName = [doctor.last_name, doctor.first_name].filter(Boolean).join(" ");
                      const displayName = fullName || doctor.username;
                      const extra = [doctor.department, doctor.doctor_id].filter(Boolean).join(" · ");
                      return (
                        <SelectItem key={doctor.id} value={String(doctor.id)}>
                          {displayName}
                          {extra ? ` (${extra})` : ""}
                        </SelectItem>
                      );
                    })
                  ) : (
                    <SelectItem value="__empty" disabled>
                      등록된 의료진이 없습니다.
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="reservation-patient-name" className="text-sm">환자 이름</Label>
                <Popover open={patientSearchOpen} onOpenChange={setPatientSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" role="combobox" aria-expanded={patientSearchOpen} className="w-full justify-between h-9">
                      <span className="truncate text-left">
                        {form.patientName ? `${form.patientName}${form.patientId ? ` (${form.patientId})` : ""}` : "환자명을 검색하세요"}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command shouldFilter={false}>
                      <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <CommandInput placeholder="환자명 또는 ID 검색..." value={patientSearchTerm} onValueChange={setPatientSearchTerm} autoFocus />
                      </div>
                      <CommandList>
                        {patientSearchLoading ? (
                          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            환자 정보를 불러오는 중입니다...
                          </div>
                        ) : patientResults.length > 0 ? (
                          <CommandGroup>
                            {patientResults.map((patient) => {
                              const genderLabel = patient.gender === "M" ? "남성" : patient.gender === "F" ? "여성" : "정보 없음";
                              return (
                                <CommandItem key={patient.id} value={`${patient.name} ${patient.patientId ?? ""}`} onSelect={() => handlePatientSelect(patient)}>
                                  <div className="flex w-full items-center justify-between">
                                    <div>
                                      <p className="font-medium text-sm">{patient.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {patient.patientId || "ID 없음"}
                                      </p>
                                    </div>
                                    <div className="text-right text-xs text-muted-foreground">
                                      {patient.age ? `${patient.age}세` : "나이 정보 없음"}
                                      <div>{genderLabel}</div>
                                    </div>
                                  </div>
                                </CommandItem>
                              )})}
                            {patientSearchTerm.trim() && (
                              <CommandItem key="manual-entry" value={patientSearchTerm.trim()} onSelect={() => {
                                handlePatientSelect({
                                  id: `manual-${Date.now()}`,
                                  name: patientSearchTerm.trim(),
                                  patientId: "",
                                  gender: "",
                                  age: null,
                                  recordId: null,
                                });
                              }}>
                                <div className="text-sm">
                                  직접 입력:{" "}
                                  <span className="font-semibold">
                                    {patientSearchTerm.trim()}
                                  </span>
                                </div>
                              </CommandItem>
                            )}
                          </CommandGroup>
                        ) : (
                          <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reservation-patient-id" className="text-sm">환자 ID</Label>
                <Input id="reservation-patient-id" value={form.patientId} onChange={(event) => setForm((prev) => ({ ...prev, patientId: event.target.value, patientRecordId: "", }))} placeholder="예: P2025001" className="h-9" />
              </div>
            </div>

            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="reservation-patient-gender" className="text-sm">환자 성별</Label>
                <Select value={form.patientGender === "" ? "__none" : form.patientGender} onValueChange={(value) => setForm((prev) => ({ ...prev, patientGender: value === "__none" ? "" : value }))}>
                  <SelectTrigger id="reservation-patient-gender" className="h-9">
                    <SelectValue placeholder="선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">선택 안 함</SelectItem>
                    <SelectItem value="M">남성</SelectItem>
                    <SelectItem value="F">여성</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reservation-patient-age" className="text-sm">환자 나이</Label>
                <Input id="reservation-patient-age" type="number" min={0} value={form.patientAge} onChange={(event) => setForm((prev) => ({ ...prev, patientAge: event.target.value }))} placeholder="숫자 입력" className="h-9" />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="reservation-memo" className="text-sm">메모</Label>
              <Textarea id="reservation-memo" value={form.memo} onChange={(event) => setForm((prev) => ({ ...prev, memo: event.target.value }))} placeholder="예약 관련 메모" rows={2} className="text-sm" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => handleCreateOpenChange(false)} disabled={submitting} className="h-9">
                취소
              </Button>
              <Button type="submit" disabled={submitting || loadingDoctors} className="h-9 bg-blue-600 hover:bg-blue-700">
                {submitting ? "등록 중..." : "등록"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={openDetail} onOpenChange={setOpenDetail}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-gray-900">{detailEvent?.title || "예약 상세"}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              예약에 대한 세부 정보를 확인하세요.
            </DialogDescription>
          </DialogHeader>
          {detailEvent && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">유형</span>
                <Badge variant="outline" className="text-xs">
                  {detailEvent.type || "예약"}
                </Badge>
              </div>
              <Separator />
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between">
                  <span className="text-gray-500">시작</span>
                  <span>{new Date(detailEvent.start).toLocaleString("ko-KR")}</span>
                </div>
                {detailEvent.end && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">종료</span>
                    <span>{new Date(detailEvent.end).toLocaleString("ko-KR")}</span>
                  </div>
                )}
                {(detailEvent.doctorDisplay || detailEvent.doctorName) && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">담당 의사</span>
                    <span>
                      {detailEvent.doctorDisplay || 
                       (detailEvent.doctorName && detailEvent.doctorDepartment 
                         ? `${detailEvent.doctorName} (${detailEvent.doctorDepartment})`
                         : detailEvent.doctorName)}
                    </span>
                  </div>
                )}
                {detailEvent.patientName && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">환자</span>
                    <span>
                      {detailEvent.patientName}
                      {detailEvent.patientId ? ` (${detailEvent.patientId})` : ""}
                    </span>
                  </div>
                )}
                {detailEvent.patientGender && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">성별</span>
                    <span>{detailEvent.patientGender}</span>
                  </div>
                )}
                {typeof detailEvent.patientAge === "number" && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">나이</span>
                    <span>{detailEvent.patientAge}세</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
