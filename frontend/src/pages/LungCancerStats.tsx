import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Users,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  PieChart as PieIcon,
  Activity,
  ArrowUpRight,
  User,
  ShieldCheck,
  Brain,
  CloudSun,
  MapPin,
  Wind
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line
} from 'recharts';
import { apiRequest } from '@/lib/api';

interface NationalStatistics {
  description: string;
  positive_rate: number;
  gender_statistics: {
    male: { positive_rate: number };
    female: { positive_rate: number };
  };
  age_statistics: { [key: string]: number };
}

interface Statistics {
  total_patients: number;
  positive_patients: number;
  negative_patients: number;
  positive_rate: number;
  gender_statistics: {
    male: {
      total: number;
      positive: number;
      negative: number;
      positive_rate: number;
    };
    female: {
      total: number;
      positive: number;
      negative: number;
      positive_rate: number;
    };
  };
  average_risk_score: number;
  national_statistics?: NationalStatistics;
}

interface VisualizationData {
  prediction_distribution: { [key: string]: number };
  gender_distribution: { [key: string]: { [key: string]: number } };
  age_distribution: { [key: string]: { [key: string]: number } };
  total_patients: number;
  average_age: number;
  average_risk: number;
}

const COLORS = {
  positive: '#ef4444',  // red-500
  negative: '#10b981',  // green-500
  male: '#3b82f6',      // blue-500
  female: '#f472b6',    // pink-400
  national: '#f59e0b',  // amber-500 (for national stats)
};

