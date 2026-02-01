import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Scan, 
  Brain,
  Loader2,
  Search,
  User,
  Calendar,
  CheckCircle2,
  ZoomIn,
  XCircle
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getOrdersApi, getOrderApi } from '@/lib/api';
import PathologyHighResViewer from '@/components/PathologyHighResViewer';

interface PathologyAnalysis {
  id: string;
  class_id: number;
  class_name: string;
  confidence: number;
  probabilities: Record<string, number>;
  filename: string;
  image_url?: string;
  dzi_url?: string;  // 고해상도 뷰어용 DZI URL
  viewer_url?: string;  // 대체 뷰어 URL
  findings?: string;
  recommendations?: string;
  created_at: string;
}

interface Order {
  id: string;
  patient_name: string;
  patient_id: string;
  patient_number?: string;
  order_type: 'prescription' | 'lab_test' | 'imaging' | 'tissue_exam';
  order_data?: {
    imaging_type?: string;
    body_part?: string;
  };
  status: string;
  created_at: string;
  pathology_analysis?: PathologyAnalysis;
}

// 다른 페이지 갔다 와도 로딩 유지: sessionStorage 키
const PATHOLOGY_PENDING_KEY = 'pathology_pending_request';

// 교육원 워커 wsi/ 폴더에 있는 사용 가능한 파일 목록
const AVAILABLE_WSI_FILES = [
  { value: 'tumor_083.tif', label: 'tumor_083.tif (종양)' },
  { value: 'normal_059.tif', label: 'normal_059.tif (정상)' },
  { value: 'normal_103.tif', label: 'normal_103.tif (정상)' },
] as const;

