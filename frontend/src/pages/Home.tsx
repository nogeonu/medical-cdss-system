import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight, 
  Activity, 
  Brain, 
  ShieldCheck, 
  CalendarCheck,
  Search,
  FileText,
  Phone,
  Calendar,
  User,
  Menu,
  X
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

export default function Home() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { patientUser } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

const navItems = [
    { name: "병원소개", path: "#about" },
    { name: "진료안내", path: "/patient/doctors" },
    { name: "의료진소개", path: "/patient/doctors" },
    { name: "건강정보", path: "/health-info" },
    { name: "고객센터", path: "#contact" },
];

  return (
    <div className="min-h-screen flex flex-col bg-background font-sans">
      {/* Header */}
      <header 
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b",
          isScrolled 
            ? "bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-sm border-gray-200 dark:border-gray-800 py-3" 
            : "bg-transparent border-transparent py-5"
        )}
      >
        <div className="container flex items-center justify-between">
          {/* Logo */}
          <Link to="/">
            <div className="flex items-center gap-2 cursor-pointer group">
              <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent text-white shadow-lg group-hover:shadow-primary/30 transition-all duration-300">
                <Activity className="w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold tracking-tight leading-none text-foreground">CDSS</span>
                <span className="text-[10px] font-medium text-muted-foreground tracking-wider">MEDICAL CENTER</span>
              </div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-8">
            <nav className="flex gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className="px-4 py-2 text-base font-medium bg-transparent hover:bg-primary/5 hover:text-primary rounded-md transition-colors cursor-pointer"
                >
                  {item.name}
                </Link>
              ))}
            </nav>
          </div>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link to={patientUser ? "/patient/mypage" : "/patient/login"}>
              <Button variant="outline" className="gap-2 border-primary/20 hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-all">
                <User className="w-4 h-4" />
                <span>{patientUser ? "마이페이지" : "로그인"}</span>
              </Button>
            </Link>
            <Link to="/patient/login">
              <Button className="gap-2 bg-gradient-to-r from-primary to-accent hover:opacity-90 shadow-md hover:shadow-lg transition-all">
                <Calendar className="w-4 h-4" />
                <span>진료예약</span>
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            className="md:hidden p-2 text-foreground"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-background md:hidden pt-24 px-6 animate-in slide-in-from-top-10 duration-200">
          <nav className="flex flex-col gap-6 text-lg font-medium">
            {navItems.map((item) => (
              <Link key={item.path} to={item.path}>
                <span 
                  className="py-3 border-b border-border flex justify-between items-center cursor-pointer"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.name}
                </span>
              </Link>
            ))}
            <div className="flex flex-col gap-3 mt-4">
              <Link to={patientUser ? "/patient/mypage" : "/patient/login"}>
                <Button variant="outline" className="w-full justify-center gap-2">
                  <User className="w-4 h-4" />
                  {patientUser ? "마이페이지" : "로그인"}
                </Button>
              </Link>
              <Link to="/patient/login">
                <Button className="w-full justify-center gap-2 bg-gradient-to-r from-primary to-accent">
                  <Calendar className="w-4 h-4" />
                  진료예약
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 pt-20">
        {/* Hero Section */}
        <section className="relative min-h-[90vh] flex items-center overflow-hidden bg-slate-50 dark:bg-slate-950">
          {/* Background Image with Overlay */}
          <div className="absolute inset-0 z-0">
            <img 
              src="/images/hero-bg.jpg" 
              alt="Futuristic Hospital Lobby" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-white/90 via-white/70 to-transparent dark:from-black/90 dark:via-black/70 dark:to-transparent"></div>
          </div>

          <div className="container relative z-10 pt-20">
            <div className="max-w-2xl animate-in slide-in-from-left-10 duration-1000 fade-in">
              <Badge className="mb-6 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 px-4 py-1.5 text-sm backdrop-blur-sm">
                <Activity className="w-3.5 h-3.5 mr-2 animate-pulse" />
                Next Generation Medical AI
              </Badge>
              <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-6 leading-[1.1]">
                미래 의료의 기준,<br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-accent">CDSS 메디컬 센터</span>
              </h1>
              <p className="text-xl text-slate-600 dark:text-slate-300 mb-10 leading-relaxed max-w-lg">
                최첨단 AI 진단 시스템과 전문 의료진의 협진으로<br/>
                당신의 건강한 삶을 위한 가장 정확한 답을 제시합니다.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/patient/login">
                  <Button size="lg" className="h-14 px-8 text-lg bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 rounded-full">
                    진료 예약하기 <ArrowRight className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
                <Link to="/patient/doctors">
                  <Button size="lg" variant="outline" className="h-14 px-8 text-lg bg-white/50 backdrop-blur-sm border-slate-300 hover:bg-white rounded-full">
                    의료진 찾기 <Search className="ml-2 w-5 h-5" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Floating Stats Card */}
          <div className="absolute bottom-10 right-10 hidden lg:block animate-in slide-in-from-bottom-10 duration-1000 delay-300 fade-in">
            <div className="glass-panel p-6 rounded-2xl max-w-xs backdrop-blur-md bg-white/90 dark:bg-black/60 shadow-xl border border-white/20">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                  <Brain className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground font-medium">AI 진단 정확도</p>
                  <p className="text-2xl font-bold text-foreground">99.8%</p>
                </div>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-accent w-[99.8%]"></div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Access Menu */}
        <section className="relative z-20 -mt-20 pb-20">
          <div className="container">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { icon: CalendarCheck, title: "간편 예약", desc: "모바일로 쉽고 빠르게", link: patientUser ? "/patient/mypage" : "/patient/login" },
                { icon: Search, title: "진료과 찾기", desc: "증상별 맞춤 진료과", link: "/patient/doctors" },
                { icon: FileText, title: "제증명 발급", desc: "온라인 즉시 발급", link: patientUser ? "/patient/records" : "/patient/login" },
                { icon: Activity, title: "유방암 정보", desc: "통계 및 기본 정보", link: "/breast-cancer-stats" }
              ].map((item, idx) => (
                <Link key={idx} to={item.link}>
                  <Card className="border-none shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 bg-white dark:bg-slate-800 overflow-hidden group cursor-pointer">
                    <CardContent className="p-8 flex flex-col items-center text-center relative">
                      <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full -mr-4 -mt-4 group-hover:bg-primary/10 transition-colors"></div>
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <item.icon className="w-8 h-8" />
                      </div>
                      <h3 className="text-xl font-bold mb-2 text-foreground">{item.title}</h3>
                      <p className="text-muted-foreground">{item.desc}</p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* AI Diagnosis Section */}
        <section className="py-24 bg-slate-50 dark:bg-slate-900 overflow-hidden">
          <div className="container">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              <div className="lg:w-1/2 relative">
                <div className="relative rounded-3xl overflow-hidden shadow-2xl border-8 border-white dark:border-slate-800">
                  <img 
                    src="/images/ai-diagnosis.jpg" 
                    alt="AI Diagnosis System" 
                    className="w-full h-auto hover:scale-105 transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-8">
                    <div className="text-white">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className="bg-accent text-white border-none">CDSS v2.0</Badge>
                        <span className="text-sm font-medium text-white/80">실시간 분석 중</span>
                      </div>
                      <p className="font-medium">환자 데이터 실시간 동기화 및 분석</p>
                    </div>
            </div>
          </div>
                {/* Decorative Elements */}
                <div className="absolute -top-10 -left-10 w-40 h-40 bg-primary/10 rounded-full blur-3xl"></div>
                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-accent/10 rounded-full blur-3xl"></div>
              </div>
              
              <div className="lg:w-1/2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-bold mb-6">
                  <Brain className="w-4 h-4" />
                  <span>Intelligent Healthcare</span>
            </div>
                <h2 className="text-4xl md:text-5xl font-bold mb-6 leading-tight text-foreground">
                  AI가 더하는<br/>
                  <span className="text-primary">정확함의 깊이</span>
                </h2>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                  CDSS(Clinical Decision Support System)는 수만 건의 임상 데이터를 학습한 AI가 의료진의 진단을 보조하여, 오진율을 획기적으로 낮추고 최적의 치료 계획을 수립하도록 돕습니다.
                </p>
                
                <div className="space-y-6">
                  {[
                    { title: "실시간 데이터 분석", desc: "환자의 생체 신호를 실시간으로 모니터링하고 이상 징후를 즉시 감지합니다." },
                    { title: "정밀 영상 판독", desc: "MRI, CT 등 의료 영상을 AI가 픽셀 단위로 분석하여 미세한 병변까지 찾아냅니다." },
                    { title: "맞춤형 치료 제안", desc: "유전체 정보와 생활 습관을 분석하여 개인별 최적의 치료법을 제시합니다." }
                  ].map((feature, idx) => (
                    <div key={idx} className="flex gap-4 p-4 rounded-xl hover:bg-white hover:shadow-md transition-all duration-300 border border-transparent hover:border-slate-100 dark:hover:border-slate-800">
                      <div className="mt-1 w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-primary shrink-0">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold mb-1 text-foreground">{feature.title}</h4>
                        <p className="text-muted-foreground">{feature.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Medical Staff Section */}
        <section className="py-24 bg-white dark:bg-black">
          <div className="container">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-4xl font-bold mb-4 text-foreground">최고의 의료진</h2>
              <p className="text-lg text-muted-foreground">
                각 분야 최고의 전문의들이 첨단 시스템과 함께 당신의 건강을 지킵니다.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[
                { name: "김태훈 교수", dept: "순환기내과", img: "/images/doctor-1.jpg", desc: "심장질환 AI 진단 권위자" },
                { name: "이서연 교수", dept: "신경외과", img: "/images/doctor-2.jpg", desc: "뇌혈관 정밀 수술 전문" },
                { name: "박준형 교수", dept: "정형외과", img: "/images/doctor-1.jpg", desc: "로봇 인공관절 수술 전문" },
                { name: "최지민 교수", dept: "소아청소년과", img: "/images/doctor-2.jpg", desc: "소아 희귀질환 전문" }
              ].map((doctor, idx) => (
                <div key={idx} className="group relative overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-900">
                  <div className="aspect-[4/5] overflow-hidden">
                    <img 
                      src={doctor.img} 
                      alt={doctor.name} 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity"></div>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-6 text-white transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                    <p className="text-accent font-medium text-sm mb-1">{doctor.dept}</p>
                    <h3 className="text-2xl font-bold mb-2">{doctor.name}</h3>
                    <p className="text-white/80 text-sm opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100">
                      {doctor.desc}
                    </p>
                  </div>
                  </div>
                ))}
            </div>
            
            <div className="text-center mt-12">
              <Link to="/patient/doctors">
                <Button variant="outline" size="lg" className="rounded-full px-8 border-primary text-primary hover:bg-primary hover:text-white">
                  의료진 전체보기
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* CDSS Platform Access Banner */}
        <section className="py-20 relative overflow-hidden">
          <div className="absolute inset-0">
            <img 
              src="/images/medical-tech.jpg" 
              alt="Medical Tech Background" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-primary/90 mix-blend-multiply"></div>
          </div>
          
          <div className="container relative z-10 text-center text-white">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">의료진 전용 플랫폼</h2>
            <p className="text-xl text-white/80 mb-10 max-w-2xl mx-auto">
              CDSS(Clinical Decision Support System)는 의료진을 위한 통합 진료 지원 시스템입니다.<br/>
              권한이 있는 의료진만 접속 가능합니다.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link to="/login">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-14 px-8 text-lg rounded-full font-bold">
                  CDSS 시스템 접속
                </Button>
              </Link>
              <Link to="/app-download">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-14 px-8 text-lg rounded-full font-bold">
                  사용자 앱 다운로드
      </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-50 dark:bg-slate-900 border-t border-border pt-16 pb-8">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            <div className="col-span-1 md:col-span-1">
              <div className="flex items-center gap-2 mb-6">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-white">
                  <Activity className="w-5 h-5" />
                </div>
                <span className="text-lg font-bold">CDSS Medical</span>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                차세대 지능형 의료지원 시스템으로<br/>
                더 정확하고 안전한 의료 서비스를 제공합니다.<br/>
                환자 중심의 미래형 병원, CDSS입니다.
              </p>
              <div className="flex gap-4">
                {/* Social Icons Placeholder */}
                <button className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-white transition-colors cursor-pointer text-xs font-bold">F</button>
                <button className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-white transition-colors cursor-pointer text-xs font-bold">T</button>
                <button className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-muted-foreground hover:bg-primary hover:text-white transition-colors cursor-pointer text-xs font-bold">I</button>
              </div>
            </div>
            
            <div>
              <h4 className="font-bold mb-6 text-foreground">진료 안내</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link to="/patient/doctors"><span className="hover:text-primary transition-colors cursor-pointer">진료과 안내</span></Link></li>
                <li><Link to="/patient/doctors"><span className="hover:text-primary transition-colors cursor-pointer">의료진 찾기</span></Link></li>
                <li><Link to="/patient/login"><span className="hover:text-primary transition-colors cursor-pointer">진료 예약</span></Link></li>
                <li><Link to="/patient/login"><span className="hover:text-primary transition-colors cursor-pointer">건강검진 예약</span></Link></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-bold mb-6 text-foreground">병원 이용</h4>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li><Link to={patientUser ? "/patient/records" : "/patient/login"}><span className="hover:text-primary transition-colors cursor-pointer">진료 내역 조회</span></Link></li>
                <li><Link to={patientUser ? "/patient/mypage" : "/patient/login"}><span className="hover:text-primary transition-colors cursor-pointer">마이페이지</span></Link></li>
                <li><Link to="/app-download"><span className="hover:text-primary transition-colors cursor-pointer">앱 다운로드</span></Link></li>
                <li><Link to="/patient/login"><span className="hover:text-primary transition-colors cursor-pointer">증명서 발급</span></Link></li>
              </ul>
            </div>
            
          <div>
              <h4 className="font-bold mb-6 text-foreground">고객 센터</h4>
              <div className="flex items-center gap-3 mb-4">
                <Phone className="w-5 h-5 text-primary" />
                <span className="text-xl font-bold">1577-0000</span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                평일: 09:00 - 18:00<br/>
                토요일: 09:00 - 13:00<br/>
                일요일/공휴일 휴무
              </p>
              <Button variant="outline" size="sm" className="mt-4 w-full">
                1:1 문의하기
              </Button>
            </div>
          </div>
          
          <div className="border-t border-slate-200 dark:border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
            <div className="flex gap-6">
              <a href="#" className="hover:text-foreground">이용약관</a>
              <a href="#" className="font-bold hover:text-foreground">개인정보처리방침</a>
              <a href="#" className="hover:text-foreground">환자의 권리와 의무</a>
            </div>
            <p>© 2025 CDSS Medical Center. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
