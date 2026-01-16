import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Activity, Plus, Calendar, User, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import doctorProfile from "@/assets/doctor-profile.png";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/NotificationBell";

interface MedicalLayoutProps {
    children: React.ReactNode;
    isSidebarOpen: boolean;
    setIsSidebarOpen: (open: boolean) => void;
}

export default function MedicalLayout({ children, isSidebarOpen, setIsSidebarOpen }: MedicalLayoutProps) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const { data: todayAppointments } = useQuery({
        queryKey: ["today-appointments-count"],
        queryFn: async () => {
            try {
                const response = await apiRequest("GET", "/api/patients/appointments/today_appointments_count/");
                return response;
            } catch (err) {
                console.error("Layout - 오늘 예약 수 조회 오류:", err);
                return {
                    today_count: 0,
                };
            }
        },
        refetchInterval: 30000,
    });

    const isDashboard = location.pathname === '/medical_staff' || location.pathname === '/admin_staff';

    const getRoleBadgeColor = (role: string) => {
        const colors = {
            medical_staff: "bg-blue-100 text-blue-700",
            admin_staff: "bg-purple-100 text-purple-700",
        };
        return colors[role as keyof typeof colors] || "bg-gray-100 text-gray-700";
    };

    const getRoleLabel = (role: string) => {
        const labels = {
            medical_staff: "의료진",
            admin_staff: "관리자",
        };
        return labels[role as keyof typeof labels] || "사용자";
    };

    return (
        <div className="min-h-screen">
            {/* Top Header */}
            <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30">
                <div className="flex items-center justify-between px-8 py-4">
                    <button 
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    >
                        {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                    </button>

                        <div className="flex items-center gap-4">
                        {/* Quick Search */}
                            <div className="hidden md:flex relative group">
                                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                    <Activity className="h-4 w-4 text-gray-400" />
                                </div>
                                <input
                                    type="text"
                                    placeholder="빠른 환자 검색..."
                                className="bg-slate-100 dark:bg-slate-800 border-none rounded-full py-2 pl-10 pr-4 text-xs w-64 focus:ring-2 focus:ring-primary/20 transition-all"
                                />
                            </div>

                        {/* Notifications */}
                        <NotificationBell />

                        {/* User Profile */}
                        <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-slate-800">
                            <div className="text-right hidden md:block">
                                <p className="text-sm font-medium text-foreground">
                                    {user ? `${user.last_name || ''} ${user.first_name || user.username}`.trim() : "게스트"}
                                </p>
                                <p className={cn("text-xs font-semibold px-2 py-0.5 rounded-full w-fit", getRoleBadgeColor(user?.role || ''))}>
                                    {getRoleLabel(user?.role || '')}
                                </p>
                                </div>
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center flex-shrink-0">
                                <User className="w-5 h-5" />
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Page Content */}
            <div className="p-8">
                {/* Persistent Hero Banner Section - Only on Dashboard */}
                {isDashboard && (
                    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3a8a] via-[#1e40af] to-[#1d4ed8] p-8 mb-8 shadow-xl shadow-blue-900/10 transition-all duration-500">
                        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
                        <div className="absolute -right-20 -top-20 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>

                        <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                            <div className="shrink-0">
                                <div className="relative w-28 h-28 md:w-32 md:h-32 rounded-2xl overflow-hidden border-4 border-white/20 shadow-2xl group transition-transform hover:scale-[1.02]">
                                    <img src={doctorProfile} alt="Doctor Profile" className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                </div>
                            </div>

                            <div className="flex-1 text-center md:text-left text-white">
                                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-400/20 border border-blue-400/30 text-[10px] font-medium uppercase tracking-wider mb-3 animate-fade-in">
                                    <Activity className="w-3 h-3" />
                                    의료 통계 활성화
                                </div>

                                <h1 className="text-2xl md:text-3xl font-bold mb-2 tracking-tight leading-tight">
                                    안녕하세요,<br />
                                    <span className="text-blue-200">
                                        {user ? `${user.last_name || ''} ${user.first_name || user.username}`.trim() : "게스트"}
                                    </span> 선생님
                                </h1>

                                <p className="text-blue-100/80 mb-4 font-medium">
                                    오늘 <span className="text-white border-b border-white font-bold">{todayAppointments?.today_count || 0}개의 예약</span>이 있습니다.
                                </p>

                                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                                    <Button
                                        className="bg-white text-blue-900 hover:bg-blue-50 font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-black/10 transition-all hover:scale-[1.05] active:scale-95 h-11 text-sm flex items-center gap-2"
                                        onClick={() => navigate('/medical-registration')}
                                    >
                                        <Plus className="w-4 h-4" /> 신규 진료
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        className="bg-blue-400/10 hover:bg-blue-400/20 text-white border border-white/20 font-bold px-5 py-2.5 rounded-xl transition-all hover:bg-blue-500/20 h-11 text-sm flex items-center gap-2"
                                        onClick={() => navigate('/reservation-info')}
                                    >
                                        <Calendar className="w-4 h-4" /> 일정 보기
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Page Content */}
                <div className="animate-in fade-in duration-500">
                    {children}
                </div>
            </div>
        </div>
    );
}
