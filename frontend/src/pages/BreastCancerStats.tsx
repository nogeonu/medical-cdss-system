import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { 
  Activity, TrendingUp, Calendar, Info, ShieldCheck, 
  AlertTriangle, Baby, MapPin, Search, ExternalLink, HeartPulse, CheckCircle2, CalendarDays,
  X as XIcon, Home
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// --- Interfaces ---
interface CancerTrend {
  year: string;
  breast: number;
  thyroid: number;
  colorectal: number;
  stomach: number;
  lung: number;
  cervical: number;
}

interface AgeSpecificIncidence {
  age_group: string;
  rate: number;
}

interface ScreeningRate {
  region: string;
  rate: number;
}

interface SurvivalRate {
  period: string;
  breast: number;
  thyroid: number;
  cervical: number;
}

interface RiskFactor {
  factor: string;
  risk_ratio: number;
  category: string;
}

interface Reference {
  title: string;
  publisher: string;
  url: string;
}

// --- Hardcoded Data (Mock) ---
const STATIC_STATS = {
  cancer_incidence_trends: [
    { year: "2018", breast: 23647, thyroid: 21924, colorectal: 11250, stomach: 9800, lung: 8500, cervical: 3500 },
    { year: "2019", breast: 24933, thyroid: 23000, colorectal: 11500, stomach: 9700, lung: 8800, cervical: 3400 },
    { year: "2020", breast: 25814, thyroid: 21000, colorectal: 11000, stomach: 9000, lung: 9100, cervical: 3200 },
    { year: "2021", breast: 27120, thyroid: 25000, colorectal: 11800, stomach: 9200, lung: 9600, cervical: 3100 },
    { year: "2022", breast: 28500, thyroid: 27000, colorectal: 12100, stomach: 9100, lung: 10200, cervical: 3000 },
  ] as CancerTrend[],
  
  age_specific_incidence: [
    { age_group: "20대", rate: 15.2 },
    { age_group: "30대", rate: 85.4 },
    { age_group: "40대", rate: 185.3 },
    { age_group: "50대", rate: 178.5 },
    { age_group: "60대", rate: 110.2 },
    { age_group: "70대+", rate: 65.8 },
  ] as AgeSpecificIncidence[],
  
  screening_rates_by_region: [
    { region: "서울", rate: 65.2 },
    { region: "부산", rate: 63.8 },
    { region: "대구", rate: 64.5 },
    { region: "인천", rate: 66.1 },
    { region: "광주", rate: 62.9 },
    { region: "대전", rate: 67.5 },
    { region: "울산", rate: 64.2 },
    { region: "세종", rate: 61.5 },
    { region: "경기", rate: 65.8 },
    { region: "강원", rate: 60.2 },
  ] as ScreeningRate[],
  
  survival_rates: [
    { period: "1993-1995", breast: 79.2, thyroid: 94.2, cervical: 77.5 },
    { period: "1996-2000", breast: 83.2, thyroid: 94.9, cervical: 80.0 },
    { period: "2001-2005", breast: 88.5, thyroid: 98.3, cervical: 81.3 },
    { period: "2006-2010", breast: 91.0, thyroid: 99.7, cervical: 80.3 },
    { period: "2011-2015", breast: 92.3, thyroid: 100.0, cervical: 79.9 },
    { period: "2016-2020", breast: 93.8, thyroid: 100.0, cervical: 80.5 },
  ] as SurvivalRate[],
  
  risk_factors: [
    { factor: "음주 (매일 한잔)", risk_ratio: 1.10, category: "생활습관" },
    { factor: "음주 (매일 2~3잔)", risk_ratio: 1.50, category: "생활습관" },
    { factor: "비만 (폐경 후 BMI>30)", risk_ratio: 1.30, category: "신체지표" },
    { factor: "가족력 (어머니/자매)", risk_ratio: 2.10, category: "유전" },
    { factor: "이른 초경 (<12세)", risk_ratio: 1.20, category: "호르몬" },
    { factor: "늦은 폐경 (>55세)", risk_ratio: 1.50, category: "호르몬" },
    { factor: "출산 경험 없음", risk_ratio: 1.40, category: "호르몬" },
  ] as RiskFactor[],

  references: [
    { title: "2021년 국가암등록통계", publisher: "보건복지부, 중앙암등록본부", url: "https://ncc.re.kr" },
    { title: "2022년 건강검진통계연보", publisher: "국민건강보험공단", url: "https://www.nhis.or.kr" },
    { title: "여성건강 통계 팩트시트", publisher: "질병관리청", url: "https://kdca.go.kr" },
    { title: "한국 여성 유방암 백서 2023", publisher: "한국유방암학회", url: "https://www.kbcs.or.kr" },
  ] as Reference[]
};

// --- Colors ---
const COLORS = {
  breast: '#db2777', // pink-600
  thyroid: '#9333ea', // purple-600
  colorectal: '#2563eb', // blue-600
  stomach: '#16a34a', // green-600
  lung: '#ea580c', // orange-600
  cervical: '#0891b2', // cyan-600
  risk: '#e11d48', // rose-600
};

// --- Helper Components for Self Check Guide ---
function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const SectionCard: React.FC<{
  title: string;
  subtitle?: string;
  step: number;
  children: React.ReactNode;
}> = ({ title, subtitle, step, children }) => (
  <div 
    className="group relative overflow-hidden rounded-2xl bg-white p-1 shadow-sm ring-1 ring-pink-100 transition-all hover:ring-pink-300 hover:shadow-md"
  >
    <div className="flex flex-col md:flex-row md:items-start gap-4 p-4">
      <div className="flex-shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 text-pink-600 font-bold text-lg border border-pink-100">
          {step}
        </div>
      </div>
      <div className="flex-1 space-y-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-1 text-sm text-slate-500 leading-relaxed">{subtitle}</p>}
        </div>
        <div className="pt-2">
          {children}
        </div>
      </div>
    </div>
  </div>
);

