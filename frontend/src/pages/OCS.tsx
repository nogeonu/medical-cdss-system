import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import {
  Plus,
  Search,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Pill,
  FlaskConical,
  Scan,
  RefreshCw,
  Printer,
  Download,
} from "lucide-react";
import { checkDrugInteractionsApi, searchDrugsApi, downloadPrescriptionPdfApi, type Drug, type DrugInteractionResult } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  getOrdersApi,
  createOrderApi,
  sendOrderApi,
  startProcessingOrderApi,
  completeOrderApi,
  cancelOrderApi,
  getOrderStatisticsApi,
  getMyOrdersApi,
  getPendingOrdersApi,
  searchPatientsApi,
  createImagingAnalysisApi,
  getPatientAnalysisDataApi,
  inputLabResultApi,
  getRNATestsApi,
  predictPCRApi,
  inputPathologyResultApi,
} from "@/lib/api";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

interface Order {
  id: string;
  order_type: "prescription" | "lab_test" | "imaging" | "tissue_exam";
  patient: string;
  patient_name: string;
  patient_number?: string;  // optional로 변경 (API에서 제공하지 않을 수도 있음)
  patient_id?: string;  // Orthanc 매칭용 (DB의 patient_id와 동일)
  doctor: number;
  doctor_name: string;
  status: "pending" | "sent" | "processing" | "completed" | "cancelled";
  priority: "routine" | "urgent" | "stat" | "emergency";
  order_data: any;
  target_department: string;
  validation_passed: boolean;
  validation_notes: string;
  created_at: string;
  due_time?: string;
  completed_at?: string;
  notes?: string;
  drug_interaction_checks?: any[];
  allergy_checks?: any[];
  imaging_analysis?: {
    id: string;
    findings: string;
    recommendations: string;
    confidence_score: number;
  };
  lab_test_result?: {
    id: string;
    test_results: any;
    ai_findings: string;
    ai_confidence_score: number;
    ai_report_image: string;
    ai_prediction: string;
    notes: string;
    input_by_name: string;
    created_at: string;
  };
  pathology_analysis?: {
    id: string;
    class_id: number;
    class_name: string;
    confidence: number;
    probabilities: { [key: string]: number };
    filename: string;
    image_url: string;
    findings: string;
    recommendations: string;
    analyzed_by_name: string;
    created_at: string;
  };
}

const ORDER_TYPE_LABELS = {
  prescription: "처방전",
  lab_test: "검사",
  imaging: "영상촬영",
  tissue_exam: "조직검사",
};

const STATUS_LABELS = {
  pending: "대기중",
  sent: "전달됨",
  processing: "처리중",
  completed: "완료",
  cancelled: "취소",
};

const PRIORITY_LABELS = {
  routine: "일반",
  urgent: "긴급",
  stat: "즉시",
  emergency: "응급",
};

