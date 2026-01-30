import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Brain, 
  Upload, 
  Dna,
  Activity,
  FileText,
  Loader2,
  Search,
  User,
  Calendar,
  FlaskConical
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  uploadLabTestCsvApi,
  uploadRNATestCsvApi,
  predictPCRApi,
  getRNATestsApi,
  getOrdersApi,
} from '@/lib/api';

interface RNATest {
  id: number;
  accession_number: string;
  patient_name: string;
  patient_id: string;
  patient_age: number;
  patient_gender: string;
  test_date: string;
  [key: string]: any;
}

interface Order {
  id: string;
  patient_name: string;
  patient_id: string;
  patient_number: string;
  order_data: any;
  status: string;
  created_at: string;
  lab_test_result?: any;
}

const GENE_NAMES = [
  'CXCL13', 'CD8A', 'CCR7', 'C1QA', 'LY9', 'CXCL10', 'CXCL9', 'STAT1',
  'CCND1', 'MKI67', 'TOP2A', 'BRCA1', 'RAD51', 'PRKDC', 'POLD3', 'POLB',
  'LIG1', 'ERBB2', 'ESR1', 'PGR', 'ARAF', 'PIK3CA', 'AKT1', 'MTOR',
  'TP53', 'PTEN', 'MYC'
];

const GENE_PATHWAYS: Record<string, string> = {
  'CXCL13': '면역 (Immune)',
  'CD8A': '면역 (Immune)',
  'CCR7': '면역 (Immune)',
  'C1QA': '면역 (Immune)',
  'LY9': '면역 (Immune)',
  'CXCL10': '면역 (Immune)',
  'CXCL9': '면역 (Immune)',
  'STAT1': '면역 (Immune)',
  'CCND1': '세포증식 (Proliferation)',
  'MKI67': '세포증식 (Proliferation)',
  'TOP2A': '세포증식 (Proliferation)',
  'BRCA1': 'DNA 복구 (DNA Repair)',
  'RAD51': 'DNA 복구 (DNA Repair)',
  'PRKDC': 'DNA 복구 (DNA Repair)',
  'POLD3': 'DNA 복구 (DNA Repair)',
  'POLB': 'DNA 복구 (DNA Repair)',
  'LIG1': 'DNA 복구 (DNA Repair)',
  'ERBB2': 'HER2 수용체',
  'ESR1': '호르몬 수용체 (ER/PR)',
  'PGR': '호르몬 수용체 (ER/PR)',
  'ARAF': '신호전달 (AKT/mTOR)',
  'PIK3CA': '신호전달 (AKT/mTOR)',
  'AKT1': '신호전달 (AKT/mTOR)',
  'MTOR': '신호전달 (AKT/mTOR)',
  'TP53': '신호전달 (AKT/mTOR)',
  'PTEN': '신호전달 (AKT/mTOR)',
  'MYC': '신호전달 (AKT/mTOR)',
};