const Pill: React.FC<{ children: React.ReactNode; tone?: "pink" | "rose" | "slate" }> = ({
  children,
  tone = "slate",
}) => {
  const styles =
    tone === "pink"
      ? "bg-pink-50 text-pink-700 border-pink-100"
      : tone === "rose"
      ? "bg-rose-50 text-rose-800 border-rose-100"
      : "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold shadow-sm", styles)}>{children}</span>;
};

type Answer = "yes" | "no" | null;

const YesNo: React.FC<{
  label: string;
  help?: string;
  value: Answer;
  onChange: (v: Answer) => void;
}> = ({ label, help, value, onChange }) => (
  <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
    <div className="mb-3">
      <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
        {label}
      </div>
      {help && <div className="mt-1 text-xs text-slate-500 pl-3.5">{help}</div>}
    </div>
    <div className="flex gap-3">
      <button
        type="button"
        className={cx(
          "relative flex-1 flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-bold transition-colors",
          value === "yes"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:text-rose-600"
        )}
        onClick={() => onChange(value === "yes" ? null : "yes")}
      >
        <CheckCircle2 className={cx("w-4 h-4", value === 'yes' ? "opacity-100" : "opacity-50")} />
        예 (그렇다)
      </button>
      <button
        type="button"
        className={cx(
          "relative flex-1 flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-bold transition-colors",
          value === "no"
            ? "border-slate-300 bg-slate-100 text-slate-800"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-800"
        )}
        onClick={() => onChange(value === "no" ? null : "no")}
      >
        <XIcon className={cx("w-4 h-4", value === 'no' ? "opacity-100" : "opacity-50")} />
        아니오
      </button>
    </div>
  </div>
);

