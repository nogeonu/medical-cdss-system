import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  Calendar,
  Stethoscope,
  ClipboardList,
  Home as HomeIcon,
  Printer,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { apiRequest } from "@/lib/api";

interface RecordItem {
  id: number;
  patient_id: string;
  name: string;
  department: string;
  status: string;
  notes?: string | null;
  reception_start_time: string;
  treatment_end_time?: string | null;
  is_treatment_completed: boolean;
}

interface PatientSummary {
  patient_id: string;
  name: string;
  phone?: string;
  gender?: string;
  age?: number;
}

export default function PatientMedicalRecords() {
  const { patientUser } = useAuth();
  const [patientInfo, setPatientInfo] = useState<PatientSummary | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabels = useMemo(
    () => ({
      접수완료: "접수 완료",
      진료중: "진료 중",
      진료완료: "진료 완료",
    }),
    [],
  );

  const statusStyles = useMemo(
    () => ({
      접수완료: "bg-blue-100 text-blue-700 border-blue-200",
      진료중: "bg-yellow-100 text-yellow-800 border-yellow-200",
      진료완료: "bg-emerald-100 text-emerald-700 border-emerald-200",
    }),
    [],
  );

  useEffect(() => {
    if (!patientUser) return;
    const fetchRecords = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiRequest(
          "GET",
          `/api/lung_cancer/patients/${patientUser.patient_id}/medical_records/`,
        );
        setPatientInfo({
          patient_id: data.patient?.patient_id ?? patientUser.patient_id,
          name: data.patient?.name ?? patientUser.name,
          phone: data.patient?.phone,
          gender: data.patient?.gender_label ?? data.patient?.gender,
          age: data.patient?.age,
        });
        setRecords(
          Array.isArray(data.medical_records) ? data.medical_records : [],
        );
      } catch (fetchError: any) {
        const message =
          fetchError?.response?.data?.error ||
          fetchError?.message ||
          "진료 내역을 불러오지 못했습니다.";
        setError(message);
        setRecords([]);
      } finally {
        setLoading(false);
      }
    };

    fetchRecords();
  }, [patientUser]);

  const handlePrint = () => {
    window.print();
  };

  if (!patientUser) {
    return <Navigate to="/patient/login" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16 print:bg-white">
      <header className="border-b bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">
              MEDICAL HISTORY
            </p>
            <h1 className="text-2xl font-bold text-slate-800">
              {patientUser.name}님의 진료 내역
            </h1>
            <p className="text-sm text-slate-500">
              최근 진료 기록과 진행 상태를 확인할 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>
              환자 번호{" "}
              <span className="font-semibold text-slate-700">
                {patientUser.patient_id}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-4 text-xs"
              onClick={handlePrint}
            >
              <Printer className="mr-2 h-3.5 w-3.5" />
              인쇄하기
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-4 text-xs"
            >
              <Link to="/">홈으로</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* 인쇄용 헤더 (화면엔 숨기고 인쇄 시에만 표시) */}
      <div className="hidden print:block mb-8 text-center">
        <h1 className="text-3xl font-bold text-slate-900">제증명 발급 확인서</h1>
        <p className="text-sm text-slate-500 mt-2">
          발급일자: {new Date().toLocaleDateString("ko-KR")}
        </p>
      </div>

      <main className="mx-auto mt-10 max-w-5xl space-y-8 px-6">
        {patientInfo && (
          <Card className="border-primary/10 bg-white shadow-sm">
            <CardHeader className="border-b bg-white/60">
              <CardTitle className="flex items-center gap-2 text-lg text-slate-800">
                <ClipboardList className="h-5 w-5 text-primary" />
                기본 정보
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 py-6 text-sm text-slate-600 md:grid-cols-2">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  환자명
                </span>
                <p className="mt-1 text-base font-semibold text-slate-800">
                  {patientInfo.name}
                </p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  환자 번호
                </span>
                <p className="mt-1 text-base font-semibold text-slate-800">
                  {patientInfo.patient_id}
                </p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  연락처
                </span>
                <p className="mt-1">
                  {patientInfo.phone ?? "등록된 연락처가 없습니다"}
                </p>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  성별 / 나이
                </span>
                <p className="mt-1">
                  {patientInfo.gender ?? "미기입"}
                  {patientInfo.age ? ` · ${patientInfo.age}세` : ""}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-sm text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            진료 내역을 불러오는 중입니다...
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : records.length === 0 ? (
          <Card className="border-slate-200 bg-white/80 text-center text-slate-600">
            <CardContent className="space-y-4 py-12">
              <Stethoscope className="mx-auto h-10 w-10 text-primary/60" />
              <div className="space-y-2">
                <p className="text-lg font-semibold text-slate-800">
                  등록된 진료 내역이 없습니다.
                </p>
                <p className="text-sm text-slate-500">
                  진료 접수가 완료되면 이곳에서 진행 상태와 진료 결과를 확인할
                  수 있습니다.
                </p>
              </div>
              <Button asChild className="mt-2">
                <Link to="/">홈 화면으로 돌아가기</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {records.map((record) => {
              const statusLabel =
                statusLabels[record.status as keyof typeof statusLabels] ??
                record.status;
              const statusClass =
                statusStyles[record.status as keyof typeof statusStyles] ??
                "bg-slate-100 text-slate-700 border-slate-200";
              const startDate = record.reception_start_time
                ? new Date(record.reception_start_time)
                : null;
              const endDate = record.treatment_end_time
                ? new Date(record.treatment_end_time)
                : null;

              return (
                <Card
                  key={record.id}
                  className="border-slate-200 bg-white shadow-sm"
                >
                  <CardHeader className="flex flex-col gap-3 border-b bg-white/70 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-primary/10 p-3 text-primary">
                        <Calendar className="h-6 w-6" />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-semibold text-slate-800">
                          {record.department} 진료
                        </CardTitle>
                        <p className="text-sm text-slate-500">
                          접수일{" "}
                          {startDate
                            ? startDate.toLocaleString("ko-KR")
                            : "미기록"}
                        </p>
                      </div>
                    </div>
                    <Badge
                      className={`${statusClass} border px-3 py-1 text-xs font-semibold uppercase tracking-wide`}
                    >
                      {statusLabel}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-4 py-6 text-sm text-slate-600">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                          증상 / 메모
                        </span>
                        <p className="mt-1 whitespace-pre-line text-slate-700">
                          {record.notes?.trim()
                            ? record.notes
                            : "등록된 메모가 없습니다."}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            진료 상태
                          </span>
                          <p className="mt-1 text-sm">
                            {record.is_treatment_completed
                              ? "진료가 완료되었습니다."
                              : "진료가 진행 중입니다."}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            진료 종료
                          </span>
                          <p className="mt-1 text-sm">
                            {endDate
                              ? endDate.toLocaleString("ko-KR")
                              : "진료 완료 후 시간이 표시됩니다."}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      <HomeIcon className="h-4 w-4" />
                      건양대학교 병원 · 환자 포털 서비스
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
