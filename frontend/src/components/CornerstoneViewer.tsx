/**
 * Cornerstone3D 기반 DICOM 뷰어 컴포넌트
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import {
  RenderingEngine,
  Enums,
  type Types,
  imageLoader,
} from '@cornerstonejs/core';
import {
  addTool,
  ToolGroupManager,
  Enums as ToolEnums,
  LengthTool,
  ProbeTool,
  RectangleROITool,
  EllipticalROITool,
  BidirectionalTool,
  AngleTool,
  ZoomTool,
  PanTool,
  WindowLevelTool,
} from '@cornerstonejs/tools';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Ruler,
  Square,
  Circle,
  MousePointer2,
  Sun,
  Layers,
  Maximize2,
} from 'lucide-react';
import { initCornerstone, createImageId, WINDOW_LEVEL_PRESETS } from '@/lib/cornerstone';

// 전역 렌더링 엔진 캐시 (WebGL 컨텍스트 재사용)
const renderingEngineCache = new Map<string, RenderingEngine>();

function getOrCreateRenderingEngine(engineId: string): RenderingEngine {
  let engine = renderingEngineCache.get(engineId);
  if (!engine) {
    engine = new RenderingEngine(engineId);
    renderingEngineCache.set(engineId, engine);
  }
  return engine;
}

interface CornerstoneViewerProps {
  instanceIds: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  showMeasurementTools?: boolean; // 측정 도구 표시 여부
  viewportId?: string; // 고유 viewport ID (4분할 뷰 등에서 사용)
  segmentationFrames?: Array<{ index: number; mask_base64: string }>; // 세그멘테이션 프레임
  showSegmentation?: boolean; // 세그멘테이션 오버레이 표시 여부
  onToggleSegmentation?: (enabled: boolean) => void; // 세그멘테이션 토글 콜백
}

export default function CornerstoneViewer({
  instanceIds,
  currentIndex,
  onIndexChange,
  showMeasurementTools = true, // 기본값 true
  viewportId, // 외부에서 전달받은 고유 ID
  segmentationFrames = [], // 세그멘테이션 프레임
  showSegmentation = false, // 세그멘테이션 오버레이 표시 여부
  onToggleSegmentation, // 세그멘테이션 토글 콜백
}: CornerstoneViewerProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isImageLoading, setIsImageLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<string>('WindowLevel');
  const [windowLevel, setWindowLevel] = useState(WINDOW_LEVEL_PRESETS.DEFAULT);
  const [isOriginalSize, setIsOriginalSize] = useState(false);
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImageSizeRef = useRef<{ width: number; height: number } | null>(null);
  // 고유한 ID 생성 (컴포넌트마다 다른 ID 사용)
  // viewportId가 제공되면 사용, 아니면 랜덤 생성
  const uniqueId = viewportId || `${Date.now()}_${Math.random()}`;
  const renderingEngineIdRef = useRef<string>(`renderingEngine_${uniqueId}`);
  const viewportIdRef = useRef<string>(`viewport_${uniqueId}`);
  const toolGroupIdRef = useRef<string>(`toolGroup_${uniqueId}`);

  // Cornerstone 초기화
  useEffect(() => {
    const initialize = async () => {
      try {
        await initCornerstone();

        // 측정 도구 등록
        addTool(LengthTool);
        addTool(ProbeTool);
        addTool(RectangleROITool);
        addTool(EllipticalROITool);
        addTool(BidirectionalTool);
        addTool(AngleTool);
        addTool(ZoomTool);
        addTool(PanTool);
        addTool(WindowLevelTool);

        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize Cornerstone:', error);
      }
    };

    initialize();
  }, []);

  // 뷰포트 설정
  useEffect(() => {
    if (!isInitialized || !viewportRef.current || instanceIds.length === 0) {
      return;
    }

    const setupViewport = async () => {
      // 작은 데이터셋(유방촬영술 등)은 로딩 표시 최소화
      const isSmallDataset = instanceIds.length <= 10;
      if (!isSmallDataset) {
        setIsImageLoading(true);
      }

      try {
        const element = viewportRef.current!;
        const renderingEngineId = renderingEngineIdRef.current;
        const viewportId = viewportIdRef.current;

        // 전역 캐시에서 렌더링 엔진 가져오기 또는 생성
        const renderingEngine = getOrCreateRenderingEngine(renderingEngineId);
        renderingEngineRef.current = renderingEngine;

        // 기존 뷰포트 확인 및 재사용
        let viewport;
        try {
          viewport = renderingEngine.getViewport(viewportId);
          // 뷰포트가 있지만 element가 바뀔었으면 재바인딩 필요
          if (viewport) {
            // 기존 뷰포트 비활성화
            renderingEngine.disableElement(viewportId);
            // 새 element로 재활성화
            const viewportInput = {
              viewportId,
              type: Enums.ViewportType.STACK,
              element,
              defaultOptions: {
                background: [0, 0, 0] as Types.Point3,
              },
            };
            renderingEngine.enableElement(viewportInput);
            viewport = renderingEngine.getViewport(viewportId);
          }
        } catch (e) {
          // 뷰포트가 없으면 새로 생성
          viewport = null;
        }

        // 뷰포트가 없을 때만 새로 생성
        if (!viewport) {
          const viewportInput = {
            viewportId,
            type: Enums.ViewportType.STACK,
            element,
            defaultOptions: {
              background: [0, 0, 0] as Types.Point3,
            },
          };

          renderingEngine.enableElement(viewportInput);
          viewport = renderingEngine.getViewport(viewportId);
        }

        // 이미지 ID 생성
        const imageIds = instanceIds.map((id) =>
          createImageId(`/api/mri/orthanc/instances/${id}/file`)
        );

        // 스택 업데이트 (기존 뷰포트 재사용 또는 새 뷰포트)
        if (viewport) {
          // 작은 데이터셋은 await하지 않고 즉시 렌더링 (MRI처럼 빠르게)
          if (isSmallDataset) {
            // 즉시 setStack 호출 (await 없이)
            // @ts-ignore - Stack viewport specific method
            viewport.setStack(imageIds, currentIndex).catch((err: any) => {
              console.warn('Failed to load some images, but continuing:', err);
            });
            // 즉시 렌더링
            viewport.render();
            // 로딩 상태 즉시 해제
            setIsImageLoading(false);
          } else {
            // 큰 데이터셋은 기존 방식 유지
            // @ts-ignore - Stack viewport specific method
            await viewport.setStack(imageIds, currentIndex).catch((err: any) => {
              console.warn('Failed to load some images, but continuing:', err);
            });
            // 첫 렌더링 (DICOM의 기본 Window/Level 사용)
            viewport.render();
          }

          // DICOM 메타데이터에서 Window/Level 가져오기
          if (isSmallDataset) {
            // 작은 데이터셋: 비동기로 Window/Level 설정 (로딩 블로킹 없음)
            setTimeout(() => {
              try {
                // @ts-ignore
                const image = viewport.getImageData();
                if (image) {
                  const dicomWindowWidth = image.windowWidth?.[0];
                  const dicomWindowCenter = image.windowCenter?.[0];

                  if (dicomWindowWidth && dicomWindowCenter) {
                    setWindowLevel({
                      windowWidth: dicomWindowWidth,
                      windowCenter: dicomWindowCenter,
                    });

                    // @ts-ignore
                    viewport.setProperties({
                      voiRange: {
                        lower: dicomWindowCenter - dicomWindowWidth / 2,
                        upper: dicomWindowCenter + dicomWindowWidth / 2,
                      },
                    });
                    viewport.render();
                  }
                }
              } catch (e) {
                console.warn('Could not read DICOM Window/Level', e);
              }
            }, 100);
          } else {
            // 큰 데이터셋: 기존 방식 (동기 처리)
            try {
              // @ts-ignore
              const image = viewport.getImageData();
              if (image) {
                const dicomWindowWidth = image.windowWidth?.[0];
                const dicomWindowCenter = image.windowCenter?.[0];

                if (dicomWindowWidth && dicomWindowCenter) {
                  console.log(`Using DICOM Window/Level: W=${dicomWindowWidth}, C=${dicomWindowCenter}`);
                  setWindowLevel({
                    windowWidth: dicomWindowWidth,
                    windowCenter: dicomWindowCenter,
                  });

                  // @ts-ignore
                  viewport.setProperties({
                    voiRange: {
                      lower: dicomWindowCenter - dicomWindowWidth / 2,
                      upper: dicomWindowCenter + dicomWindowWidth / 2,
                    },
                  });
                  viewport.render();
                }
              }
            } catch (e) {
              console.warn('Could not read DICOM Window/Level, using defaults', e);
            }
          }

          // 원본 이미지 크기 저장
          try {
            // @ts-ignore
            const image = viewport.getImageData();
            if (image) {
              originalImageSizeRef.current = {
                width: image.width || image.dimensions?.[0] || 512,
                height: image.height || image.dimensions?.[1] || 512,
              };
              console.log('원본 이미지 크기:', originalImageSizeRef.current);
            }
          } catch (e) {
            console.warn('Could not get image dimensions', e);
          }
        }

        // 도구 그룹 설정
        setupTools(viewportId);

        if (!isSmallDataset) {
          setIsImageLoading(false);
        }
      } catch (error) {
        console.error('Failed to setup viewport:', error);
        setIsImageLoading(false);
      }
    };

    setupViewport();

    // 클린업 함수: 컴포넌트 언마운트 시 리소스 정리
    return () => {
      const renderingEngineId = renderingEngineIdRef.current;
      const viewportId = viewportIdRef.current;
      const toolGroupId = toolGroupIdRef.current;

      console.log(`Cleaning up viewport: ${viewportId}`);

      // 1. 도구 그룹에서 뷰포트 제거
      try {
        const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
        if (toolGroup && renderingEngineRef.current) {
          toolGroup.removeViewports(renderingEngineRef.current.id, viewportId);
        }
      } catch (e) {
        console.warn('Error removing viewport from tool group:', e);
      }

      // 2. 뷰포트 비활성화
      if (renderingEngineRef.current) {
        try {
          renderingEngineRef.current.disableElement(viewportId);
        } catch (e) {
          console.warn('Error disabling viewport:', e);
        }
      }

      // 3. 렌더링 엔진 destroy 및 캐시에서 제거
      if (renderingEngineRef.current) {
        try {
          // 렌더링 엔진에 연결된 모든 뷰포트 확인
          const viewportIds = renderingEngineRef.current.getViewports().map(vp => vp.id);

          // 이 렌더링 엔진에 다른 뷰포트가 없으면 완전히 destroy
          if (viewportIds.length === 0 || (viewportIds.length === 1 && viewportIds[0] === viewportId)) {
            console.log(`Destroying rendering engine: ${renderingEngineId}`);
            renderingEngineRef.current.destroy();
            renderingEngineCache.delete(renderingEngineId);
          }
        } catch (e) {
          console.warn('Error destroying rendering engine:', e);
        }
      }

      renderingEngineRef.current = null;
    };
  }, [isInitialized, instanceIds]); // 원래대로 복구

  // 마지막으로 렌더링된 인덱스 추적 (중복 렌더링 방지)
  const lastRenderedIndexRef = useRef<number>(-1);

  // Slice Config (VolView 스타일)
  const sliceConfig = useMemo(() => {
    return {
      slice: currentIndex,
      range: [0, instanceIds.length - 1] as [number, number],
      step: 1,
    };
  }, [currentIndex, instanceIds.length]);

  // 슬라이스 변경 (VolView 스타일: 즉시 반응)
  useEffect(() => {
    if (!renderingEngineRef.current) return;

    // 이미 렌더링된 인덱스면 스킵 (휠 이벤트에서 이미 처리됨)
    if (lastRenderedIndexRef.current === currentIndex) {
      return;
    }

    try {
      const viewport = renderingEngineRef.current.getViewport(viewportIdRef.current);
      if (viewport) {
        // @ts-ignore
        viewport.setImageIdIndex(currentIndex);
        viewport.render();
        lastRenderedIndexRef.current = currentIndex;
      }
    } catch (error) {
      console.error('Failed to change slice:', error);
    }
  }, [currentIndex]);

  // 이미지 프리로딩 (인접 이미지 미리 로드 - 유방촬영술 최적화)
  useEffect(() => {
    if (!isInitialized || instanceIds.length === 0) return;

    const isSmallDataset = instanceIds.length <= 10;
    const preloadRange = isSmallDataset ? instanceIds.length : 5;
    const indicesToPreload: number[] = [];

    if (isSmallDataset) {
      // 작은 데이터셋: 현재 이미지 제외한 나머지
      for (let i = 0; i < instanceIds.length; i++) {
        if (i !== currentIndex) {
          indicesToPreload.push(i);
        }
      }
    } else {
      // 큰 데이터셋: 현재 ±5개만 프리로드
      for (let i = -preloadRange; i <= preloadRange; i++) {
        const index = currentIndex + i;
        if (index >= 0 && index < instanceIds.length && index !== currentIndex) {
          indicesToPreload.push(index);
        }
      }
    }

    // 우선순위 기반 프리로드 (가까운 이미지 우선)
    const priorityOrder = indicesToPreload.sort((a, b) => {
      const distA = Math.abs(a - currentIndex);
      const distB = Math.abs(b - currentIndex);
      return distA - distB;
    });

    // 유방촬영술 최적화: 현재 이미지 우선 로드 후 나머지 순차 로드
    if (isSmallDataset && priorityOrder.length > 0) {
      // 현재 이미지 먼저 로드 (이미 로드되었을 수 있지만 확실히 보장)
      const currentImageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[currentIndex]}/file`);
      imageLoader.loadAndCacheImage(currentImageId).then(() => {
        // 나머지는 순차적으로 로드 (네트워크 부하 분산)
        priorityOrder.forEach((index, i) => {
          setTimeout(() => {
            const imageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[index]}/file`);
            imageLoader.loadAndCacheImage(imageId).catch(() => null);
          }, i * 200); // 200ms 간격으로 순차 로드
        });
      }).catch(() => {
        // 현재 이미지 로드 실패 시에도 나머지 시도
        priorityOrder.forEach((index, i) => {
          setTimeout(() => {
            const imageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[index]}/file`);
            imageLoader.loadAndCacheImage(imageId).catch(() => null);
          }, i * 200);
        });
      });
    } else {
      // MRI 등 큰 데이터셋: 병렬 로드 (기존 방식)
      Promise.all(
        priorityOrder.map(index => {
          const imageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[index]}/file`);
          return imageLoader.loadAndCacheImage(imageId).catch(() => null);
        })
      ).catch(() => {
        // 프리로드 실패는 무시
      });
    }
  }, [currentIndex, instanceIds, isInitialized]);

  // 초기 배치 프리로드 (유방촬영술 최적화: 현재 이미지 우선)
  useEffect(() => {
    if (!isInitialized || instanceIds.length === 0) return;

    const isSmallDataset = instanceIds.length <= 10;
    const initialBatchSize = isSmallDataset ? instanceIds.length : Math.min(10, instanceIds.length);
    const initialIndices: number[] = [];

    if (isSmallDataset) {
      // 작은 데이터셋: 현재 이미지 우선, 나머지는 순차 로드
      initialIndices.push(currentIndex); // 현재 이미지만 초기에 로드
    } else {
      // 큰 데이터셋: 첫 배치 + 현재 인덱스 주변
      for (let i = 0; i < initialBatchSize; i++) {
        initialIndices.push(i);
      }
      // 현재 인덱스 주변도 추가
      const range = 3;
      for (let i = -range; i <= range; i++) {
        const idx = currentIndex + i;
        if (idx >= 0 && idx < instanceIds.length && !initialIndices.includes(idx)) {
          initialIndices.push(idx);
        }
      }
    }

    // 우선순위: 현재 인덱스 > 첫 배치 > 나머지
    const priorityOrder = [
      currentIndex, // 현재 이미지 최우선
      ...initialIndices.filter(i => i !== currentIndex)
    ];

    // 유방촬영술 최적화: 현재 이미지 먼저, 나머지는 순차 로드
    if (isSmallDataset && priorityOrder.length > 1) {
      // 현재 이미지 즉시 로드
      const currentImageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[currentIndex]}/file`);
      imageLoader.loadAndCacheImage(currentImageId).then(() => {
        // 나머지는 순차적으로 로드 (200ms 간격)
        const remainingIndices = priorityOrder.filter(i => i !== currentIndex);
        remainingIndices.forEach((index, i) => {
          setTimeout(() => {
            const imageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[index]}/file`);
            imageLoader.loadAndCacheImage(imageId).catch(() => null);
          }, (i + 1) * 200);
        });
      }).catch(() => {
        // 현재 이미지 로드 실패 시에도 나머지 시도
        const remainingIndices = priorityOrder.filter(i => i !== currentIndex);
        remainingIndices.forEach((index, i) => {
          setTimeout(() => {
            const imageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[index]}/file`);
            imageLoader.loadAndCacheImage(imageId).catch(() => null);
          }, (i + 1) * 200);
        });
      });
    } else {
      // MRI 등 큰 데이터셋: 병렬 로드 (기존 방식)
      Promise.all(
        priorityOrder.map(index => {
          const imageId = createImageId(`/api/mri/orthanc/instances/${instanceIds[index]}/file`);
          return imageLoader.loadAndCacheImage(imageId).catch(() => null);
        })
      ).catch(() => {
        // 배치 프리로드 실패는 무시
      });
    }
  }, [instanceIds, isInitialized, currentIndex]);

  // 윈도우 레벨 변경
  useEffect(() => {
    if (!renderingEngineRef.current) return;

    try {
      const viewport = renderingEngineRef.current.getViewport(viewportIdRef.current);
      if (viewport) {
        // @ts-ignore - setProperties exists but types are incomplete
        viewport.setProperties({
          voiRange: {
            lower: windowLevel.windowCenter - windowLevel.windowWidth / 2,
            upper: windowLevel.windowCenter + windowLevel.windowWidth / 2,
          },
        });
        viewport.render();
      }
    } catch (error) {
      console.error('Failed to change window level:', error);
    }
  }, [windowLevel]);

  // 세그멘테이션 오버레이 렌더링 (조원 코드와 동일: 마젠타 윤곽선 + 반투명 보라색 채움)
  useEffect(() => {
    console.log(`[CornerstoneViewer] 오버레이 렌더링 체크: showSegmentation=${showSegmentation}, frames.length=${segmentationFrames.length}, currentIndex=${currentIndex}, overlayCanvasRef.current=${!!overlayCanvasRef.current}`);

    if (!showSegmentation) {
      console.log('[CornerstoneViewer] showSegmentation이 false - 오버레이 숨김');
      // Canvas 초기화
      if (overlayCanvasRef.current) {
        const ctx = overlayCanvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
        }
      }
      return;
    }

    if (!segmentationFrames.length) {
      console.log('[CornerstoneViewer] segmentationFrames가 비어있음');
      return;
    }

    if (!overlayCanvasRef.current) {
      console.log('[CornerstoneViewer] overlayCanvasRef가 없음 - 잠시 후 재시도');
      // DOM이 아직 준비되지 않았을 수 있으므로 약간의 지연 후 재시도
      const timeout = setTimeout(() => {
        if (overlayCanvasRef.current) {
          console.log('[CornerstoneViewer] 재시도: overlayCanvasRef가 준비됨');
        }
      }, 100);
      return () => clearTimeout(timeout);
    }

    const frame = segmentationFrames.find((f: any) => f.index === currentIndex) || segmentationFrames[currentIndex];
    if (!frame || !frame.mask_base64) {
      console.log(`[CornerstoneViewer] 프레임을 찾을 수 없음: currentIndex=${currentIndex}, frames.length=${segmentationFrames.length}`);
      console.log(`[CornerstoneViewer] segmentationFrames 인덱스들:`, segmentationFrames.map((f: any) => f.index).slice(0, 10));
      console.log(`[CornerstoneViewer] segmentationFrames 샘플:`, segmentationFrames.slice(0, 3).map((f: any) => ({ index: f.index, hasMask: !!f.mask_base64 })));
      return;
    }

    console.log(`[CornerstoneViewer] 세그멘테이션 오버레이 렌더링 시작: currentIndex=${currentIndex}, frame.index=${frame.index}`);

    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[CornerstoneViewer] Canvas context를 가져올 수 없음');
      return;
    }

    // Canvas 크기 설정 (원본 크기 모드면 원본 픽셀 크기 사용)
    const container = canvas.parentElement;
    if (isOriginalSize && originalImageSizeRef.current) {
      // 원본 크기 모드: 원본 픽셀 크기 사용
      const { width, height } = originalImageSizeRef.current;
      canvas.width = width;
      canvas.height = height;
      console.log(`[CornerstoneViewer] Canvas 원본 크기 설정: ${width}×${height}`);
    } else if (container) {
      // 뷰포트 맞춤 모드: 컨테이너 크기 사용
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        console.log(`[CornerstoneViewer] Canvas 크기 설정: ${rect.width}×${rect.height}`);
      } else {
        console.warn(`[CornerstoneViewer] Container 크기가 0: ${rect.width}×${rect.height}`);
        // fallback: viewportRef를 사용
        if (viewportRef.current) {
          const viewportRect = viewportRef.current.getBoundingClientRect();
          if (viewportRect.width > 0 && viewportRect.height > 0) {
            canvas.width = viewportRect.width;
            canvas.height = viewportRect.height;
            console.log(`[CornerstoneViewer] Canvas 크기 설정 (viewportRef): ${viewportRect.width}×${viewportRect.height}`);
          }
        }
      }
    }

    // Canvas 초기화 (투명하게)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 마스크 이미지 로드
    const maskImg = new Image();
    maskImg.onload = () => {
      console.log(`[CornerstoneViewer] 마스크 이미지 로드 완료: ${maskImg.width}×${maskImg.height}`);
      // 마스크 이미지 크기 계산
      let scale: number;
      let x: number, y: number, w: number, h: number;
      
      if (isOriginalSize && originalImageSizeRef.current) {
        // 원본 크기 모드: 1:1 픽셀 매핑
        scale = 1;
        x = 0;
        y = 0;
        w = maskImg.width;
        h = maskImg.height;
        console.log(`[CornerstoneViewer] 원본 크기 모드: 마스크 1:1 매핑`);
      } else {
        // 뷰포트 맞춤 모드: object-contain 방식
        scale = Math.min(canvas.width / maskImg.width, canvas.height / maskImg.height);
        x = (canvas.width - maskImg.width * scale) / 2;
        y = (canvas.height - maskImg.height * scale) / 2;
        w = maskImg.width * scale;
        h = maskImg.height * scale;
      }

      // 임시 Canvas에 마스크 이미지 그리기
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = maskImg.width;
      tempCanvas.height = maskImg.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      tempCtx.drawImage(maskImg, 0, 0);
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const data = imageData.data;

      // 마스크를 그레이스케일 그대로 사용하되, 반투명하게 오버레이
      // 마스크 영역은 그레이스케일 값 그대로 유지, alpha만 적용
      for (let i = 0; i < data.length; i += 4) {
        const gray = data[i]; // 그레이스케일 값 (0-255)
        if (gray > 0) { // 마스크 영역
          // Magenta (#FF00FF) 색상 적용
          data[i] = 255;     // Red
          data[i + 1] = 0;   // Green
          data[i + 2] = 255; // Blue
          data[i + 3] = Math.floor(gray * 0.4); // A (40% 투명도)
        } else {
          data[i + 3] = 0; // 마스크가 아닌 부분은 완전히 투명
        }
      }


      // 변환된 이미지 데이터를 메인 Canvas에 그리기
      if (isOriginalSize && scale === 1) {
        // 원본 크기 모드: 1:1 픽셀 매핑 (스케일링 불필요)
        ctx.putImageData(imageData, 0, 0);
      } else {
        // 뷰포트 맞춤 모드: 스케일링 필요
        const scaledImageData = ctx.createImageData(w, h);
        // 이미지 데이터를 스케일링하여 복사 (간단한 nearest neighbor)
        const scaleX = maskImg.width / w;
        const scaleY = maskImg.height / h;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const sx = Math.floor(dx * scaleX);
            const sy = Math.floor(dy * scaleY);
            const srcIdx = (sy * maskImg.width + sx) * 4;
            const dstIdx = (dy * w + dx) * 4;

            if (srcIdx < data.length && data[srcIdx + 3] > 0) {
              scaledImageData.data[dstIdx] = data[srcIdx];
              scaledImageData.data[dstIdx + 1] = data[srcIdx + 1];
              scaledImageData.data[dstIdx + 2] = data[srcIdx + 2];
              scaledImageData.data[dstIdx + 3] = data[srcIdx + 3];
            }
          }
        }
        ctx.putImageData(scaledImageData, x, y);
      }
      console.log('[CornerstoneViewer] 세그멘테이션 오버레이 렌더링 완료');
    };
    maskImg.onerror = (e) => {
      console.error('[CornerstoneViewer] 마스크 이미지 로드 실패:', e, 'frame:', frame);
    };
    maskImg.src = `data:image/png;base64,${frame.mask_base64}`;

    // Cleanup function
    return () => {
      maskImg.onerror = null;
      maskImg.onload = null;
    };
  }, [showSegmentation, segmentationFrames, currentIndex, isOriginalSize]);

  // 도구 설정
  const setupTools = (viewportId: string) => {
    try {
      // 기존 도구 그룹 확인 또는 새로 생성
      let toolGroup = ToolGroupManager.getToolGroup(toolGroupIdRef.current);

      if (!toolGroup) {
        // 도구 그룹이 없으면 새로 생성
        toolGroup = ToolGroupManager.createToolGroup(toolGroupIdRef.current);
      }

      if (toolGroup) {
        // 기존 뷰포트 연결 제거 (있다면)
        try {
          toolGroup.removeViewports(renderingEngineRef.current!.id, viewportId);
        } catch (e) {
          // 뷰포트가 연결되어 있지 않으면 무시
        }

        // 도구 추가 (이미 추가된 경우 무시됨)
        try {
          toolGroup.addTool(WindowLevelTool.toolName);
          toolGroup.addTool(PanTool.toolName);
          toolGroup.addTool(ZoomTool.toolName);
          toolGroup.addTool(LengthTool.toolName);
          toolGroup.addTool(ProbeTool.toolName);
          toolGroup.addTool(RectangleROITool.toolName);
          toolGroup.addTool(EllipticalROITool.toolName);
          toolGroup.addTool(BidirectionalTool.toolName);
          toolGroup.addTool(AngleTool.toolName);
        } catch (e) {
          // 도구가 이미 추가되어 있으면 무시
        }

        // 기본 도구 활성화
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
        });
        toolGroup.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }],
        });
        toolGroup.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }],
        });

        // 뷰포트에 도구 그룹 연결
        toolGroup.addViewport(viewportId, renderingEngineRef.current!.id);
      }
    } catch (error) {
      console.error('Failed to setup tools:', error);
    }
  };

  // 도구 변경
  const handleToolChange = (toolName: string) => {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupIdRef.current);
    if (!toolGroup) return;

    // 모든 도구 비활성화
    toolGroup.setToolPassive(LengthTool.toolName);
    toolGroup.setToolPassive(ProbeTool.toolName);
    toolGroup.setToolPassive(RectangleROITool.toolName);
    toolGroup.setToolPassive(EllipticalROITool.toolName);
    toolGroup.setToolPassive(BidirectionalTool.toolName);
    toolGroup.setToolPassive(AngleTool.toolName);
    toolGroup.setToolPassive(WindowLevelTool.toolName);

    // 선택한 도구 활성화
    toolGroup.setToolActive(toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
    });

    setActiveTool(toolName);
  };

  // 원본 크기 토글
  const handleOriginalSize = () => {
    if (!renderingEngineRef.current) return;

    try {
      const viewport = renderingEngineRef.current.getViewport(viewportIdRef.current);
      if (!viewport) return;

      if (!isOriginalSize) {
        // 원본 크기로 설정 (1:1 픽셀)
        // @ts-ignore
        const image = viewport.getImageData();
        if (image && originalImageSizeRef.current) {
          const { width, height } = originalImageSizeRef.current;
          const element = viewportRef.current;
          if (element) {
            const elementRect = element.getBoundingClientRect();
            
            // @ts-ignore
            const camera = viewport.getCamera();
            if (camera) {
              // 1:1 픽셀 비율로 zoom 설정
              // parallelScale을 원본 이미지 높이의 절반으로 설정하면 1:1 픽셀 비율이 됨
              // @ts-ignore
              viewport.setCamera({
                ...camera,
                parallelScale: height / 2, // 원본 높이의 절반 (1:1 픽셀)
              });
              viewport.render();
              setIsOriginalSize(true);
              console.log('원본 크기 모드 활성화:', { width, height, elementSize: elementRect });
            }
          }
        }
      } else {
        // 뷰포트에 맞춤
        // @ts-ignore
        viewport.resetCamera();
        viewport.render();
        setIsOriginalSize(false);
        console.log('뷰포트 맞춤 모드 활성화');
      }
    } catch (error) {
      console.error('원본 크기 설정 실패:', error);
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-900 text-white">
        Cornerstone3D 초기화 중...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* 도구 바 */}
      {showMeasurementTools && (
        <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Badge variant="outline" className="text-white border-gray-600 font-bold">
            측정 도구
          </Badge>
          <Button
            size="sm"
            variant={activeTool === WindowLevelTool.toolName ? 'default' : 'outline'}
            onClick={() => handleToolChange(WindowLevelTool.toolName)}
            className={`h-9 transition-all ${activeTool === WindowLevelTool.toolName
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
          >
            <Sun className="w-4 h-4 mr-1" />
            윈도우/레벨
          </Button>
          <div className="w-px h-6 bg-gray-600" />
          <Button
            size="sm"
            variant={activeTool === LengthTool.toolName ? 'default' : 'outline'}
            onClick={() => handleToolChange(LengthTool.toolName)}
            className={`h-9 transition-all ${activeTool === LengthTool.toolName
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
          >
            <Ruler className="w-4 h-4 mr-1" />
            거리 측정
          </Button>
          <Button
            size="sm"
            variant={activeTool === RectangleROITool.toolName ? 'default' : 'outline'}
            onClick={() => handleToolChange(RectangleROITool.toolName)}
            className={`h-9 transition-all ${activeTool === RectangleROITool.toolName
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
          >
            <Square className="w-4 h-4 mr-1" />
            사각형 ROI
          </Button>
          <Button
            size="sm"
            variant={activeTool === EllipticalROITool.toolName ? 'default' : 'outline'}
            onClick={() => handleToolChange(EllipticalROITool.toolName)}
            className={`h-9 transition-all ${activeTool === EllipticalROITool.toolName
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
          >
            <Circle className="w-4 h-4 mr-1" />
            타원 ROI
          </Button>
          <div className="w-px h-6 bg-gray-600" />
          <Button
            size="sm"
            variant={showSegmentation ? 'default' : 'outline'}
            onClick={() => onToggleSegmentation?.(!showSegmentation)}
            className={`h-9 transition-all ${showSegmentation
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
            disabled={segmentationFrames.length === 0}
          >
            <Layers className="w-4 h-4 mr-1" />
            병변탐지 {showSegmentation ? 'ON' : 'OFF'}
          </Button>
          <Button
            size="sm"
            variant={activeTool === ProbeTool.toolName ? 'default' : 'outline'}
            onClick={() => handleToolChange(ProbeTool.toolName)}
            className={`h-9 transition-all ${activeTool === ProbeTool.toolName
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
          >
            <MousePointer2 className="w-4 h-4 mr-1" />
            픽셀 값
          </Button>
          <div className="w-px h-6 bg-gray-600" />
          <Button
            size="sm"
            variant={isOriginalSize ? 'default' : 'outline'}
            onClick={handleOriginalSize}
            className={`h-9 transition-all ${isOriginalSize
              ? 'bg-purple-600 hover:bg-purple-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600'
              }`}
          >
            <Maximize2 className="w-4 h-4 mr-1" />
            원본 크기 {isOriginalSize ? 'ON' : 'OFF'}
          </Button>
        </div>
      )}

      {/* 뷰포트 */}
      <div
        className="flex-1 relative"
        onWheel={(e) => {
          if (instanceIds.length === 0 || !renderingEngineRef.current) return;
          e.preventDefault();

          const viewport = renderingEngineRef.current.getViewport(viewportIdRef.current);
          if (!viewport) return;

          // Cornerstone.js 스타일: 즉시 이미지 업데이트
          const delta = e.deltaY > 0 ? 1 : -1;
          const { range, step } = sliceConfig;
          const newSlice = Math.max(
            range[0],
            Math.min(range[1], currentIndex + delta * step)
          );
          const roundedSlice = Math.round(newSlice);

          // Cornerstone.js처럼 즉시 뷰포트 업데이트 (중복 체크)
          if (roundedSlice !== lastRenderedIndexRef.current && roundedSlice !== currentIndex) {
            try {
              // Cornerstone.js의 updateImage()처럼 즉시 업데이트
              // @ts-ignore
              viewport.setImageIdIndex(roundedSlice);
              viewport.render();
              lastRenderedIndexRef.current = roundedSlice;

              // 상태는 나중에 동기화 (Cornerstone.js처럼 부드러운 전환)
              // requestAnimationFrame으로 다음 프레임에 상태 업데이트
              requestAnimationFrame(() => {
                if (roundedSlice !== currentIndex) {
                  onIndexChange(roundedSlice);
                }
              });
            } catch (error) {
              console.error('Failed to render slice:', error);
            }
          }
        }}
      >
        <div
          ref={viewportRef}
          className="w-full h-full relative"
          style={{ minHeight: '400px' }}
        />

        {/* 세그멘테이션 오버레이 레이어 - Canvas를 사용하여 조원 코드와 동일하게: 마젠타 윤곽선 + 반투명 보라색 채움 */}
        {showSegmentation && segmentationFrames.length > 0 && (
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 pointer-events-none z-10 w-full h-full"
          />
        )}

        {/* 로딩 스켈레톤 */}
        {isImageLoading && (
          <div className="absolute inset-0 bg-gray-900 flex items-center justify-center z-30">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-white text-sm font-medium">이미지 로딩 중...</p>
            </div>
          </div>
        )}

        {/* 오버레이 정보 */}
        <div className="absolute top-12 left-4 flex flex-col gap-1.5 pointer-events-none z-20">
          <Badge className="bg-black/60 backdrop-blur-md text-white border-none text-xs px-2 py-0.5">
            슬라이스: {currentIndex + 1} / {instanceIds.length}
          </Badge>
          <Badge className="bg-blue-600/80 backdrop-blur-md text-white border-none text-xs px-2 py-0.5">
            W: {windowLevel.windowWidth} / L: {windowLevel.windowCenter}
          </Badge>
          {activeTool !== WindowLevelTool.toolName && (
            <Badge className="bg-green-600/80 backdrop-blur-md text-white border-none animate-pulse">
              {activeTool === LengthTool.toolName && '📏 클릭하여 거리 측정'}
              {activeTool === RectangleROITool.toolName && '⬜ 드래그하여 사각형 그리기'}
              {activeTool === EllipticalROITool.toolName && '⭕ 드래그하여 타원 그리기'}
              {activeTool === ProbeTool.toolName && '🔍 클릭하여 픽셀 값 확인'}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