export default function PathologyAnalysis() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string>('tumor_083.tif'); // 기본값
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null); // 진행 중인 요청 ID
  const [analysisResult, setAnalysisResult] = useState<any>(null); // 분석 결과
  const [showHighResViewer, setShowHighResViewer] = useState(false); // 고해상도 뷰어 모달
  const restoredPendingRef = useRef(false); // 다른 페이지 갔다 와서 복원했는지 (중복 복원 방지)
  const pollingCleanupRef = useRef<(() => void) | null>(null); // 폴링 취소 함수 (다른 페이지 갈 때 정리)

  useEffect(() => {
    loadOrders();
  }, []);

  // 다른 페이지 갔다 와도 로딩 유지: sessionStorage에 저장된 진행 중 요청 복원 후 폴링 재개
  useEffect(() => {
    if (orders.length === 0 || restoredPendingRef.current) return;
    const raw = sessionStorage.getItem(PATHOLOGY_PENDING_KEY);
    if (!raw) return;
    try {
      const { requestId, orderId, filename } = JSON.parse(raw) as { requestId: string; orderId: string; filename: string };
      let order = orders.find((o) => o.id === orderId);
      if (!order) {
        getOrderApi(orderId)
          .then((ord) => {
            restoredPendingRef.current = true;
            setSelectedOrder(ord);
            setSelectedFilename(filename || 'tumor_083.tif');
            setPendingRequestId(requestId);
            setAnalysisResult(null);
            pollingCleanupRef.current = startPollingResult(requestId, ord, filename || 'tumor_083.tif');
          })
          .catch(() => sessionStorage.removeItem(PATHOLOGY_PENDING_KEY));
        return;
      }
      restoredPendingRef.current = true;
      setSelectedOrder(order);
      setSelectedFilename(filename || 'tumor_083.tif');
      setPendingRequestId(requestId);
      setAnalysisResult(null);
      pollingCleanupRef.current = startPollingResult(requestId, order, filename || 'tumor_083.tif');
    } catch {
      sessionStorage.removeItem(PATHOLOGY_PENDING_KEY);
    }
  }, [orders]);

  // 주문 선택 시 저장된 분석 결과 불러오기
  useEffect(() => {
    const loadSavedAnalysisResult = async () => {
      if (!selectedOrder) {
        setAnalysisResult(null);
        return;
      }

      try {
        // 주문 상세 정보 불러오기 (pathology_analysis 포함)
        const orderDetail = await getOrderApi(selectedOrder.id);
        
        if (orderDetail.pathology_analysis) {
          // 저장된 분석 결과가 있으면 표시 (dzi_url, viewer_url 포함 → 고해상도 뷰어 버튼 유지)
          const savedResult = orderDetail.pathology_analysis;
          setAnalysisResult({
            class_id: savedResult.class_id,
            class_name: savedResult.class_name,
            confidence: savedResult.confidence,
            probabilities: savedResult.probabilities,
            image_url: savedResult.image_url,
            dzi_url: savedResult.dzi_url,
            viewer_url: savedResult.viewer_url,
            num_patches: 1, // 저장된 결과에는 패치 수 정보가 없을 수 있음
          });
          console.log('✅ 저장된 분석 결과 불러오기 완료:', savedResult);
        } else {
          // 저장된 결과가 없으면 초기화
          setAnalysisResult(null);
        }
      } catch (error) {
        console.error('저장된 분석 결과 불러오기 실패:', error);
        setAnalysisResult(null);
      }
    };

    loadSavedAnalysisResult();
  }, [selectedOrder]);

  // 결과 폴링 함수
  const startPollingResult = (requestId: string, order: Order, filename: string) => {
    const maxAttempts = 1500; // 50분 = 3000초 / 2초 간격
    let attempts = 0;
    let timeoutId: NodeJS.Timeout | null = null;
    let isCancelled = false;
    
    const poll = async () => {
      if (isCancelled || attempts >= maxAttempts) {
        if (attempts >= maxAttempts && !isCancelled) {
          sessionStorage.removeItem(PATHOLOGY_PENDING_KEY);
          pollingCleanupRef.current = null;
          toast({
            title: "분석 시간 초과",
            description: "분석이 50분을 초과했습니다. 나중에 다시 확인해주세요.",
            variant: "destructive",
          });
          setPendingRequestId(null);
        }
        return;
      }
      
      try {
        const response = await fetch(`/api/pathology/result/${requestId}/`, {
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error('결과 조회 실패');
        }
        
        const data = await response.json() as {
          status: string;
          result?: {
            class_id: number;
            class_name: string;
            confidence: number;
            probabilities: Record<string, number>;
            image_url?: string;
            dzi_url?: string;
            viewer_url?: string;
          };
          error?: string;
        };
        
        if (data.status === 'completed' && data.result) {
          sessionStorage.removeItem(PATHOLOGY_PENDING_KEY);
          pollingCleanupRef.current = null;
          setAnalysisResult(data.result);
          setPendingRequestId(null);
          
          // 분석 결과를 OCS Order에 저장
          if (order) {
            try {
              console.log('💾 분석 결과 저장 시작:', {
                order_id: order.id,
                class_name: data.result.class_name,
                confidence: data.result.confidence
              });
              
              const saveResponse = await fetch('/api/mri/pathology/save-result/', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                  order_id: order.id,
                  class_id: data.result.class_id,
                  class_name: data.result.class_name,
                  confidence: data.result.confidence,
                  probabilities: data.result.probabilities,
                  filename: filename,
                  image_url: data.result.image_url || '',
                  dzi_url: data.result.dzi_url || '',  // 고해상도 뷰어용 DZI URL 저장
                  viewer_url: data.result.viewer_url || '',  // 대체 뷰어 URL 저장
                  findings: data.result.class_name === 'Tumor' ? '종양 조직이 관찰되었습니다.' : '정상 조직입니다.',
                  recommendations: data.result.class_name === 'Tumor' ? '추가 검사 및 치료 계획 수립이 필요합니다.' : '정기 검진을 권장합니다.',
                }),
              });
              
              if (!saveResponse.ok) {
                const errorData = await saveResponse.json() as { error?: string };
                throw new Error(errorData.error || '저장 실패');
              }
              
              const saveData = await saveResponse.json() as { success?: boolean; message?: string };
              console.log('✅ 분석 결과 저장 완료:', saveData);
              
              toast({
                title: "분석 완료 및 저장 완료!",
                description: `결과: ${data.result.class_name} (신뢰도: ${(data.result.confidence * 100).toFixed(2)}%) - OCS에 저장되었습니다.`,
              });
            } catch (saveError: any) {
              console.error('❌ 분석 결과 저장 실패:', saveError);
              toast({
                title: "분석 완료 (저장 실패)",
                description: `결과는 나왔지만 저장에 실패했습니다: ${saveError.message || '알 수 없는 오류'}. OCS에서 수동으로 확인해주세요.`,
                variant: "destructive",
              });
            }
          } else {
            console.warn('⚠️ selectedOrder가 없어서 결과를 저장할 수 없습니다.');
            toast({
              title: "분석 완료 (저장 불가)",
              description: "주문 정보가 없어 결과를 저장할 수 없습니다.",
              variant: "destructive",
            });
          }
          
          // 주문 목록 새로고침
          loadOrders();
        } else if (data.status === 'failed') {
          sessionStorage.removeItem(PATHOLOGY_PENDING_KEY);
          pollingCleanupRef.current = null;
          setPendingRequestId(null);
          toast({
            title: "분석 실패",
            description: data.error || "분석 중 오류가 발생했습니다.",
            variant: "destructive",
          });
        } else {
          // pending 또는 processing 상태면 계속 폴링
          attempts++;
          if (!isCancelled) {
            timeoutId = setTimeout(poll, 2000); // 2초마다 확인
          }
        }
      } catch (error: any) {
        console.error('결과 조회 오류:', error);
        attempts++;
        if (attempts < maxAttempts && !isCancelled) {
          timeoutId = setTimeout(poll, 2000);
        }
      }
    };
    
    // 첫 폴링 시작
    timeoutId = setTimeout(poll, 2000);
    
    // 정리 함수 반환
    return () => {
      isCancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  };
  
  // 다른 페이지로 나갈 때 폴링만 중지 (sessionStorage는 유지 → 돌아오면 복원)
  useEffect(() => {
    return () => {
      if (pollingCleanupRef.current) {
        pollingCleanupRef.current();
        pollingCleanupRef.current = null;
      }
    };
  }, []);

  // 워커 취소/중단 시 사용자가 "대기 취소"할 수 있도록
  const handleCancelWaiting = () => {
    if (pollingCleanupRef.current) {
      pollingCleanupRef.current();
      pollingCleanupRef.current = null;
    }
    sessionStorage.removeItem(PATHOLOGY_PENDING_KEY);
    restoredPendingRef.current = false;
    setPendingRequestId(null);
    toast({
      title: "대기 취소",
      description: "분석 대기를 취소했습니다. 워커가 중단된 경우 다시 분석을 시작해 주세요.",
    });
  };

  useEffect(() => {
    if (searchTerm.trim()) {
      const filtered = orders.filter(order => 
        order.patient_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.patient_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.patient_number?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredOrders(filtered);
    } else {
      setFilteredOrders(orders);
    }
  }, [searchTerm, orders]);

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      // 조직검사 주문 중 처리 중(processing) 상태인 것만 가져오기
      // 검사실에서 처리 시작을 누른 주문만 표시
      const data = await getOrdersApi({
        order_type: 'tissue_exam',
        target_department: 'lab',
        status: 'processing',  // 처리 중 상태만
      }) as { results?: Order[] } | Order[];
      
      // 결과를 배열로 변환 (data.results 또는 data 자체가 배열)
      const orders = (Array.isArray(data) ? data : (data.results || [])) as Order[];
      
      setOrders(orders);
      setFilteredOrders(orders);
    } catch (error: any) {
      console.error('주문 로드 실패:', error);
      toast({
        title: "주문 로드 실패",
        description: error.response?.data?.error || "주문 목록을 불러올 수 없습니다.",
        variant: "destructive",
      });
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedOrder) {
      toast({
        title: "주문 선택 필요",
        description: "분석할 주문을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    setAnalyzing(true);
    try {
      // OCS 주문에서 환자 정보 가져오기
      const patientId = selectedOrder.patient_id || selectedOrder.patient_number;
      
      if (!patientId) {
        throw new Error('환자 ID를 찾을 수 없습니다.');
      }

      // 사용자가 선택한 파일명 사용 (교육원 워커 wsi/ 폴더에 있는 파일)
      const filename = selectedFilename;
      
      if (!filename) {
        throw new Error('분석할 파일을 선택해주세요.');
      }
      
      // instance_id는 참고용으로만 사용 (실제 파일은 교육원 워커가 wsi/ 폴더에서 찾음)
      const instanceId = `pathology_${selectedOrder.id}`;
      
      toast({
        title: "병리 이미지 분석 시작",
        description: "교육원 워커로 분석 요청을 전송했습니다. (약 2-5분 소요)",
      });

      // 교육원 워커로 API 신호 전송
      // 백엔드는 즉시 응답 반환 (202 Accepted) - 타임아웃 불필요
      const response = await fetch('/api/pathology/analyze/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 쿠키 포함 (인증 정보)
        body: JSON.stringify({
          instance_id: instanceId || `pathology_${selectedOrder.id}`, // 참고용
          filename: filename // 교육원 워커가 wsi/ 폴더에서 찾을 파일명
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `서버 오류 (${response.status})`);
      }

      // request_id 저장하고 폴링 시작 (다른 페이지 갔다 와도 로딩 유지용 sessionStorage 저장)
      if (data.request_id) {
        sessionStorage.setItem(
          PATHOLOGY_PENDING_KEY,
          JSON.stringify({
            requestId: data.request_id,
            orderId: selectedOrder.id,
            filename: selectedFilename,
          })
        );
        setPendingRequestId(data.request_id);
        setAnalysisResult(null);
        
        toast({
          title: "분석 요청 완료",
          description: "교육원 워커에서 분석을 진행 중입니다. 결과를 확인하는 중...",
        });
        
        // 결과 폴링 시작 (selectedOrder와 selectedFilename을 파라미터로 전달)
        if (!selectedOrder) {
          toast({
            title: "오류",
            description: "주문 정보가 없습니다. 페이지를 새로고침해주세요.",
            variant: "destructive",
          });
          return;
        }
        pollingCleanupRef.current = startPollingResult(data.request_id, selectedOrder, selectedFilename);
      } else {
        toast({
          title: "분석 요청 완료",
          description: "교육원 워커에서 분석을 진행 중입니다.",
        });
      }

      // 주문 목록 새로고침
      loadOrders();

    } catch (error: any) {
      console.error('병리 이미지 분석 오류:', error);
      toast({
        title: "분석 요청 실패",
        description: error.message || "분석 요청 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      'pending': { label: '대기중', variant: 'outline' },
      'sent': { label: '전달됨', variant: 'secondary' },
      'processing': { label: '처리중', variant: 'default' },
      'completed': { label: '완료', variant: 'default' },
      'cancelled': { label: '취소됨', variant: 'destructive' },
    };
    const config = statusConfig[status] || { label: status, variant: 'outline' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">병리 이미지 분석</h1>
          <p className="text-muted-foreground mt-1">
            OCS 주문 기반 병리 이미지 AI 분석 (교육원 워커 연동)
          </p>
        </div>
        {selectedOrder && (
          <Button 
            onClick={handleAnalyze}
            disabled={analyzing}
            className="bg-primary hover:bg-primary/90"
          >
            {analyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                분석 중...
              </>
            ) : (
              <>
                <Brain className="mr-2 h-4 w-4" />
                AI 분석 시작
              </>
            )}
          </Button>
        )}
      </div>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            병리 이미지 주문 검색
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="환자 이름 또는 환자번호로 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders List */}
      <Card>
        <CardHeader>
          <CardTitle>병리 이미지 주문 목록 ({filteredOrders.length}개)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingOrders ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              병리 이미지 주문이 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredOrders.map((order) => (
                <div
                  key={order.id}
                  onClick={() => setSelectedOrder(order)}
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    selectedOrder?.id === order.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-accent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-semibold">{order.patient_name}</span>
                        <span className="text-sm text-muted-foreground">
                          ({order.patient_id || order.patient_number})
                        </span>
                        {getStatusBadge(order.status)}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Scan className="h-3 w-3" />
                          <span>병리 이미지</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{new Date(order.created_at).toLocaleDateString('ko-KR')}</span>
                        </div>
                      </div>
                    </div>
                    {selectedOrder?.id === order.id && (
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Order Info */}
      {selectedOrder && (
        <Card>
          <CardHeader>
            <CardTitle>선택된 주문 정보</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">환자명</p>
                <p className="font-semibold">{selectedOrder.patient_name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">환자 ID</p>
                <p className="font-semibold">{selectedOrder.patient_id || selectedOrder.patient_number}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">주문 상태</p>
                {getStatusBadge(selectedOrder.status)}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">주문일시</p>
                <p className="font-semibold">
                  {new Date(selectedOrder.created_at).toLocaleString('ko-KR')}
                </p>
              </div>
            </div>
            <div className="pt-4 border-t space-y-4">
              <div>
                <Label className="mb-2 block">분석할 파일 선택 (교육원 워커 wsi/ 폴더)</Label>
                <Select
                  value={selectedFilename}
                  onValueChange={(value) => setSelectedFilename(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="파일 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_WSI_FILES.map((file) => (
                      <SelectItem key={file.value} value={file.value}>
                        {file.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  교육원 워커가 wsi/ 폴더에서 찾을 파일명입니다.
                </p>
              </div>
              
              {/* 분석 결과 표시 */}
              {analysisResult && (
                <div className="p-4 bg-green-50 border-2 border-green-300 rounded-lg shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <h4 className="font-bold text-lg text-green-800">분석 결과</h4>
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700 min-w-[80px]">결과:</span>
                      <Badge variant={analysisResult.class_name === 'Tumor' ? 'destructive' : 'default'} className="text-base px-3 py-1">
                        {analysisResult.class_name === 'Tumor' ? '종양 (Tumor)' : '정상 (Normal)'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700 min-w-[80px]">신뢰도:</span>
                      <span className="text-base font-bold text-green-700">
                        {(analysisResult.confidence * 100).toFixed(2)}%
                      </span>
                    </div>
                    {analysisResult.num_patches && (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-700 min-w-[80px]">패치 수:</span>
                        <span className="text-base">{analysisResult.num_patches.toLocaleString()}개</span>
                      </div>
                    )}
                    {analysisResult.elapsed_time_seconds && (
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-700 min-w-[80px]">소요 시간:</span>
                        <span className="text-base">
                          {Math.floor(analysisResult.elapsed_time_seconds / 60)}분 {Math.floor(analysisResult.elapsed_time_seconds % 60)}초
                        </span>
                      </div>
                    )}
                    {(analysisResult.image_url || analysisResult.viewer_url || analysisResult.dzi_url) && (
                      <div className="mt-3 pt-3 border-t border-green-200">
                        <p className="font-semibold text-gray-700 mb-2">결과 이미지:</p>
                        <div className="flex flex-wrap gap-2">
                          {analysisResult.image_url && (
                            <a 
                              href={analysisResult.image_url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                            >
                              <Scan className="h-4 w-4" />
                              결과 이미지 보기
                            </a>
                          )}
                          {analysisResult.dzi_url && (
                            <button
                              type="button"
                              onClick={() => setShowHighResViewer(true)}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                            >
                              <ZoomIn className="h-4 w-4" />
                              고해상도 뷰어 (원본 TIF 확대)
                            </button>
                          )}
                          {analysisResult.viewer_url && !analysisResult.dzi_url && (
                            <a 
                              href={analysisResult.viewer_url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-700 transition-colors"
                            >
                              새 탭에서 뷰어 열기
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* 진행 중 표시 */}
              {pendingRequestId && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600 flex-shrink-0" />
                      <p className="text-sm text-blue-800">교육원 워커에서 분석 중입니다... (약 50분 소요)</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCancelWaiting}
                      className="flex-shrink-0 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      대기 취소
                    </Button>
                  </div>
                  <p className="text-xs text-blue-600">워커가 중단되었다면 &quot;대기 취소&quot; 후 다시 시도해 주세요.</p>
                </div>
              )}
              
              <Button 
                onClick={handleAnalyze}
                disabled={analyzing || selectedOrder.status === 'completed' || !selectedFilename || !!pendingRequestId || !!analysisResult}
                className="w-full bg-primary hover:bg-primary/90"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    교육원 워커로 분석 요청 중...
                  </>
                ) : (
                  <>
                    <Brain className="mr-2 h-4 w-4" />
                    AI 분석 시작 (교육원 워커)
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 고해상도 뷰어 모달 (OpenSeadragon + DZI) */}
      <PathologyHighResViewer
        open={showHighResViewer}
        onOpenChange={setShowHighResViewer}
        dziUrl={analysisResult?.dzi_url ?? ''}
        title={`고해상도 뷰어 - ${selectedOrder?.patient_name || ''}`}
      />
    </div>
  );
}