const STATUS_COLORS = {
  pending: "bg-yellow-100 text-yellow-800",
  sent: "bg-blue-100 text-blue-800",
  processing: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

const PRIORITY_COLORS = {
  routine: "bg-gray-100 text-gray-800",
  urgent: "bg-orange-100 text-orange-800",
  stat: "bg-red-100 text-red-800",
  emergency: "bg-red-200 text-red-900",
};

export default function OCS() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [patientSearchTerm, setPatientSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "my" | "pending">("all");

  // 주문 목록 조회 (역할별 자동 필터링)
  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["ocs-orders", statusFilter, typeFilter, viewMode],
    queryFn: async () => {
      let data;
      if (viewMode === "my") {
        data = await getMyOrdersApi();
      } else if (viewMode === "pending") {
        // 부서별로 자동 필터링됨
        data = await getPendingOrdersApi(user?.department || undefined);
      } else {
        data = await getOrdersApi({ 
          status: statusFilter !== "all" ? statusFilter : undefined, 
          order_type: typeFilter !== "all" ? typeFilter : undefined 
        });
      }
      
      // 배열로 변환
      const ordersArray = Array.isArray(data) ? data : (data?.results || []);
      
      // 디버깅: 조직검사 주문의 pathology_analysis 확인
      ordersArray.forEach((order: any) => {
        if (order.order_type === 'tissue_exam') {
          console.log(`[OCS] 주문 ${order.id} (${order.patient_name}):`, {
            status: order.status,
            has_pathology: !!order.pathology_analysis,
            pathology_class: order.pathology_analysis?.class_name,
            pathology_data: order.pathology_analysis ? {
              id: order.pathology_analysis.id,
              class_name: order.pathology_analysis.class_name,
              confidence: order.pathology_analysis.confidence,
              has_findings: !!order.pathology_analysis.findings,
              has_recommendations: !!order.pathology_analysis.recommendations,
              has_image: !!order.pathology_analysis.image_url,
            } : null,
          });
        }
      });
      
      return ordersArray;
    },
  });
  
  // orders를 배열로 변환
  const orders = Array.isArray(ordersData) ? ordersData : (ordersData?.results || []);

  // 통계 조회
  const { data: statistics } = useQuery({
    queryKey: ["ocs-statistics"],
    queryFn: getOrderStatisticsApi,
  });

  // 환자 검색
  const { data: patients, isLoading: isSearchingPatients } = useQuery({
    queryKey: ["search-patients", patientSearchTerm],
    queryFn: () => searchPatientsApi(patientSearchTerm),
    enabled: patientSearchTerm.length > 0,
  });

  // 주문 생성
  const createOrderMutation = useMutation({
    mutationFn: createOrderApi,
    onSuccess: () => {
      toast({
        title: "주문 생성 완료",
        description: "주문이 성공적으로 생성되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ocs-statistics"] });
      setIsCreateDialogOpen(false);
      setSelectedPatient(null);
    },
    onError: (error: any) => {
      console.error("주문 생성 에러:", error);
      console.error("에러 응답:", error.response?.data);
      
      let errorMessage = "주문 생성에 실패했습니다.";
      
      if (error.response?.data) {
        const data = error.response.data;
        
        // details 객체가 있는 경우 (serializer validation errors)
        if (data.details) {
          const details = data.details;
          const errorMessages: string[] = [];
          
          // 각 필드별 에러 메시지 수집
          Object.keys(details).forEach((key) => {
            const fieldErrors = details[key];
            if (Array.isArray(fieldErrors)) {
              errorMessages.push(`${key}: ${fieldErrors.join(", ")}`);
            } else if (typeof fieldErrors === "string") {
              errorMessages.push(`${key}: ${fieldErrors}`);
            } else {
              errorMessages.push(`${key}: ${JSON.stringify(fieldErrors)}`);
            }
          });
          
          errorMessage = errorMessages.length > 0 
            ? errorMessages.join("\n")
            : data.error || data.detail || errorMessage;
        } else if (data.error) {
          errorMessage = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
        } else if (data.detail) {
          errorMessage = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
        } else if (data.message) {
          errorMessage = data.message;
        } else {
          // 첫 번째 필드의 에러 메시지 사용
          const firstKey = Object.keys(data)[0];
          if (firstKey) {
            const val = data[firstKey];
            if (Array.isArray(val)) {
              errorMessage = `${firstKey}: ${val.join(", ")}`;
            } else if (typeof val === "string") {
              errorMessage = `${firstKey}: ${val}`;
            } else {
              errorMessage = JSON.stringify(data);
            }
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "주문 생성 실패",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // 주문 전달
  const sendOrderMutation = useMutation({
    mutationFn: sendOrderApi,
    onSuccess: () => {
      toast({
        title: "주문 전달 완료",
        description: "주문이 성공적으로 전달되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "주문 전달 실패",
        description: error.response?.data?.error || "주문 전달에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // PDF 미리보기 상태
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

  // PDF 미리보기 닫기
  const handleClosePdfPreview = (open: boolean) => {
    if (!open) {
      setShowPdfPreview(false);
      if (pdfUrl) {
        window.URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      setPdfBlob(null);
      setCurrentOrderId(null);
    }
  };

  // PDF 다운로드
  const handleDownloadPdf = () => {
    if (!pdfBlob || !currentOrderId) return;
    
    const orders = queryClient.getQueryData<any[]>(["ocs-orders", viewMode, searchTerm, statusFilter, typeFilter]);
    const order = orders?.find((o: any) => o.id === currentOrderId);
    
    const url = window.URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `prescription_${order?.patient_number || order?.patient_id || 'unknown'}_${currentOrderId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    toast({
      title: "PDF 다운로드",
      description: "처방전 PDF가 다운로드되었습니다.",
    });
  };

  // PDF 프린트
  const handlePrintPdf = () => {
    if (!pdfUrl) return;
    
    const printWindow = window.open(pdfUrl, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  // PDF 미리보기 열기
  const handleOpenPdfPreview = async (orderId: string) => {
    try {
      const blob = await downloadPrescriptionPdfApi(orderId);
      const url = window.URL.createObjectURL(blob);
      setPdfBlob(blob);
      setPdfUrl(url);
      setCurrentOrderId(orderId);
      setShowPdfPreview(true);
    } catch (error: any) {
      console.error("PDF 다운로드 오류:", error);
      toast({
        title: "PDF 로드 실패",
        description: error.response?.data?.error || "처방전 PDF를 불러오는데 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  // 주문 처리 시작
  const startProcessingMutation = useMutation({
    mutationFn: async (orderId: string) => {
      // 처리 시작 API 호출만 수행 (PDF 미리보기는 별도 버튼으로)
      return startProcessingOrderApi(orderId);
    },
    onSuccess: () => {
      toast({
        title: "처리 시작",
        description: "주문 처리를 시작했습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
    },
  });

  // 검사 결과 입력
  const inputLabResultMutation = useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => inputLabResultApi(orderId, data),
    onSuccess: () => {
      toast({
        title: "검사 결과 입력 완료",
        description: "의사에게 알림이 전송되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "검사 결과 입력 실패",
        description: error?.response?.data?.error || "검사 결과 입력 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 병리 분석 결과 입력
  const inputPathologyResultMutation = useMutation({
    mutationFn: ({ orderId, data }: { orderId: string; data: any }) => inputPathologyResultApi(orderId, data),
    onSuccess: () => {
      toast({
        title: "병리 분석 결과 전달 완료",
        description: "의사에게 알림이 전송되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "병리 분석 결과 전달 실패",
        description: error?.response?.data?.error || "병리 분석 결과 전달 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 주문 완료
  const completeOrderMutation = useMutation({
    mutationFn: completeOrderApi,
    onSuccess: () => {
      toast({
        title: "주문 완료",
        description: "주문이 완료 처리되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
    },
  });

  // 주문 취소
  const cancelOrderMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => cancelOrderApi(id, reason),
    onSuccess: () => {
      toast({
        title: "주문 취소 완료",
        description: "주문이 취소되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
    },
  });
  
  // 디버깅: 첫 번째 주문의 patient_number 확인
  if (orders.length > 0 && orders[0]) {
    console.log("📋 첫 번째 주문 데이터:", {
      id: orders[0].id,
      patient_name: orders[0].patient_name,
      patient_number: orders[0].patient_number,
      patient: orders[0].patient,
      keys: Object.keys(orders[0])
    });
  }

  const filteredOrders = (orders || []).filter((order: Order) => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      return (
        order.patient_name?.toLowerCase().includes(searchLower) ||
        order.patient_number?.toLowerCase().includes(searchLower) ||
        order.doctor_name?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  const handleCreateOrder = (formData: any) => {
    if (!selectedPatient) {
      toast({
        title: "환자 선택 필요",
        description: "환자를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    // pk (숫자 ID) 또는 id (문자열 patient_id) 사용
    // pk가 있으면 숫자 ID로, 없으면 patient_id 문자열로 전달
    const orderData = {
      ...formData,
    };
    
    if (selectedPatient.pk !== undefined) {
      // 숫자 primary key가 있는 경우
      orderData.patient = selectedPatient.pk;
    } else if (selectedPatient.id && typeof selectedPatient.id === 'number') {
      // 숫자 id가 있는 경우
      orderData.patient = selectedPatient.id;
    } else {
      // 문자열 patient_id인 경우
      const patientId = selectedPatient.patient_id || selectedPatient.id;
      orderData.patient_id = patientId;
    }

    console.log("주문 생성 데이터:", orderData);
    console.log("선택된 환자:", selectedPatient);
    createOrderMutation.mutate(orderData);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">처방전달시스템 (OCS)</h1>
          <p className="text-muted-foreground mt-1">
            {user?.department && (
              <span className="font-medium">{user.department}</span>
            )}
            {user?.department && " | "}
            처방전, 검사, 영상촬영 주문을 관리합니다.
          </p>
        </div>
        <div className="flex gap-2">
          {/* 부서별로 주문 생성 버튼 표시 */}
          {(() => {
            // 원무과, 영상의학과, 방사선과, 검사실은 주문 생성 불가
            if (user?.department === "원무과" || 
                user?.department === "영상의학과" || 
                user?.department === "방사선과" ||
                user?.department === "검사실") {
              return null;
            }
            // 의료진(외과, 호흡기내과 등) 또는 superuser만 생성 가능
            if (user?.role === "medical_staff" || user?.role === "superuser") {
              return (
                <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      주문 생성
                    </Button>
                  </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>새 주문 생성</DialogTitle>
              <DialogDescription>
                처방전, 검사, 또는 영상촬영 주문을 생성합니다.
              </DialogDescription>
            </DialogHeader>
            <CreateOrderForm
              selectedPatient={selectedPatient}
              setSelectedPatient={setSelectedPatient}
              patientSearchTerm={patientSearchTerm}
              setPatientSearchTerm={setPatientSearchTerm}
              patients={patients || []}
              isSearchingPatients={isSearchingPatients}
              onSubmit={handleCreateOrder}
              isLoading={createOrderMutation.isPending}
            />
          </DialogContent>
        </Dialog>
              );
            }
            return null;
          })()}
        </div>
      </div>

      {/* 뷰 모드 선택 (의료진만) */}
      {user?.role === "medical_staff" && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <Button
                variant={viewMode === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("all")}
              >
                전체 주문
              </Button>
              <Button
                variant={viewMode === "my" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("my")}
              >
                내 주문
              </Button>
              <Button
                variant={viewMode === "pending" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("pending")}
              >
                대기 중인 주문
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 통계 카드 */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">오늘 주문</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statistics.total_orders_today || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">대기 중</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statistics.orders_by_status?.find((s: any) => s.status === "pending")?.count || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">처리중</CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {statistics.orders_by_status?.find((s: any) => s.status === "processing")?.count || 0}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">긴급 주문</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{statistics.urgent_orders_pending || 0}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 필터 및 검색 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="환자명, 환자번호, 의사명으로 검색..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="상태 필터" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 상태</SelectItem>
                <SelectItem value="pending">대기중</SelectItem>
                <SelectItem value="sent">전달됨</SelectItem>
                <SelectItem value="processing">처리중</SelectItem>
                <SelectItem value="completed">완료</SelectItem>
                <SelectItem value="cancelled">취소</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="유형 필터" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 유형</SelectItem>
                <SelectItem value="prescription">처방전</SelectItem>
                <SelectItem value="lab_test">검사</SelectItem>
                <SelectItem value="imaging">영상촬영</SelectItem>
                <SelectItem value="tissue_exam">조직검사</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* PDF 미리보기 다이얼로그 */}
      <Dialog open={showPdfPreview} onOpenChange={handleClosePdfPreview}>
        <DialogContent className="max-w-[900px] w-auto max-h-[95vh] flex flex-col p-4">
          <DialogHeader className="pb-2">
            <DialogTitle>처방전 미리보기</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto flex flex-col items-center justify-center bg-gray-50 rounded-lg p-4">
            {pdfUrl && (
              <iframe
                src={pdfUrl}
                className="border rounded-lg shadow-lg bg-white"
                title="처방전 PDF 미리보기"
                style={{ 
                  width: '210mm',  // A4 너비
                  height: '297mm', // A4 높이
                  maxWidth: '100%',
                  maxHeight: 'calc(95vh - 150px)',
                  aspectRatio: '210 / 297' // A4 비율 유지
                }}
              />
            )}
            <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
              <Button
                variant="outline"
                onClick={handlePrintPdf}
                disabled={!pdfUrl}
              >
                <Printer className="mr-2 h-4 w-4" />
                프린트
              </Button>
              <Button
                onClick={handleDownloadPdf}
                disabled={!pdfBlob}
              >
                <Download className="mr-2 h-4 w-4" />
                다운로드
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 주문 목록 */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">로딩 중...</p>
            </CardContent>
          </Card>
        ) : filteredOrders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">주문이 없습니다.</p>
            </CardContent>
          </Card>
        ) : (
          filteredOrders.map((order: Order) => (
            <OrderCard
              key={order.id}
              order={order}
              user={user}
              onSend={() => sendOrderMutation.mutate(order.id)}
              onStartProcessing={() => startProcessingMutation.mutate(order.id)}
              onComplete={() => completeOrderMutation.mutate(order.id)}
              onCancel={(reason) => cancelOrderMutation.mutate({ id: order.id, reason })}
              onDownloadPdf={() => handleOpenPdfPreview(order.id)}
              isSending={sendOrderMutation.isPending}
              isCompleting={completeOrderMutation.isPending}
              onCreateAnalysis={createImagingAnalysisApi}
              onViewAnalysis={(analysisId) => navigate(`/ocs/imaging-analysis/${analysisId}?order=${order.id}`)}
              onInputLabResult={(data) => inputLabResultMutation.mutate({ orderId: order.id, data })}
              isInputtingLabResult={inputLabResultMutation.isPending}
              onInputPathologyResult={(data) => inputPathologyResultMutation.mutate({ orderId: order.id, data })}
              isInputtingPathologyResult={inputPathologyResultMutation.isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  user,
  onSend,
  onStartProcessing,
  onComplete,
  onCancel,
  onDownloadPdf,
  isSending,
  isCompleting,
  onCreateAnalysis,
  onViewAnalysis,
  onInputLabResult,
  isInputtingLabResult,
  onInputPathologyResult,
  isInputtingPathologyResult,
}: {
  order: Order;
  user: any;
  onSend: () => void;
  onStartProcessing?: () => void;
  onComplete: () => void;
  onCancel: (reason: string) => void;
  onDownloadPdf?: () => void;
  isSending: boolean;
  isCompleting: boolean;
  onCreateAnalysis?: (data: any) => Promise<any>;
  onViewAnalysis?: (analysisId: string) => void;
  onInputLabResult?: (data: any) => void;
  isInputtingLabResult?: boolean;
  onInputPathologyResult?: (data: any) => void;
  isInputtingPathologyResult?: boolean;
}) {
  const navigate = useNavigate();
  const [showAnalysisDialog, setShowAnalysisDialog] = useState(false);
  const [showLabResultDialog, setShowLabResultDialog] = useState(false);
  const [showPathologyResultDialog, setShowPathologyResultDialog] = useState(false);
  const [showPathologyInputDialog, setShowPathologyInputDialog] = useState(false);
  const [selectedOrderForPathology, setSelectedOrderForPathology] = useState<Order | null>(null);
  const [pathologyFindings, setPathologyFindings] = useState("");
  const [pathologyRecommendations, setPathologyRecommendations] = useState("");
  const [findings, setFindings] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [confidenceScore, setConfidenceScore] = useState(0.95);
  const [labTestResults, setLabTestResults] = useState<any>({});
  const [labAiFindings, setLabAiFindings] = useState("");
  const [labAiConfidence, setLabAiConfidence] = useState<number>(0);
  const [labAiReportImage, setLabAiReportImage] = useState("");
  const [labAiPrediction, setLabAiPrediction] = useState("");

  // 다이얼로그 열 때 기존 결과 로드
  useEffect(() => {
    if (showLabResultDialog && order.lab_test_result) {
      setLabTestResults(order.lab_test_result.test_results || {});
      setLabAiFindings(order.lab_test_result.ai_findings || "");
      setLabAiConfidence(order.lab_test_result.ai_confidence_score || 0);
      setLabAiReportImage(order.lab_test_result.ai_report_image || "");
      setLabAiPrediction(order.lab_test_result.ai_prediction || "");
    } else if (showLabResultDialog) {
      // 새로 입력하는 경우 초기화
      setLabTestResults({});
      setLabAiFindings("");
      setLabAiConfidence(0);
      setLabAiReportImage("");
      setLabAiPrediction("");
    }
  }, [showLabResultDialog, order.lab_test_result]);

  // 병리 결과 입력 다이얼로그 열 때 기존 결과 로드
  useEffect(() => {
    if (showPathologyInputDialog && selectedOrderForPathology?.pathology_analysis) {
      setPathologyFindings(selectedOrderForPathology.pathology_analysis.findings || '');
      setPathologyRecommendations(selectedOrderForPathology.pathology_analysis.recommendations || '');
    } else if (showPathologyInputDialog) {
      // 새로 입력하는 경우 초기화
      setPathologyFindings('');
      setPathologyRecommendations('');
    }
  }, [showPathologyInputDialog, selectedOrderForPathology]);

  const [heatmapImages, setHeatmapImages] = useState<File[]>([]);  // 여러 이미지 지원
  const [imagePreviews, setImagePreviews] = useState<Map<string, string>>(new Map());  // instanceId -> previewUrl
  const [orthancImages, setOrthancImages] = useState<any[]>([]);
  const [selectedOrthancImages, setSelectedOrthancImages] = useState<Set<string>>(new Set());  // 여러 선택 지원
  const [showOrthancSelector, setShowOrthancSelector] = useState(false);
  const [isLoadingOrthancImages, setIsLoadingOrthancImages] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Orthanc 이미지 선택/해제 (여러 장 지원)
  const handleOrthancImageToggle = async (instanceId: string, previewUrl: string) => {
    const newSelected = new Set(selectedOrthancImages);
    const newPreviews = new Map(imagePreviews);
    const newFiles: File[] = [];
    
    if (newSelected.has(instanceId)) {
      // 이미 선택된 이미지면 해제
      newSelected.delete(instanceId);
      newPreviews.delete(instanceId);
      // 기존 파일에서 제거
      heatmapImages.forEach(file => {
        if (!file.name.includes(instanceId)) {
          newFiles.push(file);
        }
      });
      toast({
        title: "이미지 해제",
        description: "히트맵 이미지 선택을 해제했습니다.",
      });
    } else {
      // 새로 선택
      try {
        const response = await fetch(previewUrl);
        const blob = await response.blob();
        const file = new File([blob], `heatmap_${instanceId}.png`, { type: 'image/png' });
        newSelected.add(instanceId);
        newPreviews.set(instanceId, previewUrl);
        newFiles.push(...heatmapImages, file);
        toast({
          title: "이미지 선택",
          description: "히트맵 이미지를 선택했습니다. (여러 장 선택 가능)",
        });
      } catch (error) {
        console.error("이미지 로드 실패:", error);
        toast({
          title: "오류",
          description: "이미지를 불러오는데 실패했습니다.",
          variant: "destructive",
        });
        return;
      }
    }
    
    setSelectedOrthancImages(newSelected);
    setImagePreviews(newPreviews);
    setHeatmapImages(newFiles);
  };

  // Orthanc 이미지 가져오기 및 분석 결과 자동 로드
  const fetchOrthancImages = async (patientId: string) => {
    setIsLoadingOrthancImages(true);
    console.log("🔍 fetchOrthancImages 호출 - patientId:", patientId);
    try {
      const response = await fetch(`/api/mri/orthanc/patients/${patientId}/`);
      const data = await response.json();
      console.log("📦 Orthanc API 응답:", {
        success: data.success,
        images_count: data.images?.length || 0,
        error: data.error
      });
      if (data.success && data.images) {
        console.log(`✅ Orthanc에서 ${data.images.length}개의 이미지 발견`);
        // Heatmap 이미지만 필터링 (SeriesDescription이 "Heatmap Image"인 것)
        const heatmapImages = data.images.filter((img: any) => {
          const desc = img.series_description || '';
          const isHeatmap = desc.includes("Heatmap") || desc.includes("heatmap");
          console.log(`  - 이미지: ${desc} (히트맵: ${isHeatmap})`);
          return isHeatmap;
        });
        console.log(`🔥 히트맵 이미지 ${heatmapImages.length}개 필터링됨`);
        setOrthancImages(heatmapImages);
        
        // 분석 데이터 가져오기 (자동 폼 채우기)
        try {
          const analysisData = await getPatientAnalysisDataApi(patientId);
          if (analysisData.success && analysisData.has_heatmap) {
            // 자동 선택 기능 제거 (사용자가 직접 여러 장 선택하도록)
            
            // 분석 결과 자동 채우기
            if (analysisData.suggested_findings) {
              setFindings(analysisData.suggested_findings);
            }
            if (analysisData.suggested_recommendations) {
              setRecommendations(analysisData.suggested_recommendations);
            }
            if (analysisData.suggested_confidence) {
              setConfidenceScore(analysisData.suggested_confidence);
            }
            
            toast({
              title: "분석 데이터 자동 로드",
              description: `${analysisData.heatmap_count}개의 히트맵 이미지를 찾았고 분석 결과를 자동으로 채웠습니다.`,
            });
          } else if (heatmapImages.length === 0) {
            // 히트맵 이미지가 실제로 없는 경우에만 안내
            // (analysisData.has_heatmap이 false여도 heatmapImages가 있으면 무시)
            console.warn("⚠️ 히트맵 이미지가 필터링되지 않음:", {
              total_images: data.images.length,
              heatmap_images: heatmapImages.length
            });
          }
        } catch (analysisError) {
          console.warn("분석 데이터 자동 로드 실패 (무시):", analysisError);
          // 분석 데이터 로드 실패해도 이미지는 표시
        }
        
        return heatmapImages;
      } else {
        setOrthancImages([]);
        console.warn("⚠️ Orthanc API 응답 실패:", data);
        // 에러 메시지는 표시하지 않음 (히트맵이 없을 수도 있음)
        return [];
      }
    } catch (error) {
      console.error("❌ Orthanc 이미지 로드 실패:", error);
      setOrthancImages([]);
      // 에러는 로그만 남기고 토스트는 표시하지 않음 (히트맵이 없을 수도 있음)
      return [];
    } finally {
      setIsLoadingOrthancImages(false);
    }
  };

  const handleCreateAnalysis = async () => {
    if (!onCreateAnalysis) return;
    
    // 유방촬영술일 때만 히트맵 이미지 필수
    const imagingType = order.order_data?.imaging_type || '';
    const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
    
    if (isMammography && heatmapImages.length === 0) {
      toast({
        title: "히트맵 이미지 필요",
        description: "유방촬영술 분석 결과 입력 시 최소 1장의 히트맵 이미지를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      // FormData 생성 (이미지 파일 전송을 위해)
      const formData = new FormData();
      formData.append('order', order.id);
      formData.append('findings', findings);
      formData.append('recommendations', recommendations);
      formData.append('confidence_score', confidenceScore.toString());
      formData.append('analysis_result', JSON.stringify({}));
      
      // 유방촬영술일 때만 heatmap 이미지 파일 추가
      if (isMammography && heatmapImages.length > 0) {
        heatmapImages.forEach((file, index) => {
          formData.append('heatmap_image', file);
          // 여러 파일을 구분하기 위해 index 추가 (백엔드에서 처리 가능하도록)
          formData.append(`heatmap_image_${index}`, file);
        });
      }
      
      await onCreateAnalysis(formData);
      const imageCount = isMammography ? heatmapImages.length : 0;
      toast({
        title: "분석 결과 생성 완료",
        description: imageCount > 0 
          ? `${imageCount}장의 히트맵 이미지와 함께 의사에게 알림이 전송되었습니다.`
          : "의사에게 알림이 전송되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ["ocs-orders"] });
      setShowAnalysisDialog(false);
      setFindings("");
      setRecommendations("");
      setHeatmapImages([]);
      setImagePreviews(new Map());
      setSelectedOrthancImages(new Set());
    } catch (error: any) {
      toast({
        title: "분석 결과 생성 실패",
        description: error.response?.data?.detail || "분석 결과 생성에 실패했습니다.",
        variant: "destructive",
      });
    }
  };
  const getOrderIcon = () => {
    switch (order.order_type) {
      case "prescription":
        return <Pill className="h-5 w-5" />;
      case "lab_test":
        return <FlaskConical className="h-5 w-5" />;
      case "imaging":
        return <Scan className="h-5 w-5" />;
      default:
        return <FileText className="h-5 w-5" />;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-primary/10 rounded-lg">{getOrderIcon()}</div>
            <div>
              <CardTitle className="text-lg">
                {ORDER_TYPE_LABELS[order.order_type]} - {order.patient_name}
              </CardTitle>
              <CardDescription className="mt-1">
                환자번호: {order.patient_number} | 의사: {order.doctor_name}
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge className={STATUS_COLORS[order.status]}>
              {STATUS_LABELS[order.status]}
            </Badge>
            <Badge className={PRIORITY_COLORS[order.priority]}>
              {PRIORITY_LABELS[order.priority]}
            </Badge>
            {!order.validation_passed && (
              <Badge variant="destructive">검증 실패</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* 주문 내용 */}
          <div>
            <h4 className="text-sm font-medium mb-2">주문 내용</h4>
            <div className="text-sm text-muted-foreground">
              {order.order_type === "prescription" && (
                <div>
                  약물: {order.order_data?.medications?.map((m: any) => m.name).join(", ") || "없음"}
                </div>
              )}
              {order.order_type === "lab_test" && (
                <div>
                  검사 항목: {order.order_data?.test_items?.map((t: any) => t.name).join(", ") || "없음"}
                </div>
              )}
              {order.order_type === "imaging" && (
                <div>
                  촬영 유형: {order.order_data?.imaging_type || "없음"} | 부위: {order.order_data?.body_part || "없음"}
                  {order.order_data?.contrast && (
                    <Badge variant="outline" className="ml-2">조영제 사용</Badge>
                  )}
                </div>
              )}
              {order.order_type === "tissue_exam" && (
                <div>
                  촬영 유형: {order.order_data?.imaging_type || "없음"} | 부위: {order.order_data?.body_part || "없음"}
                </div>
              )}
            </div>
          </div>

          {/* 검증 결과 */}
          {order.validation_notes && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">검증 메모</p>
                  <p className="text-yellow-700 dark:text-yellow-300">{order.validation_notes}</p>
                </div>
              </div>
            </div>
          )}

          {/* 약물 상호작용 경고 */}
          {order.drug_interaction_checks && order.drug_interaction_checks.length > 0 && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-red-800 dark:text-red-200">약물 상호작용 경고</p>
                  {order.drug_interaction_checks.map((check: any, idx: number) => (
                    <p key={idx} className="text-red-700 dark:text-red-300">
                      {check.severity === "severe" && "⚠️ 심각: "}
                      {check.interactions?.map((i: any) => `${i.drug1} + ${i.drug2}: ${i.description}`).join(", ")}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 알레르기 경고 */}
          {order.allergy_checks && order.allergy_checks.some((check: any) => check.has_allergy_risk) && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-red-800 dark:text-red-200">알레르기 위험</p>
                  {order.allergy_checks
                    .filter((check: any) => check.has_allergy_risk)
                    .map((check: any, idx: number) => (
                      <p key={idx} className="text-red-700 dark:text-red-300">
                        {check.warnings?.map((w: any) => w.description).join(", ")}
                      </p>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* 일시 정보 */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              생성: {format(new Date(order.created_at), "yyyy-MM-dd HH:mm")}
            </div>
            {order.due_time && (
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                기한: {format(new Date(order.due_time), "yyyy-MM-dd HH:mm")}
              </div>
            )}
            {order.completed_at && (
              <div className="flex items-center gap-1">
                <CheckCircle className="h-4 w-4" />
                완료: {format(new Date(order.completed_at), "yyyy-MM-dd HH:mm")}
              </div>
            )}
          </div>

          {/* 검사 결과 */}
          {order.order_type === "lab_test" && order.lab_test_result && (
            <div className="border rounded-lg p-4 bg-blue-50">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                검사 결과
              </h4>
              <div className="space-y-3">
                {order.lab_test_result.ai_findings && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">AI 소견</p>
                    <p className="text-sm font-semibold">{order.lab_test_result.ai_findings}</p>
                    {order.lab_test_result.ai_confidence_score && (
                      <p className="text-xs text-muted-foreground mt-1">
                        (신뢰도: {(order.lab_test_result.ai_confidence_score * 100).toFixed(1)}%)
                      </p>
                    )}
                  </div>
                )}
                {order.lab_test_result?.ai_report_image && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">AI 임상 리포트</p>
                    <div className="border rounded-lg p-2 bg-white">
                      <img
                        src={`data:image/png;base64,${order.lab_test_result.ai_report_image}`}
                        alt="AI Clinical Report"
                        className="w-full rounded cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const newWindow = window.open();
                          if (newWindow) {
                            newWindow.document.write(`
                              <html>
                                <head><title>AI 임상 리포트</title></head>
                                <body style="margin:0; padding:20px; background:#f5f5f5;">
                                  <img src="data:image/png;base64,${order.lab_test_result?.ai_report_image || ''}" style="max-width:100%; height:auto;" />
                                </body>
                              </html>
                            `);
                          }
                        }}
                      />
                      <p className="text-xs text-center text-muted-foreground mt-2">클릭하여 확대</p>
                    </div>
                  </div>
                )}
                {order.lab_test_result?.notes && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">추가 메모</p>
                    <p className="text-sm whitespace-pre-wrap">{order.lab_test_result.notes}</p>
                  </div>
                )}
                {order.lab_test_result?.input_by_name && (
                  <p className="text-xs text-muted-foreground">
                    입력자: {order.lab_test_result.input_by_name} | 입력일: {format(new Date(order.lab_test_result.created_at), 'yyyy-MM-dd HH:mm')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 영상 분석 결과 */}
          {order.order_type === "imaging" && order.imaging_analysis && (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="font-medium text-green-800 dark:text-green-200 mb-2">
                    영상 분석 완료
                    {order.imaging_analysis.confidence_score && (
                      <span className="ml-2 text-sm font-normal">
                        (신뢰도: {(order.imaging_analysis.confidence_score * 100).toFixed(1)}%)
                      </span>
                    )}
                  </p>
                </div>
                {onViewAnalysis && order.imaging_analysis?.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewAnalysis(order.imaging_analysis!.id)}
                  >
                    상세 보기
                  </Button>
                )}
              </div>
              
              {/* 소견 */}
              {order.imaging_analysis.findings && (
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                    소견:
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap">
                    {order.imaging_analysis.findings}
                  </p>
                </div>
              )}
              
              {/* 권고사항 */}
              {order.imaging_analysis.recommendations && (
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                    권고사항:
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap">
                    {order.imaging_analysis.recommendations}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 병리 분석 결과 */}
          {order.order_type === "tissue_exam" && order.pathology_analysis && (
            <div className="border rounded-lg p-4 bg-purple-50">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Scan className="h-4 w-4" />
                병리 분석 결과
              </h4>
              <div className="space-y-3">
                {/* 분석 결과 */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">분석 결과</p>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={order.pathology_analysis.class_name === 'Tumor' ? 'destructive' : 'default'} 
                      className="text-sm px-3 py-1"
                    >
                      {order.pathology_analysis.class_name === 'Tumor' ? '종양 (Tumor)' : '정상 (Normal)'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      신뢰도: {(order.pathology_analysis.confidence * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>

                {/* 클래스별 확률 */}
                {order.pathology_analysis.probabilities && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">클래스별 확률</p>
                    <div className="flex gap-2">
                      {Object.entries(order.pathology_analysis.probabilities).map(([className, prob]: [string, any]) => (
                        <div key={className} className="bg-white p-2 rounded border">
                          <div className="text-xs font-medium">{className}</div>
                          <div className="text-sm font-bold">{(prob * 100).toFixed(2)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 소견 */}
                {order.pathology_analysis.findings && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">소견</p>
                    <p className="text-sm font-semibold">{order.pathology_analysis.findings}</p>
                  </div>
                )}

                {/* 권고사항 */}
                {order.pathology_analysis.recommendations && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">권고사항</p>
                    <p className="text-sm whitespace-pre-wrap">{order.pathology_analysis.recommendations}</p>
                  </div>
                )}

                {/* 분석 이미지 */}
                {order.pathology_analysis.image_url && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">분석 이미지</p>
                    <div className="border rounded-lg p-2 bg-white">
                      <img
                        src={order.pathology_analysis.image_url}
                        alt="병리 분석 이미지"
                        className="w-full rounded cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => {
                          const newWindow = window.open();
                          if (newWindow) {
                            newWindow.document.write(`
                              <html>
                                <head><title>병리 분석 이미지</title></head>
                                <body style="margin:0; padding:20px; background:#f5f5f5;">
                                  <img src="${order.pathology_analysis?.image_url || ''}" style="max-width:100%; height:auto;" />
                                </body>
                              </html>
                            `);
                          }
                        }}
                      />
                      <p className="text-xs text-center text-muted-foreground mt-2">클릭하여 확대</p>
                    </div>
                  </div>
                )}

                {/* 분석 정보 */}
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    {order.pathology_analysis.analyzed_by_name && `검사자: ${order.pathology_analysis.analyzed_by_name} | `}
                    분석일: {format(new Date(order.pathology_analysis.created_at), 'yyyy-MM-dd HH:mm')}
                    {order.pathology_analysis.filename && ` | 파일: ${order.pathology_analysis.filename}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 액션 버튼 (역할별 제한) */}
          <div className="flex gap-2 pt-2 flex-wrap">
            {/* 의사: 자신이 생성한 주문만 전달 가능 */}
            {order.status === "pending" && order.validation_passed && (
              <Button onClick={onSend} disabled={isSending} size="sm">
                <Send className="mr-2 h-4 w-4" />
                전달
              </Button>
            )}
            {/* 부서 담당자: 전달된 주문 처리 시작 */}
            {/* 원무과는 처방전 주문(admin)에 대해 처리 시작 가능 */}
            {order.status === "sent" && (
              (order.target_department === "admin" && user?.department === "원무과") ||
              (order.target_department === "radiology" && (user?.department === "방사선과" || user?.department === "영상의학과")) ||
              (order.target_department === "lab" && user?.department !== "원무과" && user?.department !== "영상의학과" && user?.department !== "방사선과")
            ) && (
              <>
              <Button onClick={onStartProcessing} disabled={isCompleting} size="sm" variant="outline">
                <Clock className="mr-2 h-4 w-4" />
                처리 시작
                </Button>
                {/* 원무과 처방전 주문의 경우 PDF 다운로드 버튼 */}
                {order.order_type === "prescription" && order.target_department === "admin" && user?.department === "원무과" && onDownloadPdf && (
                  <Button 
                    onClick={onDownloadPdf} 
                    size="sm" 
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    처방전 보기
              </Button>
                )}
              </>
            )}
            {/* 부서 담당자: 처리 중인 주문 완료 처리 */}
            {/* 원무과는 처방전 주문(admin)에 대해 완료 처리 가능 */}
            {/* 영상의학과는 영상 촬영 주문의 경우 완료 처리 버튼 숨김 (분석 결과 입력으로 대체) */}
            {/* 검사실은 검사 주문의 경우 완료 처리 버튼 숨김 (결과 입력으로 대체) */}
            {order.status === "processing" && 
             !(order.order_type === "imaging" && user?.department === "영상의학과") &&
             !(order.order_type === "lab_test" && user?.department === "검사실") &&
             !(order.order_type === "tissue_exam" && user?.department === "검사실") && (
              (order.target_department === "admin" && user?.department === "원무과") ||
              (order.target_department === "radiology" && (user?.department === "방사선과" || user?.department === "영상의학과"))
            ) && (
              <>
              <Button onClick={onComplete} disabled={isCompleting} size="sm" variant="default">
                <CheckCircle className="mr-2 h-4 w-4" />
                완료 처리
                </Button>
                {/* 원무과 처방전 주문의 경우 PDF 다운로드 버튼 */}
                {order.order_type === "prescription" && order.target_department === "admin" && user?.department === "원무과" && onDownloadPdf && (
                  <Button 
                    onClick={onDownloadPdf} 
                    size="sm" 
                    variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    처방전 보기
              </Button>
                )}
              </>
            )}
            {/* 검사실: 검사 결과 입력 (processing 상태에서도 표시) */}
            {order.order_type === "lab_test" && 
             (order.status === "processing" || order.status === "completed") && 
             user?.department === "검사실" && (
              <Button
                onClick={() => setShowLabResultDialog(true)}
                size="sm"
                variant="default"
                className="bg-blue-600 hover:bg-blue-700"
              >
                <FlaskConical className="mr-2 h-4 w-4" />
                {order.lab_test_result ? "결과 수정" : "결과 입력"}
              </Button>
            )}
            {/* 검사실: 조직검사 결과 입력 (processing 상태에서 표시) */}
            {order.order_type === "tissue_exam" && 
             order.status === "processing" && 
             user?.department === "검사실" && (
              <Button
                onClick={async () => {
                  // 무조건 다이얼로그를 열고, 다이얼로그 내에서 데이터 로드
                  setSelectedOrderForPathology(order);
                  setShowPathologyInputDialog(true);
                  
                  // 주문 상세 정보를 가져와서 pathology_analysis 확인
                  try {
                    const response = await fetch(`/api/ocs/orders/${order.id}/`, {
                      credentials: 'include',
                    });
                    if (response.ok) {
                      const orderDetail = await response.json();
                      setSelectedOrderForPathology(orderDetail);
                    }
                  } catch (error) {
                    console.error('주문 상세 조회 실패:', error);
                  }
                }}
                size="sm"
                variant="default"
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Scan className="mr-2 h-4 w-4" />
                결과 입력 및 전달
              </Button>
            )}
            {/* 검사실: completed 상태에서 결과만 보기 */}
            {order.order_type === "tissue_exam" && 
             order.status === "completed" && 
             order.pathology_analysis &&
             user?.department === "검사실" && (
              <Button
                onClick={() => {
                  setShowPathologyResultDialog(true);
                  setSelectedOrderForPathology(order);
                }}
                size="sm"
                variant="outline"
                className="bg-gray-100 hover:bg-gray-200"
              >
                <Scan className="mr-2 h-4 w-4" />
                결과 보기
              </Button>
            )}
            {/* 의사: 병리 분석 결과 조회 (completed 상태이고 결과가 있을 때) */}
            {order.order_type === "tissue_exam" && 
             order.status === "completed" && 
             user?.department !== "검사실" && 
             user?.department !== "원무과" && (
              <Button
                onClick={async () => {
                  // 주문 상세 정보를 다시 가져와서 최신 pathology_analysis 확인
                  try {
                    const response = await fetch(`/api/ocs/orders/${order.id}/`, {
                      credentials: 'include',
                    });
                    if (response.ok) {
                      const orderDetail = await response.json() as Order;
                      console.log('[OCS] 주문 상세 조회:', {
                        order_id: orderDetail.id,
                        has_pathology: !!orderDetail.pathology_analysis,
                        pathology: orderDetail.pathology_analysis,
                      });
                      setSelectedOrderForPathology(orderDetail);
                      if (orderDetail.pathology_analysis) {
                        setShowPathologyResultDialog(true);
                      } else {
                        toast({
                          title: "결과 없음",
                          description: "병리 분석 결과가 아직 없습니다.",
                          variant: "destructive",
                        });
                      }
                    } else {
                      console.error('주문 상세 조회 실패:', response.status);
                      // 실패해도 기존 order로 시도
                      if (order.pathology_analysis) {
                        setSelectedOrderForPathology(order);
                        setShowPathologyResultDialog(true);
                      }
                    }
                  } catch (error) {
                    console.error('주문 상세 조회 오류:', error);
                    // 오류 발생 시 기존 order로 시도
                    if (order.pathology_analysis) {
                      setSelectedOrderForPathology(order);
                      setShowPathologyResultDialog(true);
                    }
                  }
                }}
                size="sm"
                variant={order.pathology_analysis ? "default" : "outline"}
                className={order.pathology_analysis ? "bg-green-600 hover:bg-green-700" : ""}
                disabled={!order.pathology_analysis}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                {order.pathology_analysis ? "병리 결과 확인" : "결과 대기 중"}
              </Button>
            )}
            {/* 영상의학과: 영상 분석 결과 입력 (processing 상태에서도 표시) */}
            {order.order_type === "imaging" && 
             (order.status === "processing" || order.status === "completed") && 
             !order.imaging_analysis &&
             user?.department === "영상의학과" && (
              <Button
                onClick={() => setShowAnalysisDialog(true)}
                size="sm"
                variant="default"
              >
                <Scan className="mr-2 h-4 w-4" />
                분석 결과 입력
              </Button>
            )}
            {/* 주문 생성자 또는 원무과만 취소 가능 */}
            {(order.status === "pending" || order.status === "sent") && (
              <Button
                onClick={() => {
                  const reason = prompt("취소 사유를 입력하세요:");
                  if (reason) onCancel(reason);
                }}
                size="sm"
                variant="destructive"
              >
                <XCircle className="mr-2 h-4 w-4" />
                취소
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      {/* 영상 분석 결과 입력 다이얼로그 */}
      {showAnalysisDialog && (
        <Dialog open={showAnalysisDialog} onOpenChange={(open) => {
          setShowAnalysisDialog(open);
          if (open) {
            // 유방촬영술일 때만 Orthanc 히트맵 이미지 가져오기
            const imagingType = order.order_data?.imaging_type || '';
            const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
            
            console.log("🔍 OCS 다이얼로그 열림:", {
              imaging_type: imagingType,
              is_mammography: isMammography,
              patient_id: order.patient_id,
              patient_number: order.patient_number,
            });
            
            // 유방촬영술일 때만 Orthanc에서 히트맵 이미지 가져오기
            if (isMammography) {
              const patientId = order.patient_id || order.patient_number;
              if (patientId) {
                fetchOrthancImages(patientId);
              } else {
                toast({
                  title: "환자 ID 없음",
                  description: "환자 ID를 찾을 수 없습니다.",
                  variant: "destructive",
                });
              }
            }
          } else {
            // 다이얼로그가 닫힐 때 상태 초기화
            setOrthancImages([]);
            setSelectedOrthancImages(new Set());
            setHeatmapImages([]);
            setImagePreviews(new Map());
          }
        }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>영상 분석 결과 입력</DialogTitle>
              <DialogDescription>
                {order.patient_name}님의 {order.order_data?.imaging_type} 영상 분석 결과를 입력하세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* 히트맵 이미지 선택 (유방촬영술일 때만 표시) */}
              {(() => {
                const imagingType = order.order_data?.imaging_type || '';
                const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
                
                if (!isMammography) {
                  // 유방촬영술이 아니면 히트맵 선택 UI 표시하지 않음
                  return null;
                }
                
                return (
                  <div>
                    <Label>종양 탐지 이미지 (Heatmap)</Label>
                    <div className="space-y-2">
                      {/* Orthanc에서 선택 버튼 */}
                      <div className="mb-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowOrthancSelector(!showOrthancSelector);
                        // 선택자를 열 때 히트맵 이미지가 없으면 다시 로드 시도 (유방촬영술일 때만)
                        const imagingType = order.order_data?.imaging_type || '';
                        const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
                        if (!showOrthancSelector && isMammography && orthancImages.length === 0) {
                          const patientId = order.patient_id || order.patient_number;
                          if (patientId && !isLoadingOrthancImages) {
                            console.log("🔄 히트맵 이미지 다시 로드 시도");
                            fetchOrthancImages(patientId);
                          }
                        }
                      }}
                      disabled={isLoadingOrthancImages}
                    >
                      {isLoadingOrthancImages ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          로딩 중...
                        </>
                      ) : showOrthancSelector ? (
                        "닫기"
                      ) : (
                        `Orthanc에서 선택${orthancImages.length > 0 ? ` (${orthancImages.length}개)` : ''}`
                      )}
                    </Button>
                    {showOrthancSelector && (
                      <div className="mt-2 border rounded-lg p-2 max-h-64 overflow-y-auto">
                        {isLoadingOrthancImages ? (
                          <div className="text-center py-4">
                            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                            <p className="text-xs text-muted-foreground">이미지 로딩 중...</p>
                          </div>
                        ) : orthancImages.length > 0 ? (
                          <>
                            <p className="text-xs text-muted-foreground mb-2">
                              Orthanc에 저장된 히트맵 이미지를 선택하세요 ({orthancImages.length}개, 여러 장 선택 가능):
                            </p>
                            {selectedOrthancImages.size > 0 && (
                              <p className="text-xs text-primary mb-2 font-medium">
                                선택됨: {selectedOrthancImages.size}장
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              {orthancImages.map((img: any) => {
                                const isSelected = selectedOrthancImages.has(img.instance_id);
                                return (
                                  <div
                                    key={img.instance_id}
                                    className={`relative border-2 rounded-lg p-2 cursor-pointer hover:bg-accent transition-all ${
                                      isSelected ? 'border-primary bg-primary/10' : 'border-gray-200'
                                    }`}
                                    onClick={() => handleOrthancImageToggle(img.instance_id, img.preview_url)}
                                  >
                                    {isSelected && (
                                      <div className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-1 z-10">
                                        <CheckCircle className="h-4 w-4" />
                                      </div>
                                    )}
                                    <img
                                      src={img.preview_url}
                                      alt={`Instance ${img.instance_id}`}
                                      className="w-full h-32 object-contain"
                                    />
                                    <p className="text-xs text-center mt-1">
                                      {img.series_description || 'Heatmap'}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="text-center py-4">
                            <p className="text-xs text-muted-foreground mb-2">
                              Orthanc에 저장된 히트맵 이미지를 찾을 수 없습니다.
                            </p>
                            <p className="text-xs text-muted-foreground mb-2">
                              환자 ID: <code className="bg-gray-100 px-1 rounded">{order.patient_number}</code>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              파일로 업로드하거나 AI 분석을 먼저 실행해주세요.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {/* 선택된 이미지 미리보기 */}
                  {selectedOrthancImages.size > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-muted-foreground mb-2">
                        선택된 히트맵 이미지 ({selectedOrthancImages.size}장):
                      </p>
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                        {Array.from(selectedOrthancImages).map((instanceId) => {
                          const previewUrl = imagePreviews.get(instanceId);
                          const imgInfo = orthancImages.find((img: any) => img.instance_id === instanceId);
                          return (
                            <div key={instanceId} className="relative border rounded-lg p-1">
                              <img
                                src={previewUrl}
                                alt={`Selected ${instanceId}`}
                                className="w-full h-24 object-contain"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="absolute top-0 right-0 h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOrthancImageToggle(instanceId, previewUrl || '');
                                }}
                              >
                                <XCircle className="h-4 w-4 text-destructive" />
                              </Button>
                              <p className="text-xs text-center mt-1 truncate">
                                {imgInfo?.series_description || 'Heatmap'}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                    </div>
                  </div>
                );
              })()}
              
              <div>
                <Label>소견</Label>
                <Textarea
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder={`영상 분석 소견을 입력하세요.

예시 항목:
• 종양 특성 (병변 크기, 위치, 모양 등)
• BI-RADS 등급 및 평가
• 석회화 유무 및 특성
• 유방 밀도 평가
• 비대칭성 또는 구조 왜곡 유무
• 추가 검사 필요 여부
• 임상적 의의`}
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label>권고사항</Label>
                <Textarea
                  value={recommendations}
                  onChange={(e) => setRecommendations(e.target.value)}
                  placeholder="권고사항을 입력하세요..."
                  rows={3}
                />
              </div>
              <div>
                <Label>신뢰도: {(confidenceScore * 100).toFixed(1)}%</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={confidenceScore}
                  onChange={(e) => setConfidenceScore(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAnalysisDialog(false)}>
                취소
              </Button>
              <Button onClick={handleCreateAnalysis} disabled={!findings.trim()}>
                분석 결과 저장
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 검사 결과 입력 다이얼로그 */}
      
      {/* 병리 분석 결과 입력 다이얼로그 (검사실용) */}
      {showPathologyInputDialog && selectedOrderForPathology && (
        <Dialog open={showPathologyInputDialog} onOpenChange={setShowPathologyInputDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>병리 분석 결과 입력 및 전달</DialogTitle>
              <DialogDescription>
                {selectedOrderForPathology.patient_name}님의 병리 분석 결과를 확인하고 메모를 추가한 후 의사에게 전달하세요.
              </DialogDescription>
            </DialogHeader>
            {selectedOrderForPathology.pathology_analysis ? (
              <div className="space-y-6">
                {/* AI 분석 결과 표시 */}
                <div className="border rounded-lg p-4 bg-purple-50">
                  <h3 className="font-semibold mb-4">AI 분석 결과</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={selectedOrderForPathology.pathology_analysis.class_name === 'Tumor' ? 'destructive' : 'default'} className="text-lg px-4 py-2">
                        {selectedOrderForPathology.pathology_analysis.class_name === 'Tumor' ? '종양 (Tumor)' : '정상 (Normal)'}
                      </Badge>
                      <span className="text-sm text-gray-600">
                        신뢰도: {(selectedOrderForPathology.pathology_analysis.confidence * 100).toFixed(2)}%
                      </span>
                    </div>
                    
                    <div>
                      <Label>클래스별 확률</Label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {Object.entries(selectedOrderForPathology.pathology_analysis.probabilities).map(([className, prob]: [string, any]) => (
                          <div key={className} className="bg-white p-2 rounded">
                            <div className="text-sm font-medium">{className}</div>
                            <div className="text-lg font-bold">{(prob * 100).toFixed(2)}%</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {selectedOrderForPathology.pathology_analysis.image_url && (
                      <div>
                        <Label>분석 이미지</Label>
                        <div className="mt-2">
                          <img 
                            src={selectedOrderForPathology.pathology_analysis.image_url} 
                            alt="병리 이미지"
                            className="max-w-full rounded border"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 소견 입력 */}
                <div>
                  <Label>소견</Label>
                  <Textarea
                    value={pathologyFindings}
                    onChange={(e) => setPathologyFindings(e.target.value)}
                    placeholder="AI 분석 결과를 바탕으로 소견을 입력하세요..."
                    rows={4}
                  />
                </div>

                {/* 권고사항 입력 */}
                <div>
                  <Label>권고사항</Label>
                  <Textarea
                    value={pathologyRecommendations}
                    onChange={(e) => setPathologyRecommendations(e.target.value)}
                    placeholder="권고사항을 입력하세요..."
                    rows={3}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-8 text-center">
                <AlertTriangle className="h-12 w-12 mx-auto text-yellow-500" />
                <h3 className="text-lg font-semibold">분석 결과가 없습니다</h3>
                <p className="text-sm text-gray-600">
                  병리 이미지 분석을 먼저 완료해주세요.
                </p>
                <Button
                  onClick={() => {
                    setShowPathologyInputDialog(false);
                    navigate('/pathology-analysis');
                  }}
                  className="mt-4"
                >
                  병리 이미지 분석 페이지로 이동
                </Button>
              </div>
            )}
            {selectedOrderForPathology.pathology_analysis && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => {
                  setShowPathologyInputDialog(false);
                  setPathologyFindings('');
                  setPathologyRecommendations('');
                  setSelectedOrderForPathology(null);
                }}>
                  취소
                </Button>
                <Button 
                  onClick={() => {
                    if (onInputPathologyResult && selectedOrderForPathology) {
                      onInputPathologyResult({
                        findings: pathologyFindings,
                        recommendations: pathologyRecommendations,
                      });
                      setShowPathologyInputDialog(false);
                      setPathologyFindings('');
                      setPathologyRecommendations('');
                      setSelectedOrderForPathology(null);
                    }
                  }}
                  disabled={isInputtingPathologyResult}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {isInputtingPathologyResult ? "전달 중..." : "완료 전달"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* 병리 분석 결과 다이얼로그 (의사용) */}
      {showPathologyResultDialog && selectedOrderForPathology && selectedOrderForPathology.pathology_analysis && (
        <Dialog open={showPathologyResultDialog} onOpenChange={setShowPathologyResultDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>병리 분석 결과</DialogTitle>
              <DialogDescription>
                {selectedOrderForPathology.patient_name}님의 병리 이미지 분석 결과입니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              {/* 환자 정보 */}
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">환자 정보</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-gray-600">환자명:</span> {selectedOrderForPathology.patient_name}</div>
                  <div><span className="text-gray-600">환자 ID:</span> {selectedOrderForPathology.patient_id}</div>
                  <div><span className="text-gray-600">분석일:</span> {new Date(selectedOrderForPathology.pathology_analysis.created_at).toLocaleString('ko-KR')}</div>
                  <div><span className="text-gray-600">검사자:</span> {selectedOrderForPathology.pathology_analysis.analyzed_by_name || '시스템'}</div>
                </div>
              </div>

              {/* 분석 결과 */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-4">AI 분석 결과</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedOrderForPathology.pathology_analysis.class_name === 'Tumor' ? 'destructive' : 'default'} className="text-lg px-4 py-2">
                      {selectedOrderForPathology.pathology_analysis.class_name === 'Tumor' ? '종양 (Tumor)' : '정상 (Normal)'}
                    </Badge>
                    <span className="text-sm text-gray-600">
                      신뢰도: {(selectedOrderForPathology.pathology_analysis.confidence * 100).toFixed(2)}%
                    </span>
                  </div>
                  
                  <div>
                    <Label>클래스별 확률</Label>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      {Object.entries(selectedOrderForPathology.pathology_analysis.probabilities).map(([className, prob]: [string, any]) => (
                        <div key={className} className="bg-gray-50 p-2 rounded">
                          <div className="text-sm font-medium">{className}</div>
                          <div className="text-lg font-bold">{(prob * 100).toFixed(2)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedOrderForPathology.pathology_analysis.findings && (
                    <div>
                      <Label>소견</Label>
                      <p className="text-sm text-gray-700 mt-1">{selectedOrderForPathology.pathology_analysis.findings}</p>
                    </div>
                  )}

                  {selectedOrderForPathology.pathology_analysis.recommendations && (
                    <div>
                      <Label>권고사항</Label>
                      <p className="text-sm text-gray-700 mt-1">{selectedOrderForPathology.pathology_analysis.recommendations}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 이미지 정보 */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold mb-2">이미지 정보</h3>
                <div className="text-sm text-gray-600">
                  <div>파일명: {selectedOrderForPathology.pathology_analysis.filename}</div>
                  {selectedOrderForPathology.pathology_analysis.image_url && (
                    <div className="mt-2">
                      <img 
                        src={selectedOrderForPathology.pathology_analysis.image_url} 
                        alt="병리 이미지"
                        className="max-w-full rounded border"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => {
                setShowPathologyResultDialog(false);
                setSelectedOrderForPathology(null);
              }}>
                닫기
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showLabResultDialog && (
        <Dialog open={showLabResultDialog} onOpenChange={setShowLabResultDialog}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>검사 결과 입력</DialogTitle>
              <DialogDescription>
                {order.patient_name}님의 검사 결과를 입력하세요. AI 분석 결과를 포함할 수 있습니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* RNA 검사 선택 및 pCR 예측 */}
              <div className="border rounded-lg p-4 bg-purple-50">
                <Label className="text-base font-semibold mb-2 block">AI 분석 (선택사항)</Label>
                <LabResultAISection
                  patientId={order.patient_id || order.patient_number || ''}
                  existingResult={order.lab_test_result}
                  onPCRResult={(result) => {
                    setLabAiFindings(result.prediction === 'Positive' ? '양성 (Positive)' : '음성 (Negative)');
                    setLabAiConfidence(result.probability);
                    setLabAiReportImage(result.image || '');
                    setLabAiPrediction(result.prediction || '');
                    toast({
                      title: "AI 분석 완료",
                      description: `pCR 예측 확률: ${(result.probability * 100).toFixed(1)}%`,
                    });
                  }}
                />
              </div>

              {/* 검사 결과 데이터 */}
              <div>
                <Label>검사 결과 데이터 (JSON)</Label>
                <Textarea
                  value={JSON.stringify(labTestResults, null, 2)}
                  onChange={(e) => {
                    try {
                      setLabTestResults(JSON.parse(e.target.value));
                    } catch {
                      // JSON 파싱 실패 시 무시
                    }
                  }}
                  placeholder='{"wbc": 7.5, "hemoglobin": 14.2, ...}'
                  rows={6}
                  className="font-mono text-sm"
                />
              </div>

              {/* AI 소견 */}
              <div>
                <Label>AI 소견</Label>
                <Textarea
                  value={labAiFindings}
                  onChange={(e) => setLabAiFindings(e.target.value)}
                  placeholder="AI 분석 소견을 입력하세요..."
                  rows={3}
                />
              </div>

              {/* AI 신뢰도 */}
              <div>
                <Label>AI 신뢰도: {(labAiConfidence * 100).toFixed(1)}%</Label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={labAiConfidence}
                  onChange={(e) => setLabAiConfidence(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* AI 리포트 이미지 미리보기 */}
              {labAiReportImage && (
                <div>
                  <Label>AI 임상 리포트</Label>
                  <div className="border rounded-lg p-2 bg-white">
                    <img
                      src={`data:image/png;base64,${labAiReportImage}`}
                      alt="AI Clinical Report"
                      className="w-full rounded"
                    />
                  </div>
                </div>
              )}

              {/* 추가 메모 */}
              <div>
                <Label>추가 메모</Label>
                <Textarea
                  value={labTestResults.notes || ''}
                  onChange={(e) => setLabTestResults({ ...labTestResults, notes: e.target.value })}
                  placeholder="추가 메모를 입력하세요..."
                  rows={3}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setShowLabResultDialog(false);
                setLabTestResults({});
                setLabAiFindings("");
                setLabAiConfidence(0);
                setLabAiReportImage("");
                setLabAiPrediction("");
              }}>
                취소
              </Button>
              <Button 
                onClick={() => {
                  if (onInputLabResult) {
                    onInputLabResult({
                      test_results: labTestResults,
                      ai_findings: labAiFindings,
                      ai_confidence_score: labAiConfidence,
                      ai_report_image: labAiReportImage,
                      ai_prediction: labAiPrediction,
                      notes: labTestResults.notes || '',
                    });
                    setShowLabResultDialog(false);
                    setLabTestResults({});
                    setLabAiFindings("");
                    setLabAiConfidence(0);
                    setLabAiReportImage("");
                    setLabAiPrediction("");
                  }
                }}
                disabled={isInputtingLabResult}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isInputtingLabResult ? "입력 중..." : "결과 저장"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

// 검사 결과 AI 분석 섹션 컴포넌트
function LabResultAISection({ patientId, onPCRResult, existingResult }: { patientId: string; onPCRResult: (result: any) => void; existingResult?: any }) {
  const [rnaTests, setRNATests] = useState<any[]>([]);
  const [selectedRNATest, setSelectedRNATest] = useState<any>(null);
  const [predicting, setPredicting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (patientId) {
      loadRNATests();
    }
  }, [patientId]);

  useEffect(() => {
    // 기존 결과가 있으면 자동으로 로드
    if (existingResult && existingResult.ai_report_image) {
      onPCRResult({
        prediction: existingResult.ai_prediction === 'Positive' ? 'Positive' : 'Negative',
        probability: existingResult.ai_confidence_score || 0,
        image: existingResult.ai_report_image,
      });
    }
  }, [existingResult]);

  const loadRNATests = async () => {
    try {
      const data = await getRNATestsApi({ search: patientId });
      setRNATests(data.results || data);
      if (data.results && data.results.length > 0) {
        setSelectedRNATest(data.results[0]);
      }
    } catch (error) {
      console.error('Failed to load RNA tests:', error);
    }
  };

  const handlePCRPredict = async () => {
    if (!selectedRNATest) {
      toast({
        title: 'RNA 검사 선택 필요',
        description: 'pCR 예측을 위해 RNA 검사를 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setPredicting(true);
    try {
      const result = await predictPCRApi(selectedRNATest.id);
      onPCRResult(result);
    } catch (error: any) {
      toast({
        title: 'pCR 예측 실패',
        description: error?.response?.data?.error || 'pCR 예측 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setPredicting(false);
    }
  };

  return (
    <div className="space-y-3">
      {existingResult && existingResult.ai_report_image ? (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-semibold text-green-800 mb-2">✓ 저장된 분석 결과가 있습니다</p>
          <p className="text-xs text-green-700">
            소견: {existingResult.ai_findings || 'N/A'}<br/>
            신뢰도: {existingResult.ai_confidence_score ? (existingResult.ai_confidence_score * 100).toFixed(1) + '%' : 'N/A'}
          </p>
        </div>
      ) : rnaTests.length > 0 ? (
        <>
          <Select value={selectedRNATest?.id?.toString()} onValueChange={(value) => {
            const test = rnaTests.find(t => t.id.toString() === value);
            setSelectedRNATest(test);
          }}>
            <SelectTrigger>
              <SelectValue placeholder="RNA 검사 선택" />
            </SelectTrigger>
            <SelectContent>
              {rnaTests.map((test) => (
                <SelectItem key={test.id} value={test.id.toString()}>
                  {test.accession_number} - {test.patient_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handlePCRPredict}
            disabled={!selectedRNATest || predicting}
            size="sm"
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {predicting ? "예측 중..." : "pCR 예측 실행"}
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">해당 환자의 RNA 검사 데이터가 없습니다.</p>
      )}
    </div>
  );
}

function CreateOrderForm({
  selectedPatient,
  setSelectedPatient,
  patientSearchTerm,
  setPatientSearchTerm,
  patients,
  isSearchingPatients,
  onSubmit,
  isLoading,
}: {
  selectedPatient: any;
  setSelectedPatient: (patient: any) => void;
  patientSearchTerm: string;
  setPatientSearchTerm: (term: string) => void;
  patients: any[];
  isSearchingPatients: boolean;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [orderType, setOrderType] = useState<string>("prescription");
  const [priority, setPriority] = useState<string>("routine");
  const [targetDepartment, setTargetDepartment] = useState<string>("admin");
  const [medications, setMedications] = useState<Array<{ 
    name: string; 
    dosage: string; 
    frequency: string; 
    duration: string;
    item_seq?: string;
    drug?: Drug;
  }>>([]);
  const [imagingData, setImagingData] = useState({ imaging_type: "", body_part: "", contrast: false });
  const [notes, setNotes] = useState("");
  const [dueTime, setDueTime] = useState("");
  
  // 약물 검색 인라인 상태
  const [drugQuery, setDrugQuery] = useState("");
  const [showDrugResults, setShowDrugResults] = useState(false);
  const [searchResults, setSearchResults] = useState<Drug[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // 약물 상호작용 검사 상태
  const [interactionResult, setInteractionResult] = useState<DrugInteractionResult | null>(null);
  const [isCheckingInteractions, setIsCheckingInteractions] = useState(false);

  // 자동완성: 입력 시 자동 검색 (debounce)
  useEffect(() => {
    if (!drugQuery.trim()) {
      setShowDrugResults(false);
      setSearchResults([]);
      return;
    }

    // 500ms 후 자동 검색
    const timeoutId = setTimeout(() => {
      handleDrugSearch();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [drugQuery]);

  // 약물 검색 핸들러
  const handleDrugSearch = async (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!drugQuery.trim()) {
      setShowDrugResults(false);
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setShowDrugResults(true);

    try {
      console.log("🔍 약물 검색 시작:", drugQuery.trim());
      const drugs = await searchDrugsApi(drugQuery.trim(), 15);
      console.log("✅ 약물 검색 성공:", drugs);
      if (Array.isArray(drugs)) {
        setSearchResults(drugs);
      } else {
        console.error("⚠️ 검색 결과가 배열이 아닙니다:", drugs);
        setSearchResults([]);
        toast({
          title: "검색 오류",
          description: "검색 결과 형식이 올바르지 않습니다.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error("❌ 약물 검색 오류:", error);
      console.error("에러 상세:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        url: error.config?.url,
      });
      setSearchResults([]);
      toast({
        title: "약물 검색 실패",
        description: error.response?.data?.error || error.response?.data?.details || error.message || "약물 검색에 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsSearching(false);
    }
  };

  const addDrug = (drug: Drug) => {
    if (!medications.find((m) => m.item_seq === drug.item_seq)) {
      setMedications([
        ...medications,
        {
          name: drug.name_kor,
          dosage: "",
          frequency: "",
          duration: "",
          item_seq: drug.item_seq,
          drug: drug,
        },
      ]);
    }
    setDrugQuery("");
    setShowDrugResults(false);
  };

  const removeDrug = (itemSeq: string) => {
    setMedications(medications.filter((m) => m.item_seq !== itemSeq));
  };

  // 약물 상호작용 자동 검사 (debounce 적용, 주문 생성 시에는 체크하지 않음)
  useEffect(() => {
    // 주문 생성 중이면 상호작용 체크 스킵 (빠른 생성)
    if (isLoading) {
      return;
    }
    
    if (orderType === "prescription" && medications.length >= 2) {
      const validDrugs = medications.filter((m) => m.item_seq);
      if (validDrugs.length >= 2) {
        // Debounce: 약물 추가 후 1.5초 후에 체크 (더 긴 대기 시간)
        const timeoutId = setTimeout(() => {
          checkInteractions(validDrugs.map((m) => m.item_seq!));
        }, 1500);
        
        return () => clearTimeout(timeoutId);
      } else {
        setInteractionResult(null);
      }
    } else {
      setInteractionResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medications, orderType, isLoading]);

  const checkInteractions = async (itemSeqs: string[]) => {
    if (itemSeqs.length < 2) return;
    
    setIsCheckingInteractions(true);
    try {
      const result = await checkDrugInteractionsApi(itemSeqs);
      setInteractionResult(result);
    } catch (error) {
      console.error("약물 상호작용 검사 오류:", error);
      setInteractionResult(null);
    } finally {
      setIsCheckingInteractions(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 약물 상호작용 체크 중이면 대기
    if (isCheckingInteractions) {
      toast({
        title: "약물 상호작용 검사 중",
        description: "약물 상호작용 검사가 완료될 때까지 기다려주세요.",
        variant: "default",
      });
      return;
    }

    let orderData: any = {};
    let department = targetDepartment;

    if (orderType === "prescription") {
      const validMedications = medications.filter((m) => m.name.trim());
      if (validMedications.length === 0) {
        alert("최소 하나의 약물 정보를 입력해주세요.");
        return;
      }
      // 약물 정보에 item_seq 포함
      orderData = { 
        medications: validMedications.map((m) => ({
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          duration: m.duration,
          item_seq: m.item_seq, // 약물 검색에서 선택한 경우 item_seq 포함
        }))
      };
      department = "admin";
    } else if (orderType === "lab_test") {
      if (!imagingData.imaging_type) {
        toast({
          title: "검사 유형 선택 필요",
          description: "검사 유형을 선택해주세요.",
          variant: "destructive",
        });
        return;
      }
      orderData = { 
        test_type: imagingData.imaging_type, // 혈액검사 또는 rna 검사
      };
      department = "lab";
    } else if (orderType === "imaging") {
      // 촬영 유형 필수 체크
      if (!imagingData.imaging_type || !imagingData.imaging_type.trim()) {
        alert("촬영 유형을 선택해주세요.");
        return;
      }
      // 촬영 부위 필수 체크
      if (!imagingData.body_part || !imagingData.body_part.trim()) {
        alert("촬영 부위를 입력해주세요.");
        return;
      }
      orderData = {
        imaging_type: imagingData.imaging_type,
        body_part: imagingData.body_part,
        contrast: imagingData.contrast || false,
      };
      department = "radiology";
    } else if (orderType === "tissue_exam") {
      // 촬영 유형 필수 체크
      if (!imagingData.imaging_type || !imagingData.imaging_type.trim()) {
        alert("촬영 유형을 선택해주세요.");
        return;
      }
      // 촬영 부위 필수 체크
      if (!imagingData.body_part || !imagingData.body_part.trim()) {
        alert("촬영 부위를 입력해주세요.");
        return;
      }
      orderData = {
        imaging_type: imagingData.imaging_type,
        body_part: imagingData.body_part,
      };
      department = "lab";
    }

    onSubmit({
      order_type: orderType,
      order_data: orderData,
      target_department: department,
      priority,
      notes,
      due_time: dueTime || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* 환자 선택 */}
      <div className="space-y-2">
        <Label>환자 검색</Label>
        <Input
          placeholder="환자명 또는 환자번호로 검색..."
          value={patientSearchTerm}
          onChange={(e) => setPatientSearchTerm(e.target.value)}
        />
        {isSearchingPatients && <p className="text-sm text-muted-foreground">검색 중...</p>}
        {patients && patients.length > 0 && (
          <div className="border rounded-lg p-2 max-h-40 overflow-y-auto">
            {patients.map((patient: any) => (
              <div
                key={patient.id || patient.patient_id}
                className="p-2 hover:bg-accent rounded cursor-pointer"
                onClick={() => {
                  setSelectedPatient(patient);
                  setPatientSearchTerm("");
                }}
              >
                {patient.name} ({patient.patient_id || patient.patient_number})
              </div>
            ))}
          </div>
        )}
        {selectedPatient && (
          <div className="p-2 bg-accent rounded">
            선택된 환자: {selectedPatient.name} ({selectedPatient.patient_id || selectedPatient.patient_number})
          </div>
        )}
      </div>

      {/* 주문 유형 */}
      <div className="space-y-2">
        <Label>주문 유형</Label>
        <Select value={orderType} onValueChange={(value) => {
          setOrderType(value);
          if (value === "prescription") setTargetDepartment("admin");
          else if (value === "lab_test") setTargetDepartment("lab");
          else if (value === "imaging") setTargetDepartment("radiology");
          else if (value === "tissue_exam") setTargetDepartment("lab");
          // 주문 유형 변경 시 imagingData 초기화
          setImagingData({ imaging_type: "", body_part: "", contrast: false });
        }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* 의료진(외과, 호흡기내과 등)은 모든 주문 유형 생성 가능 */}
            <SelectItem value="prescription">처방전</SelectItem>
            <SelectItem value="lab_test">검사</SelectItem>
            <SelectItem value="imaging">영상촬영</SelectItem>
            <SelectItem value="tissue_exam">조직검사</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 주문 내용 */}
      {orderType === "prescription" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
          <Label>약물 정보</Label>
            {medications.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {medications.length}개 선택됨
              </span>
            )}
          </div>
          
          {/* 약물 검색 입력 필드 */}
          <div className="relative">
            <form 
              onSubmit={handleDrugSearch}
              action="#"
              method="get"
              className="flex gap-2"
              onBlur={(e) => {
                // 드롭다운 외부 클릭 시 닫기 (약간의 딜레이로 클릭 이벤트 처리)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setTimeout(() => setShowDrugResults(false), 200);
                }
              }}
            >
              <Input
                id="drug-search-input"
                name="drug-search"
                type="text"
                placeholder="약물명 / 성분명 검색 (Enter)..."
                value={drugQuery}
                onChange={(e) => {
                  const value = e.target.value;
                  setDrugQuery(value);
                  if (!value.trim()) {
                    setShowDrugResults(false);
                    setSearchResults([]);
                  } else {
                    setShowDrugResults(true);
                  }
                }}
                onFocus={() => {
                  if (drugQuery.trim() && searchResults.length > 0) {
                    setShowDrugResults(true);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDrugSearch(e as any);
                  }
                }}
                className="flex-1"
                autoComplete="off"
              />
              <Button 
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrugSearch();
                }}
                disabled={isSearching}
              >
                {isSearching ? "검색 중..." : "검색"}
              </Button>
            </form>

            {/* 검색 결과 드롭다운 */}
            {showDrugResults && (drugQuery.trim() || searchResults.length > 0) && (
              <div 
                className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto"
                onMouseDown={(e) => {
                  // 드롭다운 내부 클릭 시 닫히지 않도록
                  e.preventDefault();
                }}
              >
                {isSearching && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    검색 중...
                  </div>
                )}
                {!isSearching && searchResults.length === 0 && drugQuery.trim() && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    검색 결과가 없습니다.
                  </div>
                )}
                {!isSearching && searchResults.map((drug) => (
                  <div
                    key={drug.item_seq}
                    onClick={() => {
                      addDrug(drug);
                      setShowDrugResults(false);
                      setDrugQuery("");
                    }}
                    className="p-3 border-b cursor-pointer hover:bg-accent transition-colors"
                  >
                    <div className="font-semibold text-sm">{drug.name_kor}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {drug.company_name} | EDI: {drug.edi_code}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 선택된 약물 목록 */}
          <div className="space-y-2 mt-4">
            {medications.map((med, idx) => (
              <div
                key={med.item_seq || idx}
                className="flex items-start gap-2 p-3 bg-accent rounded-lg border"
              >
                <div className="flex-1 space-y-2">
                  <div className="font-semibold text-sm">{med.name}</div>
                  <div className="grid grid-cols-3 gap-2">
              <Input
                      id={`med-dosage-${idx}`}
                      name={`med-dosage-${idx}`}
                placeholder="용량"
                value={med.dosage}
                onChange={(e) => {
                  const newMeds = [...medications];
                  newMeds[idx].dosage = e.target.value;
                  setMedications(newMeds);
                }}
                      className="text-sm"
              />
              <Input
                      id={`med-frequency-${idx}`}
                      name={`med-frequency-${idx}`}
                placeholder="용법"
                value={med.frequency}
                onChange={(e) => {
                  const newMeds = [...medications];
                  newMeds[idx].frequency = e.target.value;
                  setMedications(newMeds);
                }}
                      className="text-sm"
              />
              <Input
                      id={`med-duration-${idx}`}
                      name={`med-duration-${idx}`}
                placeholder="기간"
                value={med.duration}
                onChange={(e) => {
                  const newMeds = [...medications];
                  newMeds[idx].duration = e.target.value;
                  setMedications(newMeds);
                }}
                      className="text-sm"
              />
            </div>
                </div>
          <Button
            type="button"
                  variant="ghost"
            size="sm"
                  onClick={() => removeDrug(med.item_seq!)}
                  className="text-destructive hover:text-destructive"
          >
                  <XCircle className="h-4 w-4" />
          </Button>
              </div>
            ))}
          </div>
          
          {/* 약물 상호작용 경고 */}
          {medications.length >= 2 && (
            <div className="mt-4">
              {isCheckingInteractions ? (
                <div className="p-3 bg-gray-50 rounded-lg text-center text-sm text-muted-foreground">
                  💊 약물 상호작용 분석 중...
                </div>
              ) : interactionResult && (interactionResult.has_critical || interactionResult.has_warnings) ? (
                <div
                  className={`p-4 rounded-lg border-2 ${
                    interactionResult.has_critical
                      ? "bg-red-50 border-red-200"
                      : "bg-yellow-50 border-yellow-200"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle
                      className={`h-5 w-5 ${
                        interactionResult.has_critical ? "text-red-600" : "text-yellow-600"
                      }`}
                    />
                    <h4
                      className={`font-bold text-sm ${
                        interactionResult.has_critical ? "text-red-800" : "text-yellow-800"
                      }`}
                    >
                      {interactionResult.has_critical
                        ? `치명적인 병용금기 ${interactionResult.total_interactions}건 발견!`
                        : `병용금기 ${interactionResult.total_interactions}건 발견!`}
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {interactionResult.interactions.map((inter, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded border-l-4 ${
                          inter.severity === "CRITICAL"
                            ? "bg-red-100 border-red-500"
                            : "bg-yellow-100 border-yellow-500"
                        }`}
                      >
                        <div className="font-semibold text-sm mb-2">
                          {inter.warning_message.split('\n')[0]}
                        </div>
                        {inter.warning_message.includes('AI 분석:') ? (
                          <div className="text-xs text-gray-700 mb-2 whitespace-pre-wrap pl-2 border-l-2 border-red-400">
                            {inter.warning_message.split('AI 분석:')[1]?.trim()}
                          </div>
                        ) : inter.ai_analysis && inter.ai_analysis.summary ? (
                          <div className="text-xs text-gray-700 mb-2 whitespace-pre-wrap pl-2 border-l-2 border-red-400">
                            {inter.ai_analysis.summary}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-700 mb-2 whitespace-pre-wrap">
                            {inter.warning_message.split('\n').slice(1).join('\n') || inter.interaction_type || '병용금기 (DUR 경고)'}
                          </div>
                        )}
                        {inter.ai_analysis && inter.ai_analysis.recommendation && (
                          <div className="text-xs text-gray-600 mt-2">
                            <span className="font-medium">권고:</span> {inter.ai_analysis.recommendation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : interactionResult && !interactionResult.has_warnings ? (
                <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center text-sm text-green-800">
                  ✅ 약물 상호작용 검사 완료 - 문제 없음
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {orderType === "lab_test" && (
        <div>
          <Label>검사 유형 *</Label>
          <Select
            value={imagingData.imaging_type || ""}
            onValueChange={(value) => setImagingData({ ...imagingData, imaging_type: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="검사 유형 선택" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blood">혈액검사</SelectItem>
              <SelectItem value="rna">RNA 검사</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {orderType === "imaging" && (
        <div className="space-y-2">
          <Label>촬영 정보</Label>
          <Select
            value={imagingData.imaging_type}
            onValueChange={(value) => setImagingData({ ...imagingData, imaging_type: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="촬영 유형" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="유방촬영술">유방촬영술</SelectItem>
              <SelectItem value="MRI">MRI</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="촬영 부위"
            value={imagingData.body_part}
            onChange={(e) => setImagingData({ ...imagingData, body_part: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="contrast"
              checked={imagingData.contrast}
              onChange={(e) => setImagingData({ ...imagingData, contrast: e.target.checked })}
            />
            <Label htmlFor="contrast">조영제 사용</Label>
          </div>
        </div>
      )}

      {orderType === "tissue_exam" && (
        <div className="space-y-2">
          <Label>촬영 정보</Label>
          <Select
            value={imagingData.imaging_type}
            onValueChange={(value) => setImagingData({ ...imagingData, imaging_type: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="촬영 유형" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="병리 이미지 촬영">병리 이미지 촬영</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="촬영 부위"
            value={imagingData.body_part}
            onChange={(e) => setImagingData({ ...imagingData, body_part: e.target.value })}
          />
        </div>
      )}

      {/* 우선순위 */}
      <div className="space-y-2">
        <Label>우선순위</Label>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="routine">일반</SelectItem>
            <SelectItem value="urgent">긴급</SelectItem>
            <SelectItem value="stat">즉시</SelectItem>
            <SelectItem value="emergency">응급</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 완료 기한 */}
      <div className="space-y-2">
        <Label>완료 기한 (선택)</Label>
        <Input
          type="datetime-local"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
        />
      </div>

      {/* 메모 */}
      <div className="space-y-2">
        <Label>메모</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="추가 메모를 입력하세요..."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={isLoading || !selectedPatient}>
          {isLoading ? "생성 중..." : "주문 생성"}
        </Button>
      </div>
    </form>
  );
}
