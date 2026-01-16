import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Calendar,
  Activity,
  UserPlus,
  Search,
  Filter,
  CheckCircle,
  Clock,
  ChevronRight,
  TrendingUp,
  FileText,
  Plus
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { useNavigate } from "react-router-dom";

interface Patient {
  id: number;
  patient_id: string;
  name: string;
  birth_date: string;
  gender: string;
  phone?: string;
  address?: string;
  emergency_contact?: string;
  blood_type?: string;
  age: number;
  created_at: string;
  updated_at: string;
}

interface MedicalRecord {
  id: number;
  patient_id: string;
  name: string;
  department: string;
  status: string;
  notes: string;
  reception_start_time: string;
  treatment_end_time?: string;
  is_treatment_completed: boolean;
}

export default function Dashboard() {
  const [searchTerm, setSearchTerm] = useState("");
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [examinationResult, setExaminationResult] = useState("");
  const [treatmentNote, setTreatmentNote] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const searchResultRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (searchTerm.trim() && searchResultRef.current) {
      searchResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchTerm]);

  const { data: waitingPatients = [], isLoading } = useQuery({
    queryKey: ["waiting-patients"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/lung_cancer/medical-records/waiting_patients/");
        return response || [];
      } catch (err) {
        console.error("Dashboard - Waiting patients fetch error:", err);
        return [];
      }
    },
    refetchInterval: 30000,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/lung_cancer/patients/");
        return response.results || [];
      } catch (err) {
        return [];
      }
    },
    staleTime: Infinity,
  });

  const { data: dashboardStats } = useQuery({
    queryKey: ["dashboard-statistics"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/lung_cancer/medical-records/dashboard_statistics/");
        return response;
      } catch (err) {
        return {
          total_records: 0,
          waiting_count: 0,
          completed_count: 0,
          today_exams: 0,
        };
      }
    },
    refetchInterval: 30000,
  });

  const { data: todayAppointments } = useQuery({
    queryKey: ["today-appointments-count"],
    queryFn: async () => {
      try {
        const response = await apiRequest("GET", "/api/patients/appointments/today_appointments_count/");
        return response;
      } catch (err) {
        console.error("Dashboard - 오늘 예약 수 조회 오류:", err);
        return {
          today_count: 0,
        };
      }
    },
    refetchInterval: 30000,
  });

  const sortedWaitingPatients = [...(waitingPatients as MedicalRecord[])]
    .sort((a, b) => new Date(a.reception_start_time).getTime() - new Date(b.reception_start_time).getTime());
  const recentPatients = sortedWaitingPatients.slice(0, 5);

  const stats = [
    {
      title: "총 환자",
      value: dashboardStats?.total_records || 0,
      icon: Users,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      trend: "+2.5%"
    },
    {
      title: "오늘 예약",
      value: todayAppointments?.today_count || 0,
      icon: Calendar,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      trend: "안정적"
    },
    {
      title: "진료 완료",
      value: dashboardStats?.completed_count || 0,
      icon: CheckCircle,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      trend: "순조로움"
    },
    {
      title: "진료 대기",
      value: dashboardStats?.waiting_count || 0,
      icon: Clock,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      trend: "주의"
    }
  ];

  const filteredPatients = (patients as Patient[]).filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.patient_id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCompleteTreatment = async () => {
    if (!selectedRecord) return;
    setIsCompleting(true);
    try {
      await apiRequest('POST', `/api/lung_cancer/medical-records/${selectedRecord.id}/complete_treatment/`, {
        examination_result: examinationResult,
        treatment_note: treatmentNote,
      });
      toast({ title: "진료 완료", description: "진료가 성공적으로 완료되었습니다." });
      setIsCompleteDialogOpen(false);
      setSelectedRecord(null);
      setExaminationResult("");
      setTreatmentNote("");
      queryClient.invalidateQueries({ queryKey: ["waiting-patients"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-statistics"] });
    } catch (error: any) {
      toast({ title: "오류", description: "처리 중 오류가 발생했습니다.", variant: "destructive" });
    } finally {
      setIsCompleting(false);
    }
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="space-y-8"
    >
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">
        {stats.map((stat, index) => (
          <motion.div key={index} variants={itemVariants}>
            <Card className="border-none shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden bg-white">
              <CardContent className="p-6 relative">
                <div className="flex justify-between items-start mb-4">
                  <div className={`${stat.bgColor} p-3 rounded-2xl transition-transform group-hover:scale-110 duration-300`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <Badge variant="secondary" className="bg-gray-50 text-[10px] font-bold text-gray-500 border-none">
                    {stat.trend}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{stat.title}</p>
                  <p className="text-3xl font-black text-gray-900 tracking-tight">
                    {stat.value}
                  </p>
                </div>
                {/* Decorative Background Icon */}
                <stat.icon className={`absolute -right-4 -bottom-4 w-24 h-24 opacity-[0.03] ${stat.color} rotate-12`} />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Waiting Patients List */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card className="border-none shadow-sm h-full bg-white rounded-3xl overflow-hidden">
            <CardHeader className="border-b border-gray-50 pb-6">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-bold text-gray-900">대기 중인 환자</CardTitle>
                  <CardDescription className="text-xs font-medium text-gray-400">현재 총 {waitingPatients.length}명이 대기 중입니다.</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-xl text-blue-600 font-bold text-xs hover:bg-blue-50"
                  onClick={() => setShowAllWaiting(!showAllWaiting)}
                >
                  {showAllWaiting ? "간략히" : "전체 보기"}
                  <ChevronRight className={`ml-1 w-4 h-4 transition-transform ${showAllWaiting ? 'rotate-90' : ''}`} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto custom-scrollbar">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-6 animate-pulse flex items-center gap-4">
                      <div className="w-12 h-12 bg-gray-100 rounded-2xl" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-100 rounded w-1/4" />
                        <div className="h-3 bg-gray-100 rounded w-1/2" />
                      </div>
                    </div>
                  ))
                ) : (showAllWaiting ? sortedWaitingPatients : recentPatients).length > 0 ? (
                  <AnimatePresence mode="popLayout">
                    {(showAllWaiting ? sortedWaitingPatients : recentPatients).map((record: MedicalRecord, index: number) => (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        layout
                        key={record.id}
                        className="group flex items-center gap-4 p-5 hover:bg-blue-50/30 transition-colors"
                      >
                        <div className="w-12 h-12 flex-shrink-0 bg-white shadow-sm border border-gray-100 rounded-2xl flex items-center justify-center text-blue-600 font-black text-lg group-hover:bg-blue-600 group-hover:text-white transition-all">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-bold text-gray-900">{record.name}</span>
                            <Badge variant="outline" className="text-[10px] py-0 border-gray-200 text-gray-500">
                              {record.patient_id}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs font-medium text-gray-400">
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" /> {record.department}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" /> {new Date(record.reception_start_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelectedRecord(record);
                              setIsCompleteDialogOpen(true);
                            }}
                            className="rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white font-bold text-xs"
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" />
                            진료 완료
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                ) : (
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-sm font-bold text-gray-400">대기 중인 환자가 없습니다.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Actions Column */}
        <div className="space-y-6">
          <motion.div variants={itemVariants}>
            <Card className="border-none shadow-sm bg-blue-600 text-white rounded-3xl p-1 overflow-hidden relative group">
              <div className="absolute inset-0 bg-blue-700 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
              <CardContent className="p-6 relative z-10">
                <div className="bg-white/20 w-10 h-10 rounded-xl flex items-center justify-center mb-4 backdrop-blur-md">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-lg font-black mb-2 tracking-tight">지식 허브 바로가기</h3>
                <p className="text-blue-100/80 text-xs font-medium mb-4 leading-relaxed">
                  최신 의학 논문 및 치료 가이드라인을 확인하세요.
                </p>
                <Button
                  onClick={() => navigate('/knowledge-hub')}
                  className="w-full bg-white text-blue-600 hover:bg-blue-50 font-black rounded-xl"
                >
                  지식 허브 열기
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Card className="border-none shadow-sm bg-white rounded-3xl p-6">
              <h3 className="text-sm font-black text-gray-900 mb-6 flex items-center gap-2 tracking-tight">
                <Plus className="w-4 h-4 text-blue-600" />
                빠른 작업 (Quick Actions)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "환자 등록", icon: UserPlus, path: "/patients", color: "text-blue-600", bg: "bg-blue-50" },
                  { label: "MRI 조회", icon: Activity, path: "/mri-viewer", color: "text-purple-600", bg: "bg-purple-50" },
                  { label: "전체 예약", icon: Calendar, path: "/reservation-info", color: "text-emerald-600", bg: "bg-emerald-50" },
                  { label: "진료 접수", icon: FileText, path: "/medical-registration", color: "text-amber-600", bg: "bg-amber-50" },
                ].map((action, i) => (
                  <button
                    key={i}
                    onClick={() => navigate(action.path)}
                    className="flex flex-col items-center justify-center p-4 rounded-3xl border border-gray-50 hover:bg-gray-50 hover:scale-105 transition-all group"
                  >
                    <div className={`${action.bg} ${action.color} p-3 rounded-2xl mb-2 group-hover:shadow-sm`}>
                      <action.icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">{action.label}</span>
                  </button>
                ))}
              </div>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* Patient Search Section */}
      <motion.div variants={itemVariants}>
        <Card className="border-none shadow-sm bg-white rounded-3xl p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <h3 className="text-xl font-black text-gray-900 tracking-tight">통합 환자 검색</h3>
              <p className="text-xs font-medium text-gray-400">데이터베이스 내 모든 환자 정보를 빠르고 상세하게 검색합니다.</p>
            </div>
            <div className="flex items-center gap-2 flex-1 md:max-w-md">
              <div className="relative flex-1 group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-blue-600 transition-colors" />
                <Input
                  placeholder="환자 이름 또는 고유 번호 입력..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-11 h-12 bg-gray-50 border-none rounded-2xl focus-visible:ring-2 focus-visible:ring-blue-600/20"
                />
              </div>
              <Button size="icon" className="h-12 w-12 rounded-2xl bg-gray-900 hover:bg-black group">
                <Filter className="w-4 h-4 group-hover:scale-110 transition-transform" />
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {searchTerm.trim() && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="overflow-x-auto"
                ref={searchResultRef}
              >
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-50">
                      <th className="py-4 px-4">환자 프로필</th>
                      <th className="py-4 px-4">성별 / 나이</th>
                      <th className="py-4 px-4">연락처</th>
                      <th className="py-4 px-4">등록일</th>
                      <th className="py-4 px-4 text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredPatients.map((p) => (
                      <tr key={p.id} className="group hover:bg-gray-50/50 transition-colors">
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center font-black text-lg">
                              {p.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-gray-900">{p.name}</div>
                              <div className="text-[10px] font-bold text-gray-400">ID: {p.id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 font-medium text-gray-600">{p.gender} / {p.age}세</td>
                        <td className="py-4 px-4 font-medium text-gray-600">{p.phone || "-"}</td>
                        <td className="py-4 px-4 font-medium text-gray-600">{new Date(p.created_at).toLocaleDateString("ko-KR")}</td>
                        <td className="py-4 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-xl hover:bg-blue-50 hover:text-blue-600"
                            onClick={() => navigate('/patients')}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {filteredPatients.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-gray-400 font-bold">검색 결과가 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </motion.div>

      {/* Treatment Completion Dialog */}
      <Dialog open={isCompleteDialogOpen} onOpenChange={setIsCompleteDialogOpen}>
        <DialogContent className="rounded-3xl border-none p-0 overflow-hidden max-w-md">
          <div className="bg-emerald-600 p-8 text-white relative overflow-hidden">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
            <DialogHeader className="relative z-10">
              <div className="bg-white/20 w-12 h-12 rounded-2xl flex items-center justify-center mb-4 backdrop-blur-md">
                <CheckCircle className="w-6 h-6 text-white" />
              </div>
              <DialogTitle className="text-2xl font-black tracking-tight">진료 완료 승인</DialogTitle>
              <DialogDescription className="text-emerald-100 font-medium">
                {selectedRecord && `${selectedRecord.name} (${selectedRecord.patient_id})`} 환자의 진료 기록을 최종 저장하고 대기열에서 제외합니다.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-8 space-y-6 bg-white">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">검사 결과 및 소견</Label>
              <Input
                placeholder="예: 특이 소견 없음, 추가 MRI 필요 등"
                value={examinationResult}
                onChange={(e) => setExaminationResult(e.target.value)}
                className="h-12 bg-gray-50 border-none rounded-xl focus-visible:ring-2 focus-visible:ring-emerald-600/20"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">의료진 처방 메모</Label>
              <textarea
                className="w-full min-h-[120px] p-4 bg-gray-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-600/20 outline-none resize-none text-sm placeholder:text-gray-300 font-medium"
                placeholder="환자에게 전달할 주의사항이나 내부 기록용 메모를 입력하세요."
                value={treatmentNote}
                onChange={(e) => setTreatmentNote(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="ghost"
                className="flex-1 h-12 rounded-xl font-black text-gray-400 hover:bg-gray-50"
                onClick={() => setIsCompleteDialogOpen(false)}
                disabled={isCompleting}
              >
                닫기
              </Button>
              <Button
                className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-black shadow-lg shadow-emerald-600/20"
                onClick={handleCompleteTreatment}
                disabled={isCompleting}
              >
                {isCompleting ? "처리 중..." : "최종 완료"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