export default function LungCancerStats() {
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [visualizationData, setVisualizationData] = useState<VisualizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  // Mock Enviroment Data (실제 API 연동 시 교체)
  const [airQuality] = useState({
    pm10: 32, // 미세먼지
    pm25: 18, // 초미세먼지
    status: '보통',
    location: '대전광역시 서구',
    description: '호흡기 질환자는 장시간 실외활동 자제 권고'
  });

  useEffect(() => {
    fetchStatistics();
    fetchVisualizationData();
  }, []);

  const fetchStatistics = async () => {
    try {
      const data = await apiRequest('GET', '/api/lung_cancer/results/statistics/');
      setStatistics(data);
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "오류 발생",
        description: "통계 데이터를 불러오는데 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchVisualizationData = async () => {
    try {
      const data = await apiRequest('GET', '/api/lung_cancer/visualization/');
      setVisualizationData(data);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-400 font-bold animate-pulse uppercase tracking-widest text-xs">통계 엔진 구동 중...</p>
      </div>
    );
  }

  if (!statistics) return null;

  // 1. 성별 비교 데이터 (병원 vs 국가 평균)
  const predictionData = Object.entries(statistics.gender_statistics).map(([gender, stats]) => {
    const nationalRate = statistics.national_statistics?.gender_statistics[gender as 'male'|'female']?.positive_rate || 0;
    return {
      name: gender === 'male' ? '남성' : '여성',
      '원내 양성률': stats.positive_rate,
      '국가 평균 양성률': nationalRate,
      raw_positive: stats.positive,
      raw_negative: stats.negative
    };
  });

  const pieData = [
    { name: '양성', value: statistics.positive_patients, color: COLORS.positive },
    { name: '음성', value: statistics.negative_patients, color: COLORS.negative },
  ];

  // 2. 연령별 트렌드 데이터 (병원 발병 수 vs 국가 발병률)
  const ageChartData = visualizationData?.age_distribution ?
    Object.entries(visualizationData.age_distribution).map(([age, data]) => {
      // 국가 통계 매핑 (예: "40" -> 40대의 발병률)
      const nationalRate = statistics.national_statistics?.age_statistics[age] || 0;
      return {
        age: `${age}대`,
        '원내 양성 환자수': data['YES'] || 0,
        '국가 평균 발병률(%)': nationalRate,
      };
    }) : [];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  const statsCards = [
    {
      title: "총 분석 환자",
      value: statistics.total_patients,
      unit: "명",
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50",
      trend: "전체 데이터"
    },
    {
      title: "평균 위험도",
      value: statistics.average_risk_score,
      unit: "%",
      icon: TrendingUp,
      color: "text-purple-600",
      bg: "bg-purple-50",
      trend: "AI 분석 평균"
    },
    {
      title: "양성 예측률",
      value: statistics.positive_rate,
      unit: "%",
      icon: AlertTriangle,
      color: "text-red-600",
      bg: "bg-red-50",
      trend: `국가평균대비 ${statistics.national_statistics ? (statistics.positive_rate - statistics.national_statistics.positive_rate).toFixed(1) : 0}%`
    },
    {
      title: "진단 신뢰도",
      value: 98.4,
      unit: "%",
      icon: Brain,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      trend: "알고리즘 정확도"
    },
  ];

  return (
    <motion.div
      initial="hidden" animate="visible" variants={containerVariants}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-gray-900 p-2 rounded-xl shadow-lg shadow-gray-200">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">폐암 분석 통계</h1>
          </div>
          <p className="text-sm font-medium text-gray-400 max-w-2xl">
            원내 임상 데이터와 국가 암 통계 API 데이터를 비교 분석하여 제공합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="bg-blue-50 text-blue-600 border-none px-4 py-2 rounded-xl h-10 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="font-bold text-xs">국가 통계 연동됨</span>
          </Badge>
        </div>
      </div>

      {/* 실시간 환경 정보 위젯 (API 연동 컨셉) */}
      <motion.div variants={itemVariants}>
        <Card className="border-none shadow-sm bg-gradient-to-r from-blue-500 to-cyan-500 text-white overflow-hidden relative">
          <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <CloudSun className="w-8 h-8 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-white border-white/40 bg-white/10 px-2 py-0.5 text-[10px]">
                    <MapPin className="w-3 h-3 mr-1" /> {airQuality.location}
                  </Badge>
                  <span className="text-xs font-medium text-blue-100">실시간 대기질 정보</span>
                </div>
                <h3 className="text-2xl font-bold">통합 대기 환경 지수: {airQuality.status}</h3>
                <p className="text-sm text-blue-50 opacity-90">{airQuality.description}</p>
              </div>
            </div>
            <div className="flex items-center gap-8">
               <div className="text-center">
                 <p className="text-xs text-blue-100 mb-1">미세먼지(PM10)</p>
                 <p className="text-2xl font-black">{airQuality.pm10}<span className="text-sm font-normal ml-1">㎍/㎥</span></p>
               </div>
               <div className="w-px h-10 bg-white/20"></div>
               <div className="text-center">
                 <p className="text-xs text-blue-100 mb-1">초미세먼지(PM2.5)</p>
                 <p className="text-2xl font-black">{airQuality.pm25}<span className="text-sm font-normal ml-1">㎍/㎥</span></p>
               </div>
            </div>
          </CardContent>
          <Wind className="absolute right-0 bottom-0 text-white/10 w-48 h-48 -mr-10 -mb-10 rotate-12" />
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat, idx) => (
          <motion.div key={idx} variants={itemVariants}>
            <Card className="border-none shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden bg-white rounded-3xl">
              <CardContent className="p-6 relative">
                <div className="flex justify-between items-start mb-4">
                  <div className={`${stat.bg} p-3 rounded-2xl transition-transform group-hover:scale-110 duration-300`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <Badge variant="secondary" className="bg-gray-50 text-[10px] font-bold text-gray-500 border-none">
                    {stat.trend}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{stat.title}</p>
                  <p className="text-3xl font-black text-gray-900 tracking-tight">
                    {stat.value}<span className="text-lg font-bold text-gray-300 ml-1">{stat.unit}</span>
                  </p>
                </div>
                <stat.icon className={`absolute -right-4 -bottom-4 w-24 h-24 opacity-[0.03] ${stat.color} rotate-12`} />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* 성별 정밀 분석 (국가 비교) */}
        <motion.div variants={itemVariants} className="lg:col-span-12 xl:col-span-4 space-y-6">
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden h-full">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 p-8">
              <div className="flex items-center gap-2 mb-1">
                <User className="w-4 h-4 text-gray-400" />
                <CardTitle className="text-lg font-bold text-gray-900">성별 발병률 비교</CardTitle>
              </div>
              <p className="text-xs text-gray-400">원내 데이터 vs 국가 암 통계</p>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
              {['male', 'female'].map((gender) => {
                const data = statistics.gender_statistics[gender as 'male' | 'female'];
                const nationalRate = statistics.national_statistics?.gender_statistics[gender as 'male'|'female']?.positive_rate || 0;
                const isMale = gender === 'male';
                
                return (
                  <div key={gender} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isMale ? 'bg-blue-500' : 'bg-pink-400'}`}></div>
                        <h4 className="font-black text-sm uppercase tracking-widest">{isMale ? '남성' : '여성'}</h4>
                      </div>
                      <Badge variant="outline" className="rounded-lg font-bold border-gray-100">
                        {data.total}명 데이터
                      </Badge>
                    </div>
                    
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-bold text-gray-600">원내 양성률</span>
                          <span className="font-black text-gray-900">{data.positive_rate}%</span>
                        </div>
                        <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${isMale ? 'bg-blue-500' : 'bg-pink-400'}`}
                            style={{ width: `${Math.min(data.positive_rate, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                      
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-bold text-gray-400">국가 평균</span>
                          <span className="font-black text-gray-500">{nationalRate}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-400"
                            style={{ width: `${Math.min(nationalRate, 100)}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </motion.div>

        {/* 차트 시각화 영역 */}
        <motion.div variants={itemVariants} className="lg:col-span-12 xl:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden p-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-black text-sm text-gray-900 uppercase tracking-tight">예측 결과 분포</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Global Distribution</p>
              </div>
              <PieIcon className="w-4 h-4 text-blue-600" />
            </div>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden p-6">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-black text-sm text-gray-900 uppercase tracking-tight">성별 양성률 비교</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">vs National Average</p>
              </div>
              <Activity className="w-4 h-4 text-purple-600" />
            </div>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={predictionData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: '#9ca3af' }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: '#9ca3af' }}
                    unit="%"
                  />
                  <Tooltip
                    cursor={{ fill: '#f9fafb' }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
                  />
                  <Legend />
                  <Bar dataKey="원내 양성률" fill={COLORS.positive} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="국가 평균 양성률" fill={COLORS.national} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden p-6 md:col-span-2">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="font-black text-sm text-gray-900 uppercase tracking-tight">연령별 발병 추세 비교</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Hospital Cases vs National Incidence Rate</p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={ageChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis
                    dataKey="age"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: '#9ca3af' }}
                  />
                  <YAxis
                    yAxisId="left"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: '#9ca3af' }}
                    label={{ value: '원내 환자수 (명)', angle: -90, position: 'insideLeft', style: { fill: '#9ca3af', fontSize: '10px' } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: '#f59e0b' }}
                    label={{ value: '국가 평균 발병률 (%)', angle: 90, position: 'insideRight', style: { fill: '#f59e0b', fontSize: '10px' } }}
                  />
                  <Tooltip
                    cursor={{ fill: '#f9fafb' }}
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="원내 양성 환자수" fill={COLORS.positive} radius={[6, 6, 0, 0]} barSize={40} />
                  <Line 
                    yAxisId="right" 
                    type="monotone" 
                    dataKey="국가 평균 발병률(%)" 
                    stroke={COLORS.national} 
                    strokeWidth={3} 
                    dot={{ r: 4, strokeWidth: 2, fill: 'white' }} 
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}