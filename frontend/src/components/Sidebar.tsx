import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Users,
  LogOut,
  Brain,
  Activity,
  Stethoscope,
  TrendingUp,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Scan,
  BarChart3,
  FileText
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const departmentNavigation = {
  호흡기내과: [
    { name: "폐암 예측", href: "/lung-cancer", icon: Stethoscope },
    { name: "폐암 통계", href: "/lung-cancer-stats", icon: TrendingUp },
    { name: "지식 허브", href: "/knowledge-hub", icon: BookOpen },
    { name: "예약 정보", href: "/reservation-info", icon: CalendarDays },
    { name: "처방전달시스템", href: "/ocs", icon: FileText },
  ],
  방사선과: [
    { name: "영상 업로드", href: "/mri-viewer", icon: Scan },
    { name: "처방전달시스템", href: "/ocs", icon: FileText },
  ],
  영상의학과: [
    { name: "영상 판독", href: "/mri-viewer", icon: Scan },
    { name: "처방전달시스템", href: "/ocs", icon: FileText },
  ],
  외과: [
    { name: "영상 판독", href: "/mri-viewer", icon: Scan },
    { name: "지식 허브", href: "/knowledge-hub", icon: BookOpen },
    { name: "예약 정보", href: "/reservation-info", icon: CalendarDays },
    { name: "처방전달시스템", href: "/ocs", icon: FileText },
  ],
  검사실: [
    { name: "검사실 대시보드", href: "/laboratory-dashboard", icon: Activity },
    { name: "AI 분석", href: "/laboratory-ai-analysis", icon: Brain },
    { name: "병리이미지분석", href: "/pathology-analysis", icon: Scan },
    { name: "처방전달시스템", href: "/ocs", icon: FileText },
  ],
};

const adminNavigation = [
  { name: "환자 정보", href: "/patients", icon: Users },
  { name: "진료 접수", href: "/medical-registration", icon: ClipboardList },
  { name: "예약 정보", href: "/reservation-info", icon: CalendarDays },
  { name: "처방전달시스템", href: "/ocs", icon: FileText },
];

interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen?: (open: boolean) => void;
}

export default function Sidebar({ isSidebarOpen }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/medical_staff', { replace: true });
    } catch {
      navigate('/medical_staff', { replace: true });
    }
  };

  const dashboardHref = user
    ? (user.role === 'medical_staff' ? '/medical_staff' : '/admin_staff')
    : '/';

  // 역할 및 진료과에 따라 다른 메뉴 구성
  let departmentMenuItems: Array<{ name: string; href: string; icon: any }> = [];

  if (user) {
    if (user.role === 'admin_staff') {
      departmentMenuItems = adminNavigation;
    } else if (user.role === 'medical_staff') {
      // department 값 정규화 (공백 제거, 대소문자 무시)
      const normalizedDept = user.department?.trim();
      const deptMenu = departmentNavigation[normalizedDept as keyof typeof departmentNavigation];
      departmentMenuItems = deptMenu || departmentNavigation['외과'];

      // 디버깅용 로그 (개발 환경에서만)
      if (process.env.NODE_ENV === 'development' && normalizedDept === '검사실' && !deptMenu) {
        console.warn('검사실 메뉴를 찾을 수 없습니다. department 값:', normalizedDept, '사용 가능한 키:', Object.keys(departmentNavigation));
      }
    }
  } else {
    departmentMenuItems = departmentNavigation['외과'];
  }

  // 검사실 사용자는 대시보드 메뉴 제외
  const menuItems = user?.department === '검사실'
    ? departmentMenuItems
    : [
      { name: '대시보드', href: dashboardHref, icon: BarChart3 },
      ...departmentMenuItems
    ];

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

  const userName = user ? `${user.last_name || ''} ${user.first_name || user.username}`.trim() : "게스트";

  return (
    <>
      {/* Sidebar */}
      <aside className={cn(
        "fixed left-0 top-0 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 z-40",
        isSidebarOpen ? "w-64" : "w-20"
      )}>
        {/* Logo Section */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
          <NavLink to={dashboardHref}>
            <div className="flex items-center gap-3 cursor-pointer">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center flex-shrink-0">
                <Brain className="w-6 h-6" />
              </div>
              {isSidebarOpen && (
                <div className="flex flex-col">
                  <span className="font-bold text-sm">CDSS</span>
                  <span className="text-xs text-muted-foreground">Platform</span>
                </div>
              )}
            </div>
          </NavLink>
        </div>

        {/* Menu Items */}
        <nav className="p-4 space-y-2 overflow-y-auto h-[calc(100vh-180px)]">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group cursor-pointer block",
                  isActive
                    ? "bg-primary text-white"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {isSidebarOpen && (
                  <span className="text-sm font-medium">{item.name}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {isSidebarOpen && (
            <div className="mb-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent text-white flex items-center justify-center flex-shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{userName}</p>
                  <p className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit", getRoleBadgeColor(user?.role || ''))}>
                    {getRoleLabel(user?.role || '')}
                  </p>
                </div>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4" />
            {isSidebarOpen && <span>로그아웃</span>}
          </Button>
        </div>
      </aside>

    </>
  );
}
