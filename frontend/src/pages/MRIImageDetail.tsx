import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  X,
  ArrowLeft,
  Scan,
  Image as ImageIcon,
  Brain,
  CheckCircle,
  Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import CornerstoneViewer from "@/components/CornerstoneViewer";
import Volume3DViewer from "@/components/Volume3DViewer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface OrthancImage {
  instance_id: string;
  series_id: string;
  study_id: string;
  series_description: string;
  instance_number: string;
  preview_url: string;
  modality?: string;
  is_segmentation?: boolean;  // SEG 파일 여부
  view_position?: string;
  image_laterality?: string;
  mammography_view?: string;
}

interface SeriesGroup {
  series_id: string;
  series_description: string;
  images: OrthancImage[];
  modality: string;
}

export default function MRIImageDetail() {
  const { patientId } = useParams<{ patientId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const imageType = searchParams.get("imageType") || "MRI 영상";
  const initialIndex = parseInt(searchParams.get("index") || "0");

  // 데이터 상태
  const [allOrthancImages, setAllOrthancImages] = useState<OrthancImage[]>([]);
  const [seriesGroups, setSeriesGroups] = useState<SeriesGroup[]>([]);
  const [selectedSeriesIndex, setSelectedSeriesIndex] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // 뷰어 제어 상태
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // AI 분석 상태
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [showAiResult, setShowAiResult] = useState(false);
  
  // 4-channel DCE-MRI를 위한 Series 선택
  const [selectedSeriesFor4Channel, setSelectedSeriesFor4Channel] = useState<number[]>([]);
  
  // 시리즈 전체 세그멘테이션 상태
  const [seriesSegmentationResults, setSeriesSegmentationResults] = useState<{[seriesId: string]: any}>({});
  const [showSegmentationOverlay, setShowSegmentationOverlay] = useState(false);
  const [segmentationFrames, setSegmentationFrames] = useState<{[seriesId: string]: any[]}>({});
  const [segmentationStartIndex, setSegmentationStartIndex] = useState<{[seriesId: string]: number}>({});
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [hasSegmentationFile, setHasSegmentationFile] = useState(false);  // SEG 파일 존재 여부
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");  // 2D 또는 3D 뷰 모드

  // 현재 선택된 Series의 이미지들
  const currentImages = seriesGroups[selectedSeriesIndex]?.images || [];
  const currentImage = currentImages[selectedImageIndex];
  
  // 세그멘테이션 인스턴스 ID 찾기 (Orthanc에 저장된 DICOM SEG 파일)
  // 주의: SEG 파일은 별도의 시리즈(9999)에 있으므로 allOrthancImages에서 찾아야 함
  const segmentationInstanceId = allOrthancImages.find(img => img.is_segmentation || img.modality === 'SEG')?.instance_id;
  
  // 디버깅: 세그멘테이션 인스턴스 ID 확인
  useEffect(() => {
    console.log('[MRIImageDetail] 🔍 세그멘테이션 인스턴스 ID 검색 중...', {
      allOrthancImagesCount: allOrthancImages.length,
      allOrthancImages: allOrthancImages.map(img => ({
        instance_id: img.instance_id,
        is_segmentation: img.is_segmentation,
        modality: img.modality,
        series_description: img.series_description,
      })),
    });
    
    if (segmentationInstanceId) {
      console.log('[MRIImageDetail] ✅ 세그멘테이션 인스턴스 ID 발견:', segmentationInstanceId);
    } else {
      console.warn('[MRIImageDetail] ⚠️ 세그멘테이션 인스턴스 ID 없음');
      const segImages = allOrthancImages.filter(img => img.is_segmentation || img.modality === 'SEG');
      console.log('[MRIImageDetail] SEG 파일 후보:', segImages.map(img => ({
        instance_id: img.instance_id,
        is_segmentation: img.is_segmentation,
        modality: img.modality,
        series_description: img.series_description,
      })));
    }
  }, [segmentationInstanceId, allOrthancImages]);

  useEffect(() => {
    if (patientId) {
      fetchOrthancImages(patientId);
    }
  }, [patientId]);

  useEffect(() => {
    if (allOrthancImages.length > 0) {
      groupImagesBySeries();
    }
  }, [allOrthancImages, imageType]);

  // SEG 파일 자동 감지 및 프레임 로드 (seriesGroups 생성 후 실행)
  useEffect(() => {
    if (seriesGroups.length > 0 && imageType === 'MRI 영상') {
      const segImages = allOrthancImages.filter((img: OrthancImage) => img.is_segmentation || img.modality === 'SEG');
      if (segImages.length > 0) {
        setHasSegmentationFile(true);  // SEG 파일이 있음을 표시
        console.log(`[useEffect SEG] ${segImages.length}개 SEG 파일 발견, 세그멘테이션 프레임 자동 로드 시작`);
        
        // 각 SEG 파일에 대해 세그멘테이션 프레임 로드
        Promise.all(segImages.map(async (segImage: OrthancImage) => {
          try {
            // 세그멘테이션 프레임 로드
            const response = await fetch(`/api/mri/segmentation/instances/${segImage.instance_id}/frames/`);
            const frameData = await response.json();

            if (response.ok && frameData.success) {
              // 모든 MR 시리즈에 프레임 매핑 (여러 시리즈에 동일한 세그멘테이션 결과 적용)
              setSegmentationFrames((prev: {[seriesId: string]: any[]}) => {
                const updated = {...prev};
                seriesGroups.forEach((group: SeriesGroup) => {
                  // MR 시리즈에만 매핑
                  if (group.modality === 'MR') {
                    updated[group.series_id] = frameData.frames;
                  }
                });
                return updated;
              });
              console.log(`✅ SEG 파일 ${segImage.instance_id} 프레임 로드 완료: ${frameData.num_frames}개 (${seriesGroups.length}개 시리즈에 매핑)`);
            }
          } catch (error) {
            console.error(`SEG 파일 ${segImage.instance_id} 프레임 로드 실패:`, error);
          }
        })).catch((error: any) => {
          console.error('SEG 파일 프레임 로드 중 오류:', error);
        });
      } else {
        setHasSegmentationFile(false);
      }
    }
  }, [seriesGroups, allOrthancImages, imageType]);

  const fetchOrthancImages = async (patientId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/mri/orthanc/patients/${patientId}/`, {
        cache: 'force-cache', // 캐싱 활성화로 재방문 시 빠른 로딩
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `서버 오류 (${response.status})`);
      }
      
      if (data.success && data.images && Array.isArray(data.images)) {
        setAllOrthancImages(data.images);
        
        // SEG 파일은 useEffect에서 자동으로 처리됨 (seriesGroups 생성 후)
        
        // 첫 번째 이미지 프리로드 (유방촬영술은 보통 4장 정도)
        if (imageType === '유방촬영술 영상') {
          const mgImages = data.images.filter((img: OrthancImage) => img.modality === 'MG');
          preloadImages(mgImages.slice(0, 4)); // 처음 4장 프리로드
        }
      } else {
        setAllOrthancImages([]);
      }
    } catch (error) {
      console.error('Orthanc 이미지 로드 실패:', error);
      toast({
        title: "오류",
        description: error instanceof Error ? error.message : "이미지를 불러오는데 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // 이미지 프리로드 함수
  const preloadImages = (images: OrthancImage[]) => {
    images.forEach((img) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'fetch';
      link.href = `/api/mri/orthanc/instances/${img.instance_id}/preview/`;
      document.head.appendChild(link);
    });
  };

  const groupImagesBySeries = () => {
    // imageType에 따라 필터링
    let filtered: OrthancImage[] = [];
    switch (imageType) {
      case '유방촬영술 영상':
        filtered = allOrthancImages.filter(img => img.modality === 'MG');
        break;
      case 'MRI 영상':
        filtered = allOrthancImages.filter(img => img.modality === 'MR');
        break;
      case '병리 영상':
        filtered = allOrthancImages.filter(img => 
          img.modality === 'SM' || img.modality === 'OT' || 
          (img.modality && img.modality !== 'MG' && img.modality !== 'MR')
        );
        break;
      default:
        filtered = allOrthancImages;
    }

    // Series ID별로 그룹화
    const seriesMap: { [key: string]: OrthancImage[] } = {};
    filtered.forEach(img => {
      if (!seriesMap[img.series_id]) {
        seriesMap[img.series_id] = [];
      }
      seriesMap[img.series_id].push(img);
    });

    // SeriesGroup 배열로 변환
    const groups: SeriesGroup[] = Object.keys(seriesMap).map(seriesId => {
      const images = seriesMap[seriesId].sort((a, b) =>
        parseInt(a.instance_number) - parseInt(b.instance_number)
      );
      return {
        series_id: seriesId,
        series_description: images[0]?.series_description || 'Unknown Series',
        images,
        modality: images[0]?.modality || 'Unknown',
      };
    });

    setSeriesGroups(groups);

    // 초기 선택
    if (groups.length > 0) {
      setSelectedSeriesIndex(0);
      setSelectedImageIndex(Math.min(initialIndex, groups[0].images.length - 1));
    }
  };

  const handleSeriesChange = (index: number) => {
    setSelectedSeriesIndex(index);
    setSelectedImageIndex(0);
    setAiResult(null);
    setShowAiResult(false);
  };

  const handleAiAnalysis = async () => {
    // AI 분석 = 시리즈 전체 세그멘테이션
    if (seriesGroups.length === 0 || selectedSeriesIndex === -1) {
      toast({
        title: "오류",
        description: "시리즈를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    const currentSeries = seriesGroups[selectedSeriesIndex];
    const seriesId = currentSeries.series_id;
    const isMRI = imageType === 'MRI 영상';
    const isPathology = imageType === '병리 영상';

    // 병리 영상 분석
    if (isPathology) {
      setAiAnalyzing(true);
      setAiResult(null);

      try {
        // 병리 이미지의 instance_id
        const instanceId = currentSeries.images[0]?.instance_id;
        
        if (!instanceId) {
          throw new Error('병리 이미지를 찾을 수 없습니다.');
        }

        // series_description에서 파일명 추출
        // 형식: "Pathology WSI - filename.svs"
        let filename = '';
        const seriesDesc = currentSeries.series_description || '';
        if (seriesDesc.includes(' - ')) {
          filename = seriesDesc.split(' - ')[1];  // "filename.svs"
        } else {
          // series_description에 파일명이 없으면 instance_id를 filename으로 사용
          // (교육원 워커가 알아서 매칭하도록)
          filename = instanceId;
        }

        toast({
          title: "병리 이미지 분석 시작",
          description: "AI 모델이 조직 이미지를 분석하고 있습니다... (약 1-2분 소요)",
        });

        // 병리 AI 분석 API 호출 (instance_id와 filename 전달)
        const response = await fetch(`/api/mri/pathology/analyze/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            instance_id: instanceId,
            filename: filename  // 교육원 워커가 wsi/ 폴더에서 찾을 파일명
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `서버 오류 (${response.status})`);
        }

        setAiResult({ ...data, isPathology: true });
        setShowAiResult(true);

        toast({
          title: "병리 이미지 분석 완료",
          description: `분류 결과: ${data.class_name} (신뢰도: ${(data.confidence * 100).toFixed(1)}%)`,
        });
      } catch (error) {
        console.error('병리 이미지 분석 오류:', error);
        toast({
          title: "AI 분석 실패",
          description: error instanceof Error ? error.message : "AI 분석 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      } finally {
        setAiAnalyzing(false);
      }
      return;
    }

    // 유방촬영술은 4장 이미지 분석 (L-CC, L-MLO, R-CC, R-MLO)
    if (!isMRI) {
      // 맘모그래피는 4장이 모두 있어야 함
      if (currentSeries.images.length < 4) {
        toast({
          title: "오류",
          description: "맘모그래피 분석은 4장의 이미지(L-CC, L-MLO, R-CC, R-MLO)가 필요합니다.",
          variant: "destructive",
        });
        return;
      }

      setAiAnalyzing(true);
      setAiResult(null);

      try {
        // 4장의 instance_id를 수집
        const instanceIds = currentSeries.images.map(img => img.instance_id);
        
        const response = await fetch(`/api/mri/mammography/analyze/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // 쿠키 포함 (인증 정보)
          body: JSON.stringify({
            instance_ids: instanceIds
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || `서버 오류 (${response.status})`);
        }

        setAiResult({ ...data, isMRI: false });
        setShowAiResult(true);

        toast({
          title: "맘모그래피 AI 분석 완료",
          description: `${data.detection_count}개의 병변이 감지되었습니다.`,
        });
      } catch (error) {
        console.error('AI 분석 오류:', error);
        toast({
          title: "AI 분석 실패",
          description: error instanceof Error ? error.message : "AI 분석 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      } finally {
        setAiAnalyzing(false);
      }
      return;
    }

    // MRI: 시리즈 전체 세그멘테이션
    setAiAnalyzing(true);

    try {
      // 4-channel 모드 확인
      let payload: any = {};
      if (selectedSeriesFor4Channel.length === 4) {
        const sequenceSeriesIds = selectedSeriesFor4Channel.map(idx => seriesGroups[idx].series_id);
        payload.sequence_series_ids = sequenceSeriesIds;
        
        toast({
          title: "시리즈 전체 세그멘테이션 시작",
          description: `4-channel 모드로 ${currentSeries.images.length}개 슬라이스 분석 중...`,
        });
    } else {
        toast({
          title: "시리즈 전체 세그멘테이션 시작",
          description: `${currentSeries.images.length}개 슬라이스 분석 중...`,
        });
      }

      const response = await fetch(`/api/mri/segmentation/series/${seriesId}/segment/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `서버 오류 (${response.status})`);
      }

      // 결과 저장 - 4-channel 모드면 4개 시리즈 모두에 저장
      const newResults = { ...seriesSegmentationResults };
      const newStartIndex = { ...segmentationStartIndex };
      
      if (selectedSeriesFor4Channel.length === 4) {
        // 4개 시리즈 모두에 동일한 결과 저장
        const sequenceSeriesIds = selectedSeriesFor4Channel.map(idx => seriesGroups[idx].series_id);
        sequenceSeriesIds.forEach(seqSeriesId => {
          newResults[seqSeriesId] = data;
          if (data.start_slice_index !== undefined) {
            newStartIndex[seqSeriesId] = data.start_slice_index;
          }
        });
        console.log(`📍 4개 시리즈 모두에 세그멘테이션 결과 저장: ${sequenceSeriesIds.join(', ')}`);
      } else {
        // 단일 시리즈 모드
        newResults[seriesId] = data;
        if (data.start_slice_index !== undefined) {
          newStartIndex[seriesId] = data.start_slice_index;
        }
      }
      
      setSeriesSegmentationResults(newResults);
      setSegmentationStartIndex(newStartIndex);
      
      if (data.start_slice_index !== undefined) {
        console.log(`📍 세그멘테이션 범위: 슬라이스 ${data.start_slice_index}~${data.end_slice_index}번 (총 ${data.total_slices}개)`);
      }

      // 세그멘테이션 프레임 로드
      if (data.seg_instance_id) {
        const loadedFrames = await loadSegmentationFrames(seriesId, data.seg_instance_id);
        
        // 4-channel 모드면 4개 시리즈 모두에 동일한 프레임 매핑
        if (selectedSeriesFor4Channel.length === 4 && loadedFrames) {
          const sequenceSeriesIds = selectedSeriesFor4Channel.map(idx => seriesGroups[idx].series_id);
          const newFrames = { ...segmentationFrames };
          
          sequenceSeriesIds.forEach(seqSeriesId => {
            newFrames[seqSeriesId] = loadedFrames;
          });
          
          setSegmentationFrames(newFrames);
          console.log(`✅ 4개 시리즈 모두에 프레임 매핑 완료: ${sequenceSeriesIds.join(', ')}`);
        }
      }

      toast({
        title: "시리즈 세그멘테이션 완료",
        description: data.successful_slices !== undefined && data.total_slices !== undefined
          ? `${data.successful_slices}/${data.total_slices} 슬라이스 분석 완료. 병변 탐지 버튼으로 오버레이를 확인하세요.`
          : `분석 완료. 병변 탐지 버튼으로 오버레이를 확인하세요.`,
      });
    } catch (error) {
      console.error('시리즈 세그멘테이션 오류:', error);
      toast({
        title: "세그멘테이션 실패",
        description: error instanceof Error ? error.message : "세그멘테이션 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setAiAnalyzing(false);
    }
  };

  const loadSegmentationFrames = async (seriesId: string, segInstanceId: string) => {
    try {
      const response = await fetch(`/api/mri/segmentation/instances/${segInstanceId}/frames/`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || '프레임 로드 실패');
      }

      setSegmentationFrames({
        ...segmentationFrames,
        [seriesId]: data.frames
      });

      console.log(`✅ ${data.num_frames}개 세그멘테이션 프레임 로드 완료`);
      
      // 로드된 프레임 반환 (4개 시리즈 매핑용)
      return data.frames;
    } catch (error) {
      console.error('프레임 로드 오류:', error);
      toast({
        title: "프레임 로드 실패",
        description: error instanceof Error ? error.message : "프레임을 불러올 수 없습니다.",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(300, prev + 25));
  const handleZoomOut = () => setZoom(prev => Math.max(50, prev - 25));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(100);
    setRotation(0);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 bg-gray-950">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
        <p className="text-gray-400 font-bold animate-pulse uppercase tracking-widest text-xs">
          이미지 로드 중...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white w-full h-screen overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur-sm border-b border-gray-800">
        <div className="w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/mri-viewer')}
                className="text-white hover:bg-gray-800 rounded-xl"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                목록으로
              </Button>
              <div className="h-8 w-px bg-gray-700"></div>
              <div className="flex items-center gap-3">
                <div className="bg-blue-600 p-2 rounded-xl">
                  <Scan className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-black tracking-tight">영상 상세 보기</h1>
                  <p className="text-xs text-gray-400">환자 ID: {patientId}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge className="bg-blue-600/20 text-blue-400 border border-blue-600/30 px-4 py-2 rounded-xl">
                {imageType}
              </Badge>
              {currentImages.length > 0 && (
              <Badge className="bg-gray-800 text-gray-300 border border-gray-700 px-4 py-2 rounded-xl">
                  슬라이스: {(selectedImageIndex ?? 0) + 1} / {currentImages.length || 0}
              </Badge>
              )}

              <Button
                onClick={handleAiAnalysis}
                disabled={aiAnalyzing || !currentImage}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold px-6 py-2 rounded-xl flex items-center gap-2 shadow-lg"
              >
                {aiAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    AI 분석 중...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4" />
                    AI 분석
                    {imageType === 'MRI 영상' && selectedSeriesFor4Channel.length === 4 && (
                      <Badge className="ml-2 bg-purple-800 text-white text-xs">4CH</Badge>
                    )}
                  </>
                )}
              </Button>

              {/* 병변 탐지 토글 버튼 (세그멘테이션 결과가 있거나 SEG 파일이 있을 때 표시) */}
              {imageType === 'MRI 영상' && 
               seriesGroups.length > 0 && 
               selectedSeriesIndex !== -1 &&
               (seriesSegmentationResults[seriesGroups[selectedSeriesIndex]?.series_id] || 
                segmentationFrames[seriesGroups[selectedSeriesIndex]?.series_id] ||
                hasSegmentationFile) && (
                <Button
                  onClick={() => setShowSegmentationOverlay(!showSegmentationOverlay)}
                  className={`font-bold px-6 py-2 rounded-xl flex items-center gap-2 shadow-lg ${
                    showSegmentationOverlay
                      ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700'
                      : 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700'
                  } text-white`}
                >
                  {showSegmentationOverlay ? (
                    <>
                      <Scan className="w-4 h-4" />
                      병변 탐지 OFF
                    </>
                  ) : (
                    <>
                      <Scan className="w-4 h-4" />
                      병변 탐지 ON
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - 3 Column Layout */}
      <div className="w-full h-[calc(100vh-73px)] px-6 py-4 overflow-hidden">
        <div className="grid grid-cols-12 gap-4 h-full">
          {/* Left Sidebar: Series Selection & Image Info */}
          <div className="col-span-2 space-y-4 overflow-y-auto">
            {/* Series Selection */}
            <Card className="bg-gray-900 border-gray-800 rounded-2xl overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-black text-white uppercase tracking-widest">
                    Series 선택
                  </h3>
                </div>
                
                {/* 4-channel 모드 안내 */}
                {imageType === 'MRI 영상' && seriesGroups.length >= 4 && (
                  <div className="bg-purple-900/20 border border-purple-700/30 rounded-lg p-2 mb-2">
                    <p className="text-xs text-purple-300 font-bold">
                      4-channel DCE-MRI 분석
                    </p>
                    <p className="text-xs text-purple-400 mt-1">
                      4개 Series 선택: {selectedSeriesFor4Channel.length}/4
                    </p>
                  </div>
                )}
                
                <div className="space-y-2">
                  {seriesGroups.length > 0 ? (
                    seriesGroups.map((series, idx) => {
                      const is4ChannelSelected = selectedSeriesFor4Channel.includes(idx);
                      const isCurrentSeries = selectedSeriesIndex === idx;
                      
                      return (
                        <div key={series.series_id} className="relative">
                          <button
                            onClick={() => handleSeriesChange(idx)}
                            className={`w-full p-3 rounded-xl text-left transition-all ${
                              isCurrentSeries
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            }`}
                          >
                            <div className="text-xs font-bold">Series {idx + 1}</div>
                            <div className="text-xs opacity-75 mt-1 truncate">
                              {series.series_description}
                            </div>
                            <div className="text-xs opacity-60 mt-1">
                              {series.images.length} images
                            </div>
                          </button>
                          
                          {/* 4-channel 선택 체크박스 (MRI만) */}
                          {imageType === 'MRI 영상' && (
                            <input
                              type="checkbox"
                              checked={is4ChannelSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (e.target.checked) {
                                  if (selectedSeriesFor4Channel.length < 4) {
                                    setSelectedSeriesFor4Channel([...selectedSeriesFor4Channel, idx]);
                                  }
                                } else {
                                  setSelectedSeriesFor4Channel(selectedSeriesFor4Channel.filter(i => i !== idx));
                                }
                              }}
                              className="absolute top-2 right-2 w-4 h-4 rounded border-2 border-purple-500 bg-gray-800 checked:bg-purple-600"
                            />
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center text-gray-500 text-xs py-4">
                      Series가 없습니다
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Image Info */}
            {currentImage && (
              <Card className="bg-gray-900 border-gray-800 rounded-2xl overflow-hidden">
                <CardContent className="p-4 space-y-2">
                  <h3 className="text-xs font-black text-white uppercase tracking-widest mb-3">
                    영상 정보
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div>
                      <span className="text-gray-400">Instance:</span>
                      <p className="text-white font-mono mt-1">
                        {currentImage.instance_number}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Modality:</span>
                      <p className="text-white font-mono mt-1">
                        {currentImage.modality}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400">Series ID:</span>
                      <p className="text-white font-mono mt-1 text-[10px] break-all">
                        {currentImage.series_id.substring(0, 16)}...
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Center: Image Viewer */}
          <div className="col-span-7 h-full">
            <Card className={`bg-gray-900 border-gray-800 rounded-2xl overflow-hidden h-full ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''
              }`}>
              <CardContent className={`p-0 h-full ${isFullscreen ? 'h-screen' : ''}`}>
                {currentImages.length > 0 ? (
                  <div className="relative h-full flex flex-col">
                    {/* 뷰 모드 탭 */}
                    <div className="p-4 border-b border-gray-800">
                      <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as "2d" | "3d")}>
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="2d">2D 슬라이스 뷰</TabsTrigger>
                          <TabsTrigger value="3d">3D 볼륨 뷰</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>

                    {/* 뷰어 콘텐츠 */}
                    <div className="flex-1 relative">
                      {viewMode === "2d" ? (
                        <div className="relative h-full">
                          {(() => {
                            // 현재 시리즈의 세그멘테이션 프레임 가져오기
                            const currentSeriesId = seriesGroups[selectedSeriesIndex]?.series_id;
                            const frames = currentSeriesId ? segmentationFrames[currentSeriesId] : undefined;
                            
                            // 프레임 인덱스 매핑 (슬라이스 인덱스 → 프레임 인덱스)
                            // SEG 파일의 프레임은 보통 0부터 시작하므로, 슬라이스 인덱스와 직접 매핑
                            let mappedFrames: Array<{index: number; mask_base64: string}> | undefined = undefined;
                            
                            if (frames && frames.length > 0) {
                              // 프레임을 슬라이스 인덱스에 맞게 매핑
                              mappedFrames = frames.map((frame: any, idx: number) => ({
                                index: idx,  // 슬라이스 인덱스와 동일하게 매핑
                                mask_base64: frame.mask_base64 || frame.mask || ''
                              }));
                              console.log(`[MRIImageDetail] 세그멘테이션 프레임 매핑: seriesId=${currentSeriesId}, frames=${frames.length}, mapped=${mappedFrames.length}, showSegmentation=${showSegmentationOverlay}, selectedImageIndex=${selectedImageIndex}`);
                              console.log(`[MRIImageDetail] mappedFrames 샘플:`, mappedFrames.slice(0, 3).map((f: any) => ({ index: f.index, hasMask: !!f.mask_base64 })));
                            } else {
                              console.log(`[MRIImageDetail] 세그멘테이션 프레임 없음: seriesId=${currentSeriesId}, frames=${frames ? 'undefined' : 'null'}, segmentationFrames keys:`, Object.keys(segmentationFrames));
                            }
                            
                            return (
                              <CornerstoneViewer
                                key={`viewer-${currentSeriesId}-${currentImages.length}-${showSegmentationOverlay}`}
                                instanceIds={currentImages.map(img => img.instance_id)}
                                currentIndex={selectedImageIndex}
                                onIndexChange={setSelectedImageIndex}
                                showMeasurementTools={true}
                                showSegmentation={showSegmentationOverlay && !!mappedFrames}
                                segmentationFrames={mappedFrames || []}
                              />
                            );
                          })()}
                        </div>
                      ) : viewMode === "3d" ? (
                        <div className="h-full">
                          {(() => {
                            const currentSeriesId = seriesGroups[selectedSeriesIndex]?.series_id;
                            const frames = currentSeriesId ? segmentationFrames[currentSeriesId] : undefined;
                            const mappedFrames = frames && frames.length > 0 
                              ? frames.map((frame: any, idx: number) => ({
                                  index: idx,
                                  mask_base64: frame.mask_base64 || frame.mask || ''
                                }))
                              : [];
                            
                            return (
                              <Volume3DViewer
                                instanceIds={currentImages.filter(img => !img.is_segmentation).map(img => img.instance_id)}
                                segmentationInstanceId={segmentationInstanceId}
                                segmentationFrames={mappedFrames}
                                patientId={patientId}
                              />
                            );
                          })()}
                          {currentImages.length === 0 && (
                            <div className="flex items-center justify-center h-full text-gray-400">
                              <p>DICOM 이미지가 없습니다</p>
                            </div>
                          )}
                          {currentImages.filter(img => !img.is_segmentation).length === 0 && (
                            <div className="flex items-center justify-center h-full text-yellow-400">
                              <p>⚠️ DICOM 이미지를 찾을 수 없습니다. 세그멘테이션만 있습니다.</p>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    
                    {isFullscreen && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsFullscreen(false)}
                        className="absolute top-4 right-4 z-50 bg-black/50 hover:bg-black/70 text-white rounded-xl"
                      >
                        <X className="w-6 h-6" />
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400">
                    <div className="text-center">
                      <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                      <p>Series를 선택하세요</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Sidebar: Viewer Controls */}
          <div className="col-span-3 space-y-4 overflow-y-auto">
            <Card className="bg-gray-900 border-gray-800 rounded-2xl overflow-hidden">
              <CardContent className="p-4 space-y-4">
                <h3 className="text-xs font-black text-white uppercase tracking-widest mb-4">
                  뷰어 제어
                </h3>

                {/* Zoom Controls */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-400">확대/축소</label>
                    <span className="text-sm font-black text-white">{zoom}%</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleZoomOut}
                      className="flex-1 bg-gray-800 border-gray-700 hover:bg-gray-700 text-white rounded-xl"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleZoomIn}
                      className="flex-1 bg-gray-800 border-gray-700 hover:bg-gray-700 text-white rounded-xl"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </Button>
                  </div>
                  <Slider
                    value={[zoom]}
                    onValueChange={(v) => setZoom(v[0])}
                    min={50}
                    max={300}
                    step={10}
                    className="w-full"
                  />
                </div>

                {/* Segmentation Overlay Opacity */}
                {showSegmentationOverlay && (
                  <div className="space-y-2 pt-2 border-t border-gray-800">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-green-400">오버레이 투명도</label>
                      <span className="text-sm font-black text-white">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <Slider
                      value={[overlayOpacity * 100]}
                      onValueChange={(v) => setOverlayOpacity(v[0] / 100)}
                      min={0}
                      max={100}
                      step={5}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Rotation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-400">회전</label>
                    <span className="text-sm font-black text-white">{rotation}°</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRotate}
                    className="w-full bg-gray-800 border-gray-700 hover:bg-gray-700 text-white rounded-xl"
                  >
                    <RotateCw className="w-4 h-4 mr-2" />
                    90° 회전
                  </Button>
                </div>

                {/* AI Analysis Results */}
                {aiResult && showAiResult && (
                  <div className="space-y-2 pt-4 border-t border-gray-800">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-gray-400 flex items-center gap-2">
                        <Brain className="w-4 h-4 text-purple-400" />
                        AI 분석 결과
                      </h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAiResult(false)}
                        className="h-6 w-6 p-0 hover:bg-gray-800 rounded-lg"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-700/30 rounded-xl p-4 space-y-3">
                      {aiResult.isPathology ? (
                        <>
                          {/* 병리 이미지 분류 결과 */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-bold text-white">분류 결과</span>
                              <Badge className={`${
                                aiResult.class_name === 'Tumor' 
                                  ? 'bg-red-600 text-white' 
                                  : 'bg-green-600 text-white'
                              } font-bold`}>
                                {aiResult.class_name === 'Tumor' ? '종양' : '정상'}
                              </Badge>
                            </div>

                            <div className="space-y-2">
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-400">신뢰도</span>
                                <span className="text-white font-bold">
                                  {(aiResult.confidence * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div className="flex justify-between text-xs">
                                <span className="text-gray-400">분석 패치 수</span>
                                <span className="text-white font-bold">
                                  {aiResult.num_patches?.toLocaleString() || 0}개
                                </span>
                              </div>
                            </div>

                            {/* 확률 바 */}
                            <div className="space-y-2">
                              <div className="text-xs text-gray-400">클래스별 확률</div>
                              {aiResult.probabilities && Object.entries(aiResult.probabilities).map(([className, prob]: [string, any]) => (
                                <div key={className} className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className="text-gray-300">{className === 'Normal' ? '정상' : '종양'}</span>
                                    <span className="text-white font-bold">{(prob * 100).toFixed(1)}%</span>
                                  </div>
                                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                    <div 
                                      className={`h-full ${className === 'Tumor' ? 'bg-red-500' : 'bg-green-500'}`}
                                      style={{ width: `${prob * 100}%` }}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Top Attention Patches */}
                            {aiResult.top_attention_patches && aiResult.top_attention_patches.length > 0 && (
                              <div className="pt-3 border-t border-gray-800">
                                <p className="text-xs text-gray-400 mb-2">
                                  주요 관심 영역 (Top {aiResult.top_attention_patches.length} 패치)
                                </p>
                                <div className="text-xs text-gray-300 font-mono">
                                  {aiResult.top_attention_patches.join(', ')}
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      ) : aiResult.isMRI ? (
                        <>
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white">종양 영역</span>
                            <Badge className="bg-purple-600 text-white font-bold">
                              {(aiResult.tumor_ratio_percent || (aiResult.tumor_ratio * 100) || 0).toFixed(1)}%
                            </Badge>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400">종양 픽셀</span>
                              <span className="text-white font-bold">
                                {(aiResult.tumor_pixel_count || aiResult.tumor_pixels || 0).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400">전체 픽셀</span>
                              <span className="text-white font-bold">
                                {(aiResult.total_pixel_count || aiResult.total_pixels || 0).toLocaleString()}
                              </span>
                            </div>
                          </div>

                          {(aiResult.segmentation_mask_base64 || aiResult.mask_base64) && (
                            <div className="pt-3 border-t border-gray-800">
                              <p className="text-xs text-gray-400 mb-2">세그멘테이션 마스크</p>
                              <img
                                src={`data:image/png;base64,${aiResult.segmentation_mask_base64 || aiResult.mask_base64}`}
                                alt="Segmentation Mask"
                                className="w-full rounded-lg border border-gray-700"
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {/* 맘모그래피 분류 결과 */}
                          {aiResult.results && Array.isArray(aiResult.results) ? (
                            <div className="space-y-3">
                              <div className="text-xs font-bold text-white mb-2">
                                4장 분석 결과
                              </div>
                              {aiResult.results.map((result: any, idx: number) => {
                                const classNames = ['Mass', 'Calcification', 'Architectural/Asymmetry', 'Normal'];
                                const predictedClass = classNames[result.predicted_class];
                                const probability = result.probability;
                                
                                // 색상 결정
                                let colorClass = 'bg-green-600/20 text-green-400 border-green-600/30';
                                if (predictedClass === 'Mass') {
                                  colorClass = 'bg-red-600/20 text-red-400 border-red-600/30';
                                } else if (predictedClass === 'Calcification') {
                                  colorClass = 'bg-orange-600/20 text-orange-400 border-orange-600/30';
                                } else if (predictedClass === 'Architectural/Asymmetry') {
                                  colorClass = 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30';
                                }

                                return (
                                  <div key={idx} className={`rounded-lg p-3 border ${colorClass}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-bold">
                                        {result.view || `이미지 ${idx + 1}`}
                                      </span>
                                      <Badge className={`${colorClass} text-xs font-bold`}>
                                        {predictedClass}
                                      </Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-gray-400">확률</span>
                                      <span className="text-sm font-bold">
                                        {(probability * 100).toFixed(1)}%
                                      </span>
                                    </div>
                                    {/* 확률 바 */}
                                    <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                      <div 
                                        className={`h-full ${
                                          predictedClass === 'Mass' ? 'bg-red-500' :
                                          predictedClass === 'Calcification' ? 'bg-orange-500' :
                                          predictedClass === 'Architectural/Asymmetry' ? 'bg-yellow-500' :
                                          'bg-green-500'
                                        }`}
                                        style={{ width: `${probability * 100}%` }}
                                      />
                                    </div>
                                    
                                    {/* Grad-CAM 오버레이 이미지 표시 */}
                                    {result.gradcam_overlay && (
                                      <div className="mt-3 pt-3 border-t border-gray-700">
                                        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
                                          <span>🔍</span>
                                          <span>AI 분석 영역 (클릭하여 확대)</span>
                                        </div>
                                        <img 
                                          src={`data:image/png;base64,${result.gradcam_overlay}`}
                                          alt={`Grad-CAM Overlay - ${result.view || `이미지 ${idx + 1}`}`}
                                          className="w-full rounded-lg border border-gray-700 cursor-pointer hover:opacity-80 transition-opacity"
                                          onClick={() => {
                                            // 클릭 시 전체화면으로 보기
                                            const newWindow = window.open('', '_blank');
                                            if (newWindow) {
                                              newWindow.document.write(`
                                                <html>
                                                  <head>
                                                    <title>Grad-CAM Analysis - ${result.view || `이미지 ${idx + 1}`}</title>
                                                    <style>
                                                      body {
                                                        margin: 0;
                                                        padding: 20px;
                                                        background: #000;
                                                        display: flex;
                                                        justify-content: center;
                                                        align-items: center;
                                                        min-height: 100vh;
                                                      }
                                                      img {
                                                        max-width: 100%;
                                                        max-height: 100vh;
                                                        border: 2px solid #333;
                                                        border-radius: 8px;
                                                      }
                                                    </style>
                                                  </head>
                                                  <body>
                                                    <img src="data:image/png;base64,${result.gradcam_overlay}" alt="Grad-CAM Analysis" />
                                                  </body>
                                                </html>
                                              `);
                                            }
                                          }}
                                        />
                                        <p className="text-[10px] text-gray-500 mt-1 text-center">
                                          빨간색 영역 = AI가 주목한 부분
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-gray-400">
                              <CheckCircle className="w-4 h-4 text-green-400" />
                              <span>분석 결과 없음</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Reset & Fullscreen */}
                <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="w-full bg-gray-800 border-gray-700 hover:bg-gray-700 text-white rounded-xl"
                >
                  초기화
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="w-full bg-blue-600/20 border-blue-600/30 hover:bg-blue-600/30 text-blue-400 rounded-xl"
                >
                  <Maximize2 className="w-4 h-4 mr-2" />
                  {isFullscreen ? "전체화면 종료" : "전체화면"}
                </Button>
                </div>

                {/* Keyboard Shortcuts */}
                <div className="pt-4 border-t border-gray-800">
                  <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                    단축키
                  </h4>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-400">이전/다음</span>
                      <span className="text-white font-mono">← →</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">확대/축소</span>
                      <span className="text-white font-mono">+ -</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">회전</span>
                      <span className="text-white font-mono">R</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