export default function LaboratoryAIAnalysis() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [rnaTests, setRNATests] = useState<RNATest[]>([]);
  const [selectedRNATest, setSelectedRNATest] = useState<RNATest | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pcrPrediction, setPcrPrediction] = useState<any>(null);
  const [predictingPCR, setPredictingPCR] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    if (selectedOrder) {
      const patientId = selectedOrder.patient_id || selectedOrder.patient_number;
      if (patientId) {
        loadRNATestsForPatient(patientId);
      }
    } else {
      // 주문이 선택되지 않으면 RNA 테스트 목록 초기화
      setRNATests([]);
      setSelectedRNATest(null);
    }
  }, [selectedOrder]);

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      // 검사 주문 중 처리 중(processing) 상태인 것만 가져오기
      // 의사가 전달을 누르고 검사실에서 처리 시작을 누른 주문만 표시
      const data = await getOrdersApi({
        order_type: 'lab_test',
        target_department: 'lab',
        status: 'processing',  // 처리 중 상태만
      });
      // 결과가 아직 입력되지 않은 주문만 필터링
      setOrders((data.results || data).filter((order: Order) => !order.lab_test_result));
    } catch (error) {
      console.error('Failed to load orders:', error);
      toast({
        title: '주문 목록 로드 실패',
        description: '검사 주문 목록을 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadRNATestsForPatient = async (patientId: string) => {
    if (!patientId) {
      console.warn('loadRNATestsForPatient: patientId가 없습니다');
      return;
    }
    
    try {
      console.log('Loading RNA tests for patient:', patientId);
      const data = await getRNATestsApi({ search: patientId });
      const tests = data.results || data || [];
      console.log('Loaded RNA tests:', tests.length, tests);
      setRNATests(tests);
      if (tests.length > 0) {
        setSelectedRNATest(tests[0]);
      } else {
        setSelectedRNATest(null);
        console.warn('RNA 테스트 데이터를 찾을 수 없습니다. patientId:', patientId);
      }
    } catch (error) {
      console.error('Failed to load RNA tests:', error);
      toast({
        title: 'RNA 테스트 로드 실패',
        description: 'RNA 테스트 데이터를 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleLabTestUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedOrder) {
      toast({
        title: '환자 선택 필요',
        description: '먼저 검사 주문을 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      // 선택한 환자의 patient_id를 함께 전송
      // OCS 주문에서 patient_id 또는 patient_number 가져오기
      const patientId = selectedOrder.patient_id || selectedOrder.patient_number;
      
      if (!patientId) {
        toast({
          title: '환자 ID 없음',
          description: '선택한 주문에 환자 ID가 없습니다. 주문을 다시 선택해주세요.',
          variant: 'destructive',
        });
        return;
      }
      
      console.log('Uploading lab test with patientId:', patientId, 'Order:', {
        id: selectedOrder.id,
        patient_name: selectedOrder.patient_name,
        patient_id: selectedOrder.patient_id,
        patient_number: selectedOrder.patient_number,
      });
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patient_id', patientId);
      formData.append('order_id', selectedOrder.id);  // OCS 주문 ID도 함께 전송
      
      // FormData 내용 확인 (디버깅용)
      console.log('FormData entries:');
      for (const [key, value] of formData.entries()) {
        console.log(`  ${key}:`, value instanceof File ? `File(${value.name})` : value);
      }
      
      const result = await uploadLabTestCsvApi(formData);
      
      // 업로드 결과 확인
      if (result.errors && result.errors.length > 0) {
        toast({
          title: '업로드 완료 (일부 오류)',
          description: `${result.created}개 생성, ${result.updated}개 업데이트, ${result.errors.length}개 오류`,
          variant: 'destructive',
        });
        console.error('Upload errors:', result.errors);
      } else {
        toast({
          title: '업로드 성공',
          description: `${result.created}개 생성, ${result.updated}개 업데이트`,
        });
      }
      
      // 업로드 후 잠시 대기 후 데이터 다시 로드
      setTimeout(async () => {
        await loadRNATestsForPatient(patientId);
      }, 500);
    } catch (error: any) {
      toast({
        title: '업로드 실패',
        description: error?.response?.data?.error || '파일 업로드 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleRNATestUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedOrder) {
      toast({
        title: '환자 선택 필요',
        description: '먼저 검사 주문을 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      // 선택한 환자의 patient_id를 함께 전송
      // OCS 주문에서 patient_id 또는 patient_number 가져오기
      const patientId = selectedOrder.patient_id || selectedOrder.patient_number;
      
      if (!patientId) {
        toast({
          title: '환자 ID 없음',
          description: '선택한 주문에 환자 ID가 없습니다. 주문을 다시 선택해주세요.',
          variant: 'destructive',
        });
        return;
      }
      
      console.log('Uploading RNA test with patientId:', patientId, 'Order:', {
        id: selectedOrder.id,
        patient_name: selectedOrder.patient_name,
        patient_id: selectedOrder.patient_id,
        patient_number: selectedOrder.patient_number,
      });
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patient_id', patientId);
      formData.append('order_id', selectedOrder.id);  // OCS 주문 ID도 함께 전송
      
      // FormData 내용 확인 (디버깅용)
      console.log('FormData entries:');
      for (const [key, value] of formData.entries()) {
        console.log(`  ${key}:`, value instanceof File ? `File(${value.name})` : value);
      }
      
      const result = await uploadRNATestCsvApi(formData);
      
      // 업로드 결과 확인
      if (!result.success || (result.errors && result.errors.length > 0 && result.created === 0 && result.updated === 0)) {
        const errorMessage = result.error || result.errors?.[0] || '알 수 없는 오류';
        toast({
          title: '업로드 실패',
          description: `오류: ${errorMessage}\n${result.created || 0}개 생성, ${result.updated || 0}개 업데이트`,
          variant: 'destructive',
        });
        console.error('Upload failed:', result);
        return;
      } else if (result.errors && result.errors.length > 0) {
        // 일부 오류가 있지만 일부는 성공한 경우
        toast({
          title: '업로드 완료 (일부 오류)',
          description: `${result.created}개 생성, ${result.updated}개 업데이트, ${result.errors.length}개 오류`,
          variant: 'destructive',
        });
        console.warn('Upload completed with errors:', result.errors);
      } else if (result.created === 0 && result.updated === 0) {
        toast({
          title: '업로드 실패',
          description: '데이터가 생성되거나 업데이트되지 않았습니다. CSV 파일 형식과 patient_id를 확인해주세요.',
          variant: 'destructive',
        });
        console.error('No data created or updated:', result);
        return;
      } else {
        toast({
          title: 'RNA 업로드 성공',
          description: `${result.created}개 생성, ${result.updated}개 업데이트`,
        });
      }
      
      // 업로드 성공 시에만 데이터 다시 로드
      if (result.created > 0 || result.updated > 0) {
        // 업로드 후 잠시 대기 후 데이터 다시 로드
        setTimeout(async () => {
          console.log('Reloading RNA tests after upload, patientId:', patientId);
          await loadRNATestsForPatient(patientId);
          
          // 데이터가 로드되면 분석 탭으로 이동
          const tests = await getRNATestsApi({ search: patientId });
          const testList = tests.results || tests || [];
          console.log('Tests found after upload:', testList.length, testList);
          
          if (testList.length > 0) {
            setRNATests(testList);
            setSelectedRNATest(testList[0]);
            setActiveTab('analysis');
          } else {
            // 데이터가 없으면 에러 메시지 표시
            toast({
              title: '데이터 로드 실패',
              description: `업로드는 성공했지만 RNA 테스트 데이터를 찾을 수 없습니다. patientId: ${patientId}. 잠시 후 다시 시도해주세요.`,
              variant: 'destructive',
            });
          }
        }, 1500);
      }
    } catch (error: any) {
      toast({
        title: '업로드 실패',
        description: error?.response?.data?.error || '파일 업로드 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handlePCRPredict = async () => {
    const testToPredict = selectedRNATest || rnaTests[0];
    if (!testToPredict) {
      toast({
        title: 'RNA 검사 선택 필요',
        description: 'pCR 예측을 위해 RNA 검사를 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedOrder) {
      toast({
        title: '주문 선택 필요',
        description: '먼저 검사 주문을 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setPredictingPCR(true);
    try {
      const result = await predictPCRApi(testToPredict.id);
      setPcrPrediction(result);
      
      // 결과를 OCS 주문에 저장
      await saveResultToOrder(result);
      
      toast({
        title: 'pCR 예측 완료',
        description: `예측 확률: ${(result.probability * 100).toFixed(1)}% - 결과가 저장되었습니다.`,
      });
    } catch (error: any) {
      toast({
        title: 'pCR 예측 실패',
        description: error?.response?.data?.error || 'pCR 예측 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setPredictingPCR(false);
    }
  };

  const saveResultToOrder = async (predictionResult: any) => {
    if (!selectedOrder) return;

    try {
      // OCS 결과 입력 API 호출
      const response = await fetch(`/api/ocs/orders/${selectedOrder.id}/input_lab_result/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          test_results: {},
          ai_findings: predictionResult.prediction === 'Positive' ? '양성 (Positive)' : '음성 (Negative)',
          ai_confidence_score: predictionResult.probability,
          ai_report_image: predictionResult.image || '',
          ai_prediction: predictionResult.prediction || '',
          notes: `pCR 예측 확률: ${(predictionResult.probability * 100).toFixed(1)}%`,
        }),
      });

      if (!response.ok) {
        throw new Error('결과 저장 실패');
      }

      // 주문 목록 새로고침
      await loadOrders();
    } catch (error) {
      console.error('Failed to save result:', error);
      toast({
        title: '결과 저장 실패',
        description: '예측 결과를 저장하는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  const filteredOrders = orders.filter(order => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      order.patient_name?.toLowerCase().includes(term) ||
      order.patient_id?.toLowerCase().includes(term) ||
      order.patient_number?.toLowerCase().includes(term) ||
      order.id.toLowerCase().includes(term)
    );
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AI 분석 시스템</h1>
          <p className="text-muted-foreground mt-1">
            OCS 검사 주문 기반 AI 모델 추론 및 결과 저장
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="orders">
            <FlaskConical className="mr-2 h-4 w-4" />
            검사 주문 ({filteredOrders.length})
          </TabsTrigger>
          <TabsTrigger value="upload" disabled={!selectedOrder}>
            <Upload className="mr-2 h-4 w-4" />
            데이터 업로드
          </TabsTrigger>
          <TabsTrigger value="analysis" disabled={!selectedOrder}>
            <Brain className="mr-2 h-4 w-4" />
            AI 분석 ({rnaTests.length})
          </TabsTrigger>
        </TabsList>

        {/* Orders Tab */}
        <TabsContent value="orders">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>검사 주문 목록 (처리 중)</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="환자명, 환자번호, 주문ID 검색..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 w-64"
                    />
                  </div>
                  <Button onClick={loadOrders} variant="outline" size="sm">
                    새로고침
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingOrders ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : filteredOrders.length > 0 ? (
                <div className="space-y-2">
                  {filteredOrders.map((order) => (
                    <div
                      key={order.id}
                      className={`cursor-pointer rounded-lg border p-4 transition-all ${
                        selectedOrder?.id === order.id
                          ? 'bg-primary/10 border-primary'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                      onClick={() => {
                        setSelectedOrder(order);
                        setActiveTab('upload');
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold">{order.patient_name}</p>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span>환자번호: {order.patient_number || order.patient_id}</span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(order.created_at).toLocaleDateString('ko-KR')}
                              </span>
                            </div>
                            {order.order_data?.test_items && (
                              <p className="text-xs text-muted-foreground mt-1">
                                검사 항목: {order.order_data.test_items.map((item: any) => item.name).join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={order.status === 'processing' ? 'default' : 'secondary'}>
                            {order.status === 'processing' ? '처리 중' : '전달됨'}
                          </Badge>
                          {selectedOrder?.id === order.id && (
                            <Badge className="bg-primary text-white">선택됨</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <FlaskConical className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                  <p className="text-lg font-semibold mb-2">처리 중인 검사 주문이 없습니다</p>
                  <p className="text-sm">의사가 검사 주문을 전달하고 처리 시작을 누르면 여기에 표시됩니다</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Upload Tab */}
        <TabsContent value="upload">
          {selectedOrder ? (
            <div className="space-y-4">
              <Card className="bg-primary/5 border-primary">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-primary/10 rounded-lg">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold text-lg">{selectedOrder.patient_name}</p>
                      <p className="text-sm text-muted-foreground">
                        환자번호: {selectedOrder.patient_number || selectedOrder.patient_id}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Lab Test Upload */}
                <Card>
                  <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50">
                    <CardTitle className="flex items-center gap-2">
                      <Activity className="h-5 w-5 text-blue-600" />
                      혈액검사 데이터 업로드
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                        <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                        <p className="text-sm text-muted-foreground mb-4">
                          CSV 파일을 업로드하여 혈액검사 데이터를 등록하세요
                        </p>
                        <label htmlFor="lab-upload">
                          <Button 
                            variant="outline" 
                            disabled={uploading} 
                            asChild
                            className="cursor-pointer"
                          >
                            <span>
                              {uploading ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  업로드 중...
                                </>
                              ) : (
                                <>
                                  <Upload className="mr-2 h-4 w-4" />
                                  CSV 파일 선택
                                </>
                              )}
                            </span>
                          </Button>
                        </label>
                        <input
                          id="lab-upload"
                          type="file"
                          accept=".csv"
                          onChange={handleLabTestUpload}
                          className="hidden"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* RNA Test Upload */}
                <Card>
                  <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
                    <CardTitle className="flex items-center gap-2">
                      <Dna className="h-5 w-5 text-purple-600" />
                      RNA 검사 데이터 업로드
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                        <Dna className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                        <p className="text-sm text-muted-foreground mb-4">
                          CSV 파일을 업로드하여 RNA 검사 데이터를 등록하세요
                        </p>
                        <label htmlFor="rna-upload">
                          <Button 
                            variant="outline" 
                            disabled={uploading} 
                            asChild
                            className="cursor-pointer"
                          >
                            <span>
                              {uploading ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  업로드 중...
                                </>
                              ) : (
                                <>
                                  <Upload className="mr-2 h-4 w-4" />
                                  CSV 파일 선택
                                </>
                              )}
                            </span>
                          </Button>
                        </label>
                        <input
                          id="rna-upload"
                          type="file"
                          accept=".csv"
                          onChange={handleRNATestUpload}
                          className="hidden"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <User className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                <p className="text-lg font-semibold mb-2">환자 선택 필요</p>
                <p className="text-sm mb-4">검사 주문 탭에서 환자를 선택해주세요</p>
                <Button onClick={() => setActiveTab('orders')} variant="outline">
                  검사 주문으로 이동
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Analysis Tab */}
        <TabsContent value="analysis">
          {!selectedOrder ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <User className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                <p className="text-lg font-semibold mb-2">환자 선택 필요</p>
                <p className="text-sm mb-4">검사 주문 탭에서 환자를 선택해주세요</p>
                <Button onClick={() => setActiveTab('orders')} variant="outline">
                  검사 주문으로 이동
                </Button>
              </CardContent>
            </Card>
          ) : rnaTests.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left: RNA Test List */}
              <Card>
                <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 border-b">
                  <CardTitle className="flex items-center gap-2">
                    <Dna className="h-5 w-5 text-purple-600" />
                    RNA 검사 목록
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {rnaTests.map((test) => (
                      <div
                        key={test.id}
                        className={`cursor-pointer rounded-lg border p-3 transition-all ${
                          selectedRNATest?.id === test.id
                            ? 'bg-purple-50 border-purple-300'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => setSelectedRNATest(test)}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-semibold">{test.patient_name}</p>
                            <p className="text-xs text-muted-foreground">{test.accession_number}</p>
                          </div>
                          {selectedRNATest?.id === test.id && (
                            <Badge className="bg-purple-600 text-white">선택됨</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Middle: Gene Expression Table */}
              <Card className="lg:col-span-1">
                <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-indigo-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Dna className="h-5 w-5 text-purple-600" />
                        <CardTitle className="text-lg font-bold">유전자 발현값</CardTitle>
                      </div>
                      {(selectedRNATest || rnaTests[0]) && (
                        <p className="text-sm text-muted-foreground">
                          Patient: {(selectedRNATest || rnaTests[0]).patient_name} ({(selectedRNATest || rnaTests[0]).patient_id})
                        </p>
                      )}
                    </div>
                    <Button 
                      onClick={handlePCRPredict} 
                      disabled={predictingPCR || !selectedRNATest}
                      className="bg-purple-600 hover:bg-purple-700"
                      size="sm"
                    >
                      {predictingPCR ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          예측 중...
                        </>
                      ) : (
                        <>
                          <Brain className="mr-2 h-4 w-4" />
                          pCR 예측
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="max-h-[600px] overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">유전자명</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">발현값</th>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Pathway</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {GENE_NAMES.map((gene) => {
                          const test = selectedRNATest || rnaTests[0];
                          const value = test?.[gene];
                          const pathway = GENE_PATHWAYS[gene] || '기타';
                          return (
                            <tr key={gene} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-mono text-xs font-medium text-purple-700">{gene}</td>
                              <td className="px-3 py-2 text-right font-semibold text-gray-900 text-xs">
                                {value !== null && value !== undefined ? value.toFixed(3) : 'N/A'}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-600">{pathway}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Right: pCR Prediction Results */}
              <div className="space-y-6 lg:col-span-1">
                {pcrPrediction ? (
                  <>
                    <Card className="border-2 border-green-500">
                      <CardHeader className="bg-green-50 border-b">
                        <CardTitle className="text-lg font-bold text-green-800">pCR 예측 결과</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-6">
                        <div className="text-center">
                          <p className="text-sm text-muted-foreground mb-2">예측 확률</p>
                          <p className="text-5xl font-bold text-green-600 mb-4">
                            {(pcrPrediction.probability * 100).toFixed(1)}%
                          </p>
                          <p className="text-xl font-semibold">
                            {pcrPrediction.prediction === 'Positive' ? (
                              <span className="text-green-600">✓ 양성 (Positive)</span>
                            ) : (
                              <span className="text-red-600">✗ 음성 (Negative)</span>
                            )}
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="bg-indigo-50 border-b">
                        <CardTitle className="text-lg font-bold text-indigo-800">AI 맞춤 치료 제안</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        {pcrPrediction.probability >= 0.342 ? (
                          <div className="space-y-3 text-sm">
                            <div className="flex items-start gap-2">
                              <span className="text-lg">📋</span>
                              <div>
                                <p className="font-semibold">HER2 양성 특성</p>
                                <p className="text-muted-foreground">• Trastuzumab/Pertuzumab 표적치료 권장</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-lg">📋</span>
                              <div>
                                <p className="font-semibold">높은 면역 활성</p>
                                <p className="text-muted-foreground">• 면역관문억제제 병용 고려 가능</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <span className="text-lg">📋</span>
                              <div>
                                <p className="font-semibold">빠른 세포 증식</p>
                                <p className="text-muted-foreground">• 세포독성 항암제 반응성 우수 예상</p>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 text-sm">
                            <div className="flex items-start gap-2">
                              <span className="text-lg">📋</span>
                              <div>
                                <p className="font-semibold">관찰 요망</p>
                                <p className="text-muted-foreground">• 표준 프로토콜 준수<br/>• 정밀 추적 검사 권장</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {pcrPrediction.image && (
                      <Card>
                        <CardHeader className="bg-purple-50 border-b">
                          <CardTitle className="text-lg font-bold text-purple-800">AI 임상 리포트</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-6">
                          <div 
                            className="cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() => setShowReportModal(true)}
                          >
                            <img 
                              src={`data:image/png;base64,${pcrPrediction.image}`}
                              alt="pCR Clinical Report"
                              className="w-full rounded-lg shadow-lg"
                            />
                            <p className="text-xs text-center text-muted-foreground mt-2">클릭하여 확대</p>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      <Brain className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                      <p className="text-lg font-semibold mb-2">예측 결과 없음</p>
                      <p className="text-sm">RNA 검사를 선택하고 "pCR 예측" 버튼을 클릭하세요</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Dna className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                <p className="text-lg font-semibold mb-2">RNA 검사 데이터가 없습니다</p>
                <p className="text-sm mb-4">데이터 업로드 탭에서 CSV 파일을 업로드해주세요</p>
                <Button 
                  onClick={() => setActiveTab('upload')}
                  variant="outline"
                >
                  데이터 업로드로 이동
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Report Image Modal */}
      {showReportModal && pcrPrediction && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          onClick={() => setShowReportModal(false)}
        >
          <div className="relative max-w-7xl max-h-[95vh] overflow-auto">
            <button
              onClick={() => setShowReportModal(false)}
              className="absolute top-4 right-4 z-10 rounded-full bg-white p-2 shadow-lg hover:bg-gray-100"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img 
              src={`data:image/png;base64,${pcrPrediction.image}`}
              alt="pCR Clinical Report - Full Size"
              className="w-full h-auto rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
