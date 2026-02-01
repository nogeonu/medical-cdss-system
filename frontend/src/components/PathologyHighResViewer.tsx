/**
 * 병리 이미지 고해상도 뷰어 (OpenSeadragon + DZI)
 * 워커 PC의 타일 서버(DZI) URL → Django 프록시 경유 시 ngrok 헤더 포함
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, Loader2 } from 'lucide-react';

const DZI_PROXY_PATH = '/api/mri/pathology/dzi-proxy/';

/** 외부 URL(ngrok 등)이면 Django DZI 프록시 URL로 변환 */
function getEffectiveDziUrl(rawUrl: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${DZI_PROXY_PATH}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

interface PathologyHighResViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 워커 PC 타일 서버 DZI 메타데이터 URL (예: https://xxx.ngrok.app/dzi/tumor_076.tif.dzi) */
  dziUrl: string;
  title?: string;
}

export default function PathologyHighResViewer({
  open,
  onOpenChange,
  dziUrl,
  title = '고해상도 뷰어',
}: PathologyHighResViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ destroy: () => void } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /** 외부 URL이면 프록시 경유, 상대 경로면 그대로 사용 */
  const effectiveDziUrl = useMemo(() => getEffectiveDziUrl(dziUrl), [dziUrl]);

  useEffect(() => {
    if (!open || !containerRef.current || !effectiveDziUrl) return;

    setLoadError(null);
    setLoading(true);

    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // 로딩 타임아웃: open/open-failed가 안 오면 15초 후 로딩 해제 + 안내
    loadTimeoutId = setTimeout(() => {
      setLoading(false);
      setLoadError((prev) =>
        prev
          ? prev
          : '로딩 시간이 초과되었습니다. 서버 DZI 프록시와 워커 PC를 확인해 주세요.'
      );
    }, 15000);

    // 다이얼로그 레이아웃 완료 후 뷰어 초기화 (컨테이너 크기 확보)
    const timer = setTimeout(() => {
      if (!containerRef.current) return;
      try {
        const viewer = OpenSeadragon({
          element: containerRef.current,
          tileSources: effectiveDziUrl,
          prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
          showNavigator: true,
          navigatorPosition: 'BOTTOM_RIGHT',
          animationTime: 0.3,
          loadTilesWithAjax: true,
          ajaxHeaders: {
            'ngrok-skip-browser-warning': 'true',
          },
        });
        viewerRef.current = viewer;

        const osd = viewer as unknown as { addHandler: (name: string, fn: () => void) => void };
        osd.addHandler('open-failed', () => {
          if (loadTimeoutId) clearTimeout(loadTimeoutId);
          loadTimeoutId = null;
          setLoading(false);
          setLoadError('이미지를 불러올 수 없습니다. 워커 PC가 켜져 있는지, DZI 주소가 맞는지 확인해 주세요.');
        });
        osd.addHandler('open', () => {
          if (loadTimeoutId) clearTimeout(loadTimeoutId);
          loadTimeoutId = null;
          setLoading(false);
          setLoadError(null);
        });
      } catch (err) {
        if (loadTimeoutId) clearTimeout(loadTimeoutId);
        console.error('OpenSeadragon 초기화 실패:', err);
        setLoading(false);
        setLoadError('뷰어를 시작할 수 없습니다.');
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      if (loadTimeoutId) clearTimeout(loadTimeoutId);
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      setLoading(true);
      setLoadError(null);
    };
  }, [open, effectiveDziUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-[95vw] h-[85vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            {title}
            <span className="text-xs font-normal text-muted-foreground">
              (워커 PC가 켜져 있어야 합니다)
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 p-4 pt-2 relative">
          {!dziUrl?.trim() ? (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-2 text-muted-foreground">
              <AlertCircle className="h-12 w-12" />
              <p>DZI URL이 제공되지 않았습니다.</p>
              <p className="text-sm">워커 PC에서 분석 완료 시 dzi_url을 보내주어야 합니다.</p>
            </div>
          ) : (
            <>
              <div
                ref={containerRef}
                className="w-full h-full min-h-[500px] bg-slate-900 rounded-lg"
                style={{ minHeight: '60vh' }}
              />
              {loading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 rounded-lg gap-2 text-white">
                  <Loader2 className="h-10 w-10 animate-spin" />
                  <p>이미지 로딩 중… (워커 PC가 켜져 있어야 합니다)</p>
                </div>
              )}
              {loadError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 rounded-lg gap-2 text-red-200 p-4 text-center">
                  <AlertCircle className="h-10 w-10" />
                  <p>{loadError}</p>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
