import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText, User, AlertTriangle, ZoomIn, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getImagingAnalysisByIdApi, getOrderApi } from '@/lib/api';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useState } from 'react';

export default function ImagingAnalysisDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('order');
  const navigate = useNavigate();
  const [imageZoom, setImageZoom] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // 영상 분석 결과 조회
  const { data: analysis, isLoading: isLoadingAnalysis } = useQuery({
    queryKey: ['imaging-analysis', id],
    queryFn: () => getImagingAnalysisByIdApi(id!),
    enabled: !!id,
  });

  // 주문 정보 조회
  const { data: order, isLoading: isLoadingOrder } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => getOrderApi(orderId!),
    enabled: !!orderId,
  });

  if (isLoadingAnalysis || isLoadingOrder) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!analysis || !order) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-muted-foreground">분석 결과를 찾을 수 없습니다.</p>
          <Button onClick={() => navigate('/ocs')} className="mt-4">
            OCS로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate('/ocs')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            돌아가기
          </Button>
          <div>
            <h1 className="text-3xl font-bold">영상 분석 결과</h1>
            <p className="text-muted-foreground mt-1">
              {order.patient_name}님의 {order.order_data?.imaging_type || '영상'} 분석 결과
            </p>
          </div>
        </div>
      </div>

      {/* 환자 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            환자 정보
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">환자명</p>
              <p className="font-medium">{order.patient_name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">환자번호</p>
              <p className="font-medium">{order.patient_number}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">의사</p>
              <p className="font-medium">{order.doctor_name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">촬영 유형</p>
              <p className="font-medium">{order.order_data?.imaging_type || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 분석 정보 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            분석 정보
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">분석자</p>
                <p className="font-medium">{analysis.analyzed_by_name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">분석일시</p>
                <p className="font-medium">
                  {format(new Date(analysis.created_at), 'yyyy-MM-dd HH:mm', { locale: ko })}
                </p>
              </div>
            </div>
            {analysis.confidence_score !== null && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">신뢰도</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-200 rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${analysis.confidence_score * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">
                    {(analysis.confidence_score * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 종양 탐지 이미지 및 소견 - 두 번째 이미지 스타일 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 왼쪽: 종양 탐지 이미지 */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="border-b border-slate-800">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {(() => {
                  const imagingType = order.order_data?.imaging_type || '';
                  const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
                  const isMRI = imagingType === 'MRI' || imagingType?.includes('MRI') || imagingType === 'MRI 영상';
                  
                  if (isMRI) {
                    return 'MRI 세그멘테이션 영상';
                  } else if (isMammography) {
                    return '종양 탐지 영상';
                  } else {
                    return '영상 분석 결과';
                  }
                })()}
              </CardTitle>
              {analysis.analysis_result?.detection_status && (
                <Badge 
                  variant="destructive" 
                  className="bg-red-600 text-white border-red-500"
                >
                  AI Detected: {analysis.analysis_result.detection_status === 'high_risk' ? 'High Risk Area' : 'Tumor Detected'}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="relative bg-slate-950 min-h-[500px] flex items-center justify-center">
              {(() => {
                // 여러 이미지 URL 배열 추출 (여러 장 지원)
                const imageUrls: string[] = analysis.analysis_result?.heatmap_image_urls || [];
                // 하위 호환성: 단일 이미지 URL이 있으면 배열로 변환
                const singleImageUrl = analysis.analysis_result?.heatmap_image_url 
                  || analysis.analysis_result?.tumor_detection_image_url 
                  || analysis.analysis_result?.visualization_url
                  || analysis.analysis_result?.image_url;
                
                const allImageUrls = imageUrls.length > 0 ? imageUrls : (singleImageUrl ? [singleImageUrl] : []);
                const hasMultipleImages = allImageUrls.length > 1;
                const currentImageUrl = allImageUrls[currentImageIndex];
                
                // 이미지 인덱스 범위 체크
                if (currentImageIndex >= allImageUrls.length && allImageUrls.length > 0) {
                  setCurrentImageIndex(0);
                }
                
                if (currentImageUrl) {
                  return (
                    <div className="relative w-full h-full">
                      {/* 이전/다음 버튼 (여러 이미지일 때만 표시) */}
                      {hasMultipleImages && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white border-white/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentImageIndex((prev) => 
                                prev > 0 ? prev - 1 : allImageUrls.length - 1
                              );
                            }}
                            disabled={allImageUrls.length <= 1}
                          >
                            <ChevronLeft className="h-6 w-6" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-black/50 hover:bg-black/70 text-white border-white/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCurrentImageIndex((prev) => 
                                prev < allImageUrls.length - 1 ? prev + 1 : 0
                              );
                            }}
                            disabled={allImageUrls.length <= 1}
                          >
                            <ChevronRight className="h-6 w-6" />
                          </Button>
                          {/* 이미지 카운터 */}
                          <div className="absolute top-4 right-4 bg-black/70 text-white px-3 py-1 rounded-full text-sm z-10">
                            {currentImageIndex + 1} / {allImageUrls.length}
                          </div>
                        </>
                      )}
                      
                      <img 
                        src={currentImageUrl} 
                        alt={`종양 탐지 영상 ${hasMultipleImages ? `(${currentImageIndex + 1}/${allImageUrls.length})` : ''}`}
                        className="w-full h-auto max-h-[600px] object-contain cursor-pointer transition-opacity duration-300"
                        onClick={() => setImageZoom(!imageZoom)}
                      />
                      
                      {imageZoom && (
                        <div 
                          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                          onClick={() => setImageZoom(false)}
                        >
                          <img 
                            src={currentImageUrl} 
                            alt={`종양 탐지 영상 (확대) ${hasMultipleImages ? `(${currentImageIndex + 1}/${allImageUrls.length})` : ''}`}
                            className="max-w-full max-h-full object-contain"
                          />
                          {hasMultipleImages && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCurrentImageIndex((prev) => 
                                    prev > 0 ? prev - 1 : allImageUrls.length - 1
                                  );
                                }}
                              >
                                <ChevronLeft className="h-8 w-8" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCurrentImageIndex((prev) => 
                                    prev < allImageUrls.length - 1 ? prev + 1 : 0
                                  );
                                }}
                              >
                                <ChevronRight className="h-8 w-8" />
                              </Button>
                              <div className="absolute top-4 right-4 bg-black/70 text-white px-4 py-2 rounded-lg text-lg">
                                {currentImageIndex + 1} / {allImageUrls.length}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      
                      <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white/70 text-sm">
                        <ZoomIn className="w-4 h-4" />
                        <span>AI 분석 영역 (클릭하여 확대){hasMultipleImages ? ` - ${currentImageIndex + 1}번째 이미지` : ''}</span>
                      </div>
                    </div>
                  );
                }
                
                // 이미지가 없으면 placeholder
                const imagingType = order.order_data?.imaging_type || '';
                const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
                const isMRI = imagingType === 'MRI' || imagingType?.includes('MRI') || imagingType === 'MRI 영상';
                
                if (isMRI) {
                  // MRI의 경우 세그멘테이션 뷰어로 이동할 수 있는 링크 제공
                  const patientId = order.patient_id || order.patient_number;
                  return (
                    <div className="text-center text-slate-500 p-8 space-y-4">
                      <div>
                        <p className="mb-2 text-lg">MRI Image / Segmentation Overlay</p>
                        <p className="text-xs text-slate-600">Original DICOM / Segmentation Overlay (Toggle)</p>
                      </div>
                      {patientId && (
                        <Button
                          onClick={() => navigate(`/mri-viewer/${patientId}?imageType=MRI 영상`)}
                          variant="outline"
                          className="mt-4"
                        >
                          MRI 뷰어에서 세그멘테이션 확인하기
                        </Button>
                      )}
                      {analysis.analysis_result?.seg_instance_id && (
                        <p className="text-xs text-slate-400 mt-2">
                          세그멘테이션 결과가 Orthanc에 저장되어 있습니다 (Instance ID: {analysis.analysis_result.seg_instance_id.substring(0, 8)}...)
                        </p>
                      )}
                    </div>
                  );
                } else if (isMammography) {
                  return (
                    <div className="text-center text-slate-500 p-8">
                      <p className="mb-2">Mammography Image / Heatmap</p>
                      <p className="text-xs text-slate-600">CC View / MLO View (Selectable)</p>
                    </div>
                  );
                } else {
                  return (
                    <div className="text-center text-slate-500 p-8">
                      <p className="mb-2">영상 분석 결과</p>
                      <p className="text-xs text-slate-600">분석 이미지가 없습니다</p>
                    </div>
                  );
                }
              })()}
            </div>
            <div className="p-4 border-t border-slate-800">
              {(() => {
                const imagingType = order.order_data?.imaging_type || '';
                const isMammography = imagingType === '유방촬영술' || imagingType?.includes('유방');
                const isMRI = imagingType === 'MRI' || imagingType?.includes('MRI') || imagingType === 'MRI 영상';
                
                if (isMRI) {
                  return (
                    <p className="text-xs text-red-400">
                      보라색 영역 = AI 세그멘테이션 영역 (종양 탐지)
                    </p>
                  );
                } else if (isMammography) {
                  return (
                    <p className="text-xs text-red-400">
                      빨간색 영역 = AI가 주목한 부분
                    </p>
                  );
                } else {
                  return (
                    <p className="text-xs text-red-400">
                      AI 분석 영역
                    </p>
                  );
                }
              })()}
            </div>
          </CardContent>
        </Card>

        {/* 오른쪽: 소견, 위험도 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              영상 분석 소견
            </CardTitle>
            <CardDescription>
              Exam Date: {format(new Date(analysis.created_at), 'yyyy-MM-dd', { locale: ko })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 종양 특성 */}
            {analysis.analysis_result?.bi_rads || analysis.analysis_result?.tumor_characteristics && (
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">TUMOR CHARACTERISTICS</h3>
                {analysis.analysis_result?.bi_rads && (
                  <Badge 
                    variant="outline" 
                    className="bg-pink-50 text-pink-700 border-pink-200 text-sm px-3 py-1"
                  >
                    BI-RADS: {analysis.analysis_result.bi_rads} {analysis.analysis_result.bi_rads_description || '(악성 의심) HIGH SUSPICION'}
                  </Badge>
                )}
                {analysis.analysis_result?.tumor_description && (
                  <p className="text-sm text-muted-foreground">
                    {analysis.analysis_result.tumor_description}
                  </p>
                )}
                {analysis.analysis_result?.lesion_size && (
                  <p className="text-sm">
                    <span className="font-medium">Lesion Size: </span>
                    {analysis.analysis_result.lesion_size}
                  </p>
                )}
                {analysis.analysis_result?.calcification && (
                  <p className="text-sm">
                    {analysis.analysis_result.calcification}
                  </p>
                )}
              </div>
            )}

            {/* 방사선 전문의 평가 */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Radiologist Assessment</h3>
              {analysis.analysis_result?.breast_density && (
                <p className="text-sm">
                  <span className="font-medium">Breast Density: </span>
                  {analysis.analysis_result.breast_density}
                </p>
              )}
              
              {/* 위험도 */}
              {analysis.analysis_result?.suspicion_level && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Suspicion Level</p>
                  <Badge 
                    variant="destructive" 
                    className="bg-red-600 text-white border-red-500"
                  >
                    {analysis.analysis_result.suspicion_level === 'high' ? '높음 (High)' : 
                     analysis.analysis_result.suspicion_level === 'medium' ? '중간 (Medium)' : 
                     '낮음 (Low)'}
                  </Badge>
                </div>
              )}

              {/* AI 병변 탐지 */}
              {analysis.analysis_result?.lesion_detection && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">AI Lesion Detection</p>
                  <p className="text-sm font-medium text-red-600">
                    {analysis.analysis_result.lesion_detection === 'positive' ? 'Positive (Lesion Found)' : 'Negative (No Lesion)'}
                  </p>
                </div>
              )}
            </div>

            {/* 소견 */}
            {analysis.findings && (
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">소견</h3>
                <div className="prose max-w-none text-sm">
                  <p className="whitespace-pre-wrap text-muted-foreground leading-relaxed">{analysis.findings}</p>
                </div>
              </div>
            )}

            {/* 권고사항 */}
            {analysis.recommendations && (
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">권고사항</h3>
                <div className="prose max-w-none text-sm">
                  <p className="whitespace-pre-wrap text-muted-foreground">{analysis.recommendations}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-2">
        <Button onClick={() => navigate(`/ocs/orders/${order.id}`)}>
          주문 상세 보기
        </Button>
        <Button variant="outline" onClick={() => navigate('/ocs')}>
          OCS로 돌아가기
        </Button>
      </div>
    </div>
  );
}