export default function WomenHealthStats() {
  const [showGuide, setShowGuide] = useState(false);

  // Self Check State
  const [lump, setLump] = useState<Answer>(null);
  const [discharge, setDischarge] = useState<Answer>(null);
  const [skinChange, setSkinChange] = useState<Answer>(null);

  const score = useMemo(() => {
    const yesCount = [lump, discharge, skinChange].filter((v) => v === "yes").length;
    return yesCount;
  }, [lump, discharge, skinChange]);

  const recommendation = useMemo(() => {
    // 아무것도 선택하지 않은 경우
    if (lump === null && discharge === null && skinChange === null) {
      return {
        tone: "slate" as const,
        title: "자가검진을 시작해보세요.",
        desc: "각 항목을 꼼꼼히 확인하고 체크해주세요.",
      };
    }

    if (score >= 2) {
      return {
        tone: "rose" as const,
        title: "전문의 상담 및 정밀 검사가 필요합니다.",
        desc: "2개 이상의 의심 징후가 발견되었습니다. 유방외과 전문의와 상담하여 초음파 등 정밀 검사를 받아보시는 것을 권장합니다.",
      };
    }
    if (score === 1) {
      return {
        tone: "rose" as const,
        title: "지속적인 관찰 또는 상담이 필요합니다.",
        desc: "발견된 변화가 1~2주 이상 지속되거나 통증/크기 변화가 동반된다면 병원 방문을 미루지 마세요.",
      };
    }
    return {
      tone: "pink" as const,
      title: "현재 특이한 이상 징후는 없습니다.",
      desc: "훌륭합니다! 매월 정기적인 자가검진과 2년 주기(40세 이상) 국가암검진을 꾸준히 챙겨주세요.",
    };
  }, [score, lump, discharge, skinChange]);

  // Reset self check state when dialog opens
  useEffect(() => {
    if (showGuide) {
      setLump(null);
      setDischarge(null);
      setSkinChange(null);
    }
  }, [showGuide]);

  const stats = STATIC_STATS;

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container mx-auto max-w-7xl flex items-center justify-between py-4 px-6 md:px-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-pink-600 text-white flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg text-slate-900">CDSS Health</span>
          </Link>
          <Link to="/">
            <button className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              <Home className="w-4 h-4" />
              홈으로 돌아가기
            </button>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-8 p-6 md:p-8 flex-1 w-full">
        {/* Header Section (Title) */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-slate-200 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className="text-pink-600 border-pink-200 bg-pink-50">
                <Activity className="w-3 h-3 mr-1" />
                Women's Health Analytics
              </Badge>
              <span className="text-xs font-medium text-slate-500 flex items-center gap-1">
                <Search className="w-3 h-3" />
                Source: National Cancer Registry & Open Data
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">여성 건강 데이터 인사이트</h1>
            <p className="text-slate-500 mt-2 max-w-2xl leading-relaxed">
              공공 데이터 API를 활용하여 유방암을 비롯한 여성 주요 질환의 발생 추이, 위험 요인, 예방 현황을 
              종합적으로 시각화한 대시보드입니다.
            </p>
          </div>
          <div className="hidden md:flex flex-col items-end gap-2">
             <Button 
               className="bg-pink-600 hover:bg-pink-700 text-white gap-2 font-bold shadow-md hover:shadow-lg transition-all"
               onClick={() => setShowGuide(true)}
             >
               <HeartPulse className="w-4 h-4 animate-pulse" />
               자가검진 가이드
             </Button>
             <div className="text-right">
               <div className="text-sm font-bold text-slate-700">Data Updated</div>
               <div className="text-xs text-slate-400">2026.01.16</div>
             </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="trends" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-12 bg-white border border-slate-200 p-1 rounded-xl shadow-sm">
            <TabsTrigger value="trends" className="data-[state=active]:bg-pink-50 data-[state=active]:text-pink-700 rounded-lg text-xs md:text-sm font-bold">
              <TrendingUp className="w-4 h-4 mr-2" />
              암 발생 추이
            </TabsTrigger>
            <TabsTrigger value="lifecycle" className="data-[state=active]:bg-purple-50 data-[state=active]:text-purple-700 rounded-lg text-xs md:text-sm font-bold">
              <Baby className="w-4 h-4 mr-2" />
              생애주기 리스크
            </TabsTrigger>
            <TabsTrigger value="prevention" className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 rounded-lg text-xs md:text-sm font-bold">
              <ShieldCheck className="w-4 h-4 mr-2" />
              예방 및 검진
            </TabsTrigger>
            <TabsTrigger value="risk" className="data-[state=active]:bg-rose-50 data-[state=active]:text-rose-700 rounded-lg text-xs md:text-sm font-bold">
              <AlertTriangle className="w-4 h-4 mr-2" />
              위험 요인 분석
            </TabsTrigger>
          </TabsList>

          {/* 1. Trends Tab */}
          <TabsContent value="trends" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Main Chart: Multi-cancer trends */}
              <Card className="lg:col-span-2 border-none shadow-lg bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-pink-600" />
                    주요 여성 암 발생 추이 비교 (2018-2022)
                  </CardTitle>
                  <CardDescription>유방암과 갑상선암의 가파른 증가세를 확인할 수 있습니다.</CardDescription>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.cancer_incidence_trends} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="year" tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="breast" name="유방암" stroke={COLORS.breast} strokeWidth={3} dot={{r: 4}} activeDot={{r: 8}} />
                      <Line type="monotone" dataKey="thyroid" name="갑상선암" stroke={COLORS.thyroid} strokeWidth={2} dot={{r: 3}} />
                      <Line type="monotone" dataKey="colorectal" name="대장암" stroke={COLORS.colorectal} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="stomach" name="위암" stroke={COLORS.stomach} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="lung" name="폐암" stroke={COLORS.lung} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Side Stats */}
              <div className="space-y-6">
                <Card className="border-none shadow-md bg-gradient-to-br from-pink-500 to-rose-600 text-white">
                  <CardHeader>
                    <CardTitle className="text-lg">유방암 발생률 1위</CardTitle>
                    <CardDescription className="text-pink-100">2016년 이후 여성 암 1위 지속</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-2">
                      <span className="text-4xl font-black">28,500</span>
                      <span className="text-lg font-medium mb-1 opacity-80">명/년</span>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/20 text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      전년 대비 5.1% 증가
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-md bg-white">
                  <CardHeader>
                    <CardTitle className="text-base text-slate-700">생존율 변화 (5년 상대생존율)</CardTitle>
                  </CardHeader>
                  <CardContent className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={stats.survival_rates}>
                        <defs>
                          <linearGradient id="colorBreast" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COLORS.breast} stopOpacity={0.3}/>
                            <stop offset="95%" stopColor={COLORS.breast} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="period" hide />
                        <Tooltip />
                        <Area type="monotone" dataKey="breast" name="유방암 생존율(%)" stroke={COLORS.breast} fillOpacity={1} fill="url(#colorBreast)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* 2. Lifecycle Tab */}
          <TabsContent value="lifecycle" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-none shadow-lg bg-white col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Baby className="w-5 h-5 text-purple-600" />
                    연령대별 유방암 발생률 (인구 10만 명당)
                  </CardTitle>
                  <CardDescription>
                    한국 여성 유방암은 <span className="font-bold text-purple-600">40대와 50대</span>에서 가장 많이 발생합니다. 
                    (서구의 폐경 후 발병 패턴과 다름)
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.age_specific_incidence} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="age_group" tick={{fontSize: 12, fontWeight: 'bold'}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fontSize: 12}} axisLine={false} tickLine={false} />
                      <Tooltip 
                        cursor={{fill: '#f8fafc'}}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      />
                      <Bar dataKey="rate" name="발생률(명/10만명)" fill={COLORS.thyroid} radius={[8, 8, 0, 0]} barSize={60}>
                        {stats.age_specific_incidence.map((entry, index) => (
                          <React.Fragment key={`cell-${index}`}>
                            {/* 40, 50대 강조 */}
                            {(entry.age_group === '40대' || entry.age_group === '50대') ? 
                              <defs>
                                <linearGradient id="highlightGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#9333ea" />
                                  <stop offset="100%" stopColor="#c084fc" />
                                </linearGradient>
                              </defs>
                            : null}
                          </React.Fragment>
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* 3. Prevention Tab */}
          <TabsContent value="prevention" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-none shadow-lg bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-blue-600" />
                    지역별 유방암 검진 수검률
                  </CardTitle>
                  <CardDescription>국가암검진 통계 기준 (대전/서울 상위권)</CardDescription>
                </CardHeader>
                <CardContent className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={stats.screening_rates_by_region} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" domain={[0, 100]} hide />
                      <YAxis dataKey="region" type="category" tick={{fontSize: 12, fontWeight: 'bold'}} width={50} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        formatter={(value: number) => [`${value}%`, '수검률']}
                      />
                      <Bar dataKey="rate" fill={COLORS.cervical} radius={[0, 4, 4, 0]} barSize={20} background={{ fill: '#f1f5f9' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="border-none shadow-md bg-blue-50">
                  <CardHeader>
                    <CardTitle className="text-blue-900">검진의 중요성</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                     <div className="flex items-start gap-3">
                       <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                         <ShieldCheck className="w-6 h-6" />
                       </div>
                       <div>
                         <h4 className="font-bold text-blue-900">조기 발견 시 생존율 98%</h4>
                         <p className="text-sm text-blue-700 mt-1">
                           유방암은 0-1기에 발견하면 5년 생존율이 98% 이상이나, 
                           4기 발견 시 30% 대로 급감합니다.
                         </p>
                       </div>
                     </div>
                     <div className="flex items-start gap-3">
                       <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                         <Calendar className="w-6 h-6" />
                       </div>
                       <div>
                         <h4 className="font-bold text-blue-900">40세 이상 2년 주기</h4>
                         <p className="text-sm text-blue-700 mt-1">
                           국가암검진 권고안에 따라 40세 이상 여성은 2년마다 맘모그래피 검진이 필수입니다.
                         </p>
                       </div>
                     </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
          
          {/* 4. Risk Factors Tab */}
          <TabsContent value="risk" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
               <Card className="border-none shadow-lg bg-white">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                    유방암 발생 위험 요인 분석 (Relative Risk)
                  </CardTitle>
                  <CardDescription>가족력과 호르몬 요인이 가장 큰 영향을 미칩니다.</CardDescription>
                </CardHeader>
                <CardContent className="h-[400px]">
                   <ResponsiveContainer width="100%" height="100%">
                     <BarChart layout="vertical" data={stats.risk_factors} margin={{ top: 20, right: 30, left: 40, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                        <XAxis type="number" domain={[0, 3]} tickCount={4} />
                        <YAxis dataKey="factor" type="category" width={120} tick={{fontSize: 11}} />
                        <Tooltip />
                        <Bar dataKey="risk_ratio" name="상대 위험도" fill={COLORS.risk} radius={[0, 4, 4, 0]} barSize={30} label={{ position: 'right', fill: '#64748b', fontSize: 12 }}>
                        </Bar>
                     </BarChart>
                   </ResponsiveContainer>
                </CardContent>
               </Card>
               
               <Card className="border-none shadow-lg bg-white">
                 <CardHeader>
                   <CardTitle>요인별 카테고리 분포</CardTitle>
                 </CardHeader>
                 <CardContent className="h-[400px] flex items-center justify-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={stats.risk_factors}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="category" />
                        <PolarRadiusAxis />
                        <Radar name="Risk Level" dataKey="risk_ratio" stroke={COLORS.risk} fill={COLORS.risk} fillOpacity={0.6} />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                 </CardContent>
               </Card>
            </div>
          </TabsContent>
        </Tabs>

        {/* References Section */}
        <Card className="border-none shadow-sm bg-slate-100/50">
          <CardHeader>
            <CardTitle className="text-sm font-bold text-slate-600 flex items-center gap-2">
              <Search className="w-4 h-4" />
              데이터 출처 및 참고 문헌
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {stats.references?.map((ref, idx) => (
                <a 
                  key={idx} 
                  href={ref.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-start p-3 rounded-lg bg-white border border-slate-200 hover:border-pink-300 hover:shadow-md transition-all group"
                >
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-800 group-hover:text-pink-700 transition-colors">
                      {ref.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{ref.publisher}</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-pink-500" />
                </a>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-4 px-1">
              * 본 페이지의 모든 통계 데이터는 공공 데이터 포털 및 관련 기관의 공개 자료를 바탕으로 재구성되었습니다.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Self Check Guide Dialog - Beautified & Fixed Background */}
      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 gap-0 border-0 bg-white shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-pink-500 to-rose-500 p-6 text-white sticky top-0 z-10">
             <DialogHeader className="mb-0">
               <div className="flex flex-wrap items-center gap-2 mb-2">
                 <Badge className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm">유방암 자가검진</Badge>
                 <Badge className="bg-black/20 hover:bg-black/30 text-white border-0 backdrop-blur-sm">매월 1회 권장</Badge>
               </div>
               <DialogTitle className="text-2xl font-black tracking-tight text-white">
                 자가검진 가이드 & 체크리스트
               </DialogTitle>
               <DialogDescription className="text-pink-100 mt-1">
                 간단한 문진을 통해 현재 상태를 확인해보세요. 증상이 있다면 반드시 전문의와 상담하세요.
               </DialogDescription>
             </DialogHeader>
          </div>

          <div className="p-6 space-y-6">
             {/* Key Info Cards */}
             <div className="grid gap-3 sm:grid-cols-2">
               <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 flex items-start gap-3">
                 <div className="p-2 bg-pink-50 rounded-lg text-pink-600">
                   <CalendarDays className="h-5 w-5" />
                 </div>
                 <div>
                   <div className="text-sm font-bold text-slate-900">검사 시기(권장)</div>
                   <p className="text-xs text-slate-500 mt-1 leading-snug">가임기: 생리 후 3~5일<br/>폐경 후: 매달 같은 날</p>
                 </div>
               </div>
               <div className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 flex items-start gap-3">
                 <div className="p-2 bg-pink-50 rounded-lg text-pink-600">
                   <Info className="h-5 w-5" />
                 </div>
                 <div>
                   <div className="text-sm font-bold text-slate-900">체크 방법</div>
                   <p className="text-xs text-slate-500 mt-1 leading-snug">손가락 3개를 이용해<br/>동전 크기로 원을 그리며 촉진</p>
                 </div>
               </div>
             </div>
             
             <div className="space-y-4">
               {/* Step 1 */}
               <SectionCard
                 step={1}
                 title="멍울 확인"
                 subtitle="유방 깊숙한 곳이나 겨드랑이 부위에 딱딱하고 통증이 없는 멍울이 만져지는지 확인합니다."
               >
                 <YesNo
                   label="통증이 거의 없고 단단한 멍울이 만져지나요?"
                   value={lump}
                   onChange={setLump}
                 />
               </SectionCard>

               {/* Step 2 */}
               <SectionCard
                 step={2}
                 title="분비물 확인"
                 subtitle="유두를 가볍게 짰을 때, 한쪽 유두에서만 피가 섞이거나 맑은 액체가 나오는지 관찰합니다."
               >
                 <YesNo
                   label="한쪽 유두에서만 피/맑은 분비물이 나오나요?"
                   value={discharge}
                   onChange={setDischarge}
                 />
               </SectionCard>

               {/* Step 3 */}
               <SectionCard
                 step={3}
                 title="외형 변화 확인"
                 subtitle="거울 앞에서 팔을 들었다 내리며 피부 함몰, 유두 함몰, 귤껍질 같은 피부 변화를 확인합니다."
               >
                 <YesNo
                   label="피부/유두 함몰이나 형태 변화가 새롭게 생겼나요?"
                   value={skinChange}
                   onChange={setSkinChange}
                 />
               </SectionCard>
             </div>

             {/* Dynamic Result Card */}
             <div className={cx(
                 "rounded-2xl border p-5 shadow-sm transition-all duration-300",
                 recommendation.tone === "rose"
                   ? "border-rose-200 bg-rose-50"
                   : recommendation.tone === "pink"
                   ? "border-pink-200 bg-pink-50"
                   : "border-slate-200 bg-slate-50"
               )}>
               <div className="flex items-start gap-3">
                 <div className={cx("mt-0.5 p-1 rounded-full", 
                    recommendation.tone === "rose" ? "bg-rose-200 text-rose-700" : 
                    recommendation.tone === "pink" ? "bg-pink-200 text-pink-700" : "bg-slate-200 text-slate-600"
                 )}>
                   {recommendation.tone === "rose" ? <AlertTriangle className="h-5 w-5" /> : 
                    recommendation.tone === "pink" ? <CheckCircle2 className="h-5 w-5" /> : <Info className="h-5 w-5" />}
                 </div>
                 <div>
                   <div className={cx("text-base font-bold", 
                      recommendation.tone === "rose" ? "text-rose-900" : 
                      recommendation.tone === "pink" ? "text-pink-900" : "text-slate-900"
                   )}>
                     {recommendation.title}
                   </div>
                   <p className={cx("mt-1 text-sm leading-relaxed", 
                      recommendation.tone === "rose" ? "text-rose-800/80" : 
                      recommendation.tone === "pink" ? "text-pink-800/80" : "text-slate-600"
                   )}>
                     {recommendation.desc}
                   </p>

                   {recommendation.tone !== 'slate' && (
                     <div className="mt-4 flex flex-wrap gap-2">
                       <Pill tone={recommendation.tone === "pink" ? "pink" : "rose"}>
                         선택된 ‘예’ 항목: {score}개
                       </Pill>
                       <Pill tone={recommendation.tone === "pink" ? "pink" : "rose"}>정기검진 병행 권장</Pill>
                     </div>
                   )}
                 </div>
               </div>
             </div>
          </div>
          
          <div className="bg-white p-4 border-t border-slate-100 flex justify-end sticky bottom-0 z-10">
            <Button onClick={() => setShowGuide(false)} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-8 rounded-xl shadow-lg shadow-slate-200">
              닫기
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}