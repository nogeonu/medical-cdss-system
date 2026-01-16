import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  AreaChart, Area, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ComposedChart
} from 'recharts';
import { 
  Activity, Users, TrendingUp, Calendar, Info, Heart, ShieldCheck, 
  AlertTriangle, Baby, MapPin, Search, ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { apiRequest } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

// --- Interfaces for API Data ---
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

interface WomenHealthStats {
  cancer_incidence_trends: CancerTrend[];
  age_specific_incidence: AgeSpecificIncidence[];
  screening_rates_by_region: ScreeningRate[];
  survival_rates: SurvivalRate[];
  risk_factors: RiskFactor[];
  references: Reference[];
}

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

export default function WomenHealthStats() {
  const [stats, setStats] = useState<WomenHealthStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetchStatistics();
  }, []);

  const fetchStatistics = async () => {
    try {
      const data = await apiRequest('GET', '/api/mri/mammography/statistics/');
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch statistics:', error);
      toast({
        title: "데이터 로드 실패",
        description: "통계 데이터를 불러오는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-pink-200 border-t-pink-600 rounded-full animate-spin"></div>
          <p className="text-slate-500 font-medium animate-pulse">국가 암 통계 데이터 동기화 중...</p>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-slate-50/50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container mx-auto max-w-7xl flex items-center justify-between py-4 px-6 md:px-8">
          <a href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-pink-600 text-white flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg text-slate-900">CDSS Health</span>
          </a>
          <a href="/">
            <button className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              <MapPin className="w-4 h-4 rotate-180" /> {/* Using MapPin as Home icon alternative if Home not imported, or replace with Home icon */}
              홈으로 돌아가기
            </button>
          </a>
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
          <div className="hidden md:block text-right">
             <div className="text-sm font-bold text-slate-700">Data Updated</div>
             <div className="text-xs text-slate-400">2026.01.16</div>
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
    </div>
  );
}
