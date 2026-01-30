import { useEffect, useMemo, useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as MiniCalendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarDays, Heart, Mail, Search, User, CalendarIcon } from "lucide-react";
import { getDoctorsApi, createAppointmentApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

interface Doctor {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  department: string;
  doctor_id?: string | null;
}

const DEPARTMENTS = [
  { id: "respiratory", label: "호흡기내과" },
  { id: "surgery", label: "외과" },
];

const DEPARTMENT_LABELS: Record<string, string> = {
  respiratory: "호흡기내과",
  surgery: "외과",
};

function getDisplayName(doctor: Doctor) {
  const hasFirst = Boolean(doctor.first_name && doctor.first_name.trim());
  const hasLast = Boolean(doctor.last_name && doctor.last_name.trim());

  if (hasFirst && hasLast) {
    const first = doctor.first_name!.trim();
    const last = doctor.last_name!.trim();
    const containsKorean = /[ㄱ-ㅎ가-힣]/.test(first + last);
    if (containsKorean) {
      return `${last}${first}`; // 한국식: 성 + 이름 (공백 없이)
    }
    return `${first} ${last}`; // 영문 등은 First Last
  }

  if (hasFirst) {
    return doctor.first_name!.trim();
  }

  if (hasLast) {
    return doctor.last_name!.trim();
  }

  return doctor.username;
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// 9:00 AM ~ 5:00 PM (30분 간격)
const timeOptions = Array.from({ length: 17 }, (_, i) => {
  const hour = Math.floor(i / 2) + 9;
  const minute = i % 2 === 0 ? "00" : "30";
  const value = `${String(hour).padStart(2, "0")}:${minute}`;
  return { value, label: value };
});

export default function PatientDoctors() {
  const { patientUser } = useAuth();
  const { toast } = useToast();
  const [department, setDepartment] = useState<string>(DEPARTMENTS[0].id);
  const [searchTerm, setSearchTerm] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 예약 다이얼로그 상태
  const [appointmentDialogOpen, setAppointmentDialogOpen] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [appointmentDate, setAppointmentDate] = useState<Date | undefined>(new Date());
  const [appointmentTime, setAppointmentTime] = useState<string>("");
  const [appointmentTitle, setAppointmentTitle] = useState<string>("");
  const [appointmentMemo, setAppointmentMemo] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchDoctors = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getDoctorsApi(department);
        setDoctors(data.doctors ?? []);
      } catch (err) {
        console.error("의료진 조회 오류", err);
        setError(
          "의료진 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
        );
        setDoctors([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDoctors();
  }, [department]);

  const filteredDoctors = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) {
      return doctors;
    }
    return doctors.filter((doctor) => {
      const displayName = getDisplayName(doctor).toLowerCase();
      return (
        displayName.includes(keyword) ||
        (doctor.email ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [doctors, searchTerm]);

  const selectedDepartment = DEPARTMENTS.find((dept) => dept.id === department);

  const handleAppointmentClick = (doctor: Doctor) => {
    if (!patientUser) {
      toast({
        title: "로그인이 필요합니다",
        description: "진료 예약을 위해 먼저 로그인해주세요.",
        variant: "destructive",
      });
      return;
    }
    setSelectedDoctor(doctor);
    setAppointmentDate(new Date());
    setAppointmentTime("");
    setAppointmentTitle("");
    setAppointmentMemo("");
    setAppointmentDialogOpen(true);
  };

  const handleAppointmentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!selectedDoctor || !appointmentDate || !appointmentTime) {
      toast({
        title: "입력 값을 확인해주세요",
        description: "날짜와 시간을 모두 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    if (!patientUser) {
      toast({
        title: "로그인이 필요합니다",
        description: "진료 예약을 위해 먼저 로그인해주세요.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      // 날짜와 시간을 결합하여 Date 객체 생성 (로컬 시간 유지)
      const [hours, minutes] = appointmentTime.split(":").map(Number);
      const startDate = new Date(appointmentDate);
      startDate.setHours(hours, minutes, 0, 0);
      
      // 30분 후 종료 시간 계산
      const endDate = new Date(startDate);
      endDate.setMinutes(endDate.getMinutes() + 30);
      
      // 서버(Asia/Seoul, USE_TZ=False)에 맞게 로컬 시간 문자열로 전송 (toISOString 사용 시 UTC로 바뀌어 9시간 어긋남)
      const toLocalISO = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const h = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        const s = String(d.getSeconds()).padStart(2, "0");
        return `${y}-${m}-${day}T${h}:${min}:${s}`;
      };
      const startDateTime = toLocalISO(startDate);
      const endDateTime = toLocalISO(endDate);

      const appointmentData = {
        title: appointmentTitle.trim() || `${getDisplayName(selectedDoctor)} 의사 진료 예약`,
        type: "예약",
        start_time: startDateTime,
        end_time: endDateTime,
        doctor: selectedDoctor.id,
        patient_identifier: patientUser.patient_id,
        patient_name: patientUser.name,
        memo: appointmentMemo.trim() || "",
      };

      console.log("예약 데이터:", appointmentData);
      await createAppointmentApi(appointmentData);
      
      // 예약 생성 후 예약 정보 페이지에 알림 (자동 새로고침)
      window.dispatchEvent(new CustomEvent('appointment-created'));
      
      toast({
        title: "예약이 완료되었습니다",
        description: `${format(appointmentDate, "yyyy년 MM월 dd일", { locale: ko })} ${appointmentTime}에 예약되었습니다.`,
      });

      setAppointmentDialogOpen(false);
      setSelectedDoctor(null);
      setAppointmentDate(new Date());
      setAppointmentTime("");
      setAppointmentTitle("");
      setAppointmentMemo("");
    } catch (error: any) {
      console.error("예약 생성 실패:", error);
      console.error("에러 응답:", error?.response?.data);
      
      let errorMessage = "예약 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
      
      if (error?.response?.data) {
        const data = error.response.data;
        if (typeof data === "string") {
          errorMessage = data;
        } else if (data.detail) {
          errorMessage = data.detail;
        } else if (data.error) {
          errorMessage = data.error;
        } else if (data.non_field_errors) {
          errorMessage = Array.isArray(data.non_field_errors) 
            ? data.non_field_errors.join(", ") 
            : String(data.non_field_errors);
        } else {
          // 필드별 오류 메시지 수집
          const fieldErrors = Object.entries(data)
            .map(([field, messages]) => {
              const msg = Array.isArray(messages) ? messages.join(", ") : String(messages);
              return `${field}: ${msg}`;
            })
            .join("\n");
          if (fieldErrors) {
            errorMessage = fieldErrors;
          }
        }
      }
      
      toast({
        title: "예약 실패",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">
              MEDICAL STAFF
            </p>
            <h1 className="text-2xl font-bold text-slate-800">
              진료과 · 의료진 검색
            </h1>
            <p className="text-sm text-slate-500">
              진료과를 선택하고 전문 의료진의 프로필과 연락처를 확인하세요.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <Link
              to="/"
              className="rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 hover:border-primary/40 hover:text-primary"
            >
              환자 홈으로 돌아가기
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto mt-10 max-w-5xl space-y-8 px-6">
        <Card>
          <CardHeader className="border-b bg-white/80">
            <CardTitle className="text-base font-semibold text-slate-800">
              원하는 진료과와 의료진을 찾아보세요
            </CardTitle>
            <CardDescription>
              호흡기내과와 외과에 소속된 의료진 정보를 실시간으로 확인할 수
              있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6 md:grid-cols-[240px,1fr] md:items-center">
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                진료과 선택
              </span>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="bg-white">
                  <SelectValue placeholder="진료과를 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedDepartment && (
                <p className="text-xs text-slate-500">
                  {selectedDepartment.label} 전문 의료진과 상담 가능 일정을
                  확인할 수 있습니다.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                의료진 검색
              </span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="의료진 이름 또는 이메일로 검색하세요."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <p className="text-xs text-slate-500">
                예) 홍길동, resp001, doctor@example.com 등 키워드로 검색해
                보세요.
              </p>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">
              {selectedDepartment?.label ?? ""} 의료진 ({filteredDoctors.length}
              명)
            </h2>
            <Button asChild variant="ghost" size="sm" className="text-primary">
              <Link to="#appointments">진료 예약 안내 보기</Link>
            </Button>
          </div>

          {loading ? (
            <Card className="border-dashed border-slate-200 bg-white/70 text-center text-slate-600">
              <CardContent className="space-y-4 py-12">
                <Search className="mx-auto h-10 w-10 animate-spin text-primary/60" />
                <p className="text-base font-semibold">
                  의료진 정보를 불러오는 중입니다.
                </p>
              </CardContent>
            </Card>
          ) : filteredDoctors.length === 0 ? (
            <Card className="border-dashed border-slate-200 bg-white/70 text-center text-slate-600">
              <CardContent className="space-y-4 py-12">
                <Search className="mx-auto h-10 w-10 text-primary/60" />
                <p className="text-base font-semibold">검색 결과가 없습니다.</p>
                <p className="text-sm text-slate-500">
                  검색어를 다르게 입력하거나 다른 진료과를 선택해 주세요.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {filteredDoctors.map((doctor) => {
                const name = getDisplayName(doctor);
                const departmentLabel =
                  DEPARTMENT_LABELS[doctor.department] ?? doctor.department;
                return (
                  <Card
                    key={doctor.id}
                    className="border-slate-200 bg-white shadow-sm"
                  >
                    <CardHeader className="flex flex-row items-center gap-4 border-b bg-white/70">
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                        {getInitials(name)}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-lg font-semibold text-slate-800">
                            {name}
                          </CardTitle>
                          <Badge
                            variant="secondary"
                            className="border border-primary/30 bg-primary/10 text-primary"
                          >
                            {departmentLabel}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 py-6 text-sm text-slate-600">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <User className="h-4 w-4 text-primary" />
                        <span>아이디: {doctor.username}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Mail className="h-4 w-4 text-primary" />
                        <span>이메일: {doctor.email || "-"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <Button variant="outline" size="sm" className="gap-2">
                          <Search className="h-4 w-4" /> 상세소개 준비중
                        </Button>
                        <Button
                          size="sm"
                          className="gap-2 bg-primary text-white hover:bg-primary/90"
                          onClick={() => handleAppointmentClick(doctor)}
                        >
                          <CalendarDays className="h-4 w-4" /> 진료예약 문의
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2 text-primary hover:bg-primary/10"
                        >
                          <Heart className="h-4 w-4" /> 감사해요
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* 예약 다이얼로그 */}
      <Dialog open={appointmentDialogOpen} onOpenChange={setAppointmentDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>진료 예약</DialogTitle>
            <DialogDescription>
              {selectedDoctor && `${getDisplayName(selectedDoctor)} 의사님과의 진료 예약을 진행합니다.`}
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleAppointmentSubmit} className="space-y-6">
            {/* 환자 정보 */}
            {patientUser && (
              <div className="rounded-lg bg-slate-50 p-4">
                <Label className="text-sm font-semibold text-slate-700">환자 정보</Label>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  <p>이름: {patientUser.name}</p>
                  <p>환자 ID: {patientUser.patient_id}</p>
                </div>
              </div>
            )}

            {/* 의사 정보 */}
            {selectedDoctor && (
              <div className="rounded-lg bg-primary/5 p-4">
                <Label className="text-sm font-semibold text-slate-700">담당 의사</Label>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  <p>{getDisplayName(selectedDoctor)}</p>
                  <p>{DEPARTMENT_LABELS[selectedDoctor.department] || selectedDoctor.department}</p>
                </div>
              </div>
            )}

            {/* 예약 제목 */}
            <div className="space-y-2">
              <Label htmlFor="appointment-title">예약 제목 (선택사항)</Label>
              <Input
                id="appointment-title"
                placeholder="예: 정기 검진, 증상 상담 등"
                value={appointmentTitle}
                onChange={(e) => setAppointmentTitle(e.target.value)}
              />
            </div>

            {/* 날짜 선택 */}
            <div className="space-y-2">
              <Label>예약 날짜</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {appointmentDate ? (
                      format(appointmentDate, "yyyy년 MM월 dd일", { locale: ko })
                    ) : (
                      <span>날짜를 선택하세요</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <MiniCalendar
                    mode="single"
                    selected={appointmentDate}
                    onSelect={setAppointmentDate}
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* 시간 선택 */}
            <div className="space-y-2">
              <Label htmlFor="appointment-time">예약 시간</Label>
              <Select value={appointmentTime} onValueChange={setAppointmentTime}>
                <SelectTrigger id="appointment-time">
                  <SelectValue placeholder="시간을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 메모 */}
            <div className="space-y-2">
              <Label htmlFor="appointment-memo">증상 또는 문의사항 (선택사항)</Label>
              <Textarea
                id="appointment-memo"
                placeholder="증상이나 문의사항을 입력해주세요."
                value={appointmentMemo}
                onChange={(e) => setAppointmentMemo(e.target.value)}
                rows={4}
              />
            </div>

            {/* 버튼 */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAppointmentDialogOpen(false)}
                disabled={submitting}
              >
                취소
              </Button>
              <Button type="submit" disabled={submitting || !appointmentDate || !appointmentTime}>
                {submitting ? "예약 중..." : "예약하기"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
