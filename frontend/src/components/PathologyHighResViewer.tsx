/**
 * 병리 이미지 고해상도 뷰어 (OpenSeadragon + DZI)
 * 워커 PC의 타일 서버(DZI) URL → Django 프록시 경유 시 ngrok 헤더 포함
 */
import { useEffect, useRef, useState, useMemo } from 'react';

// OpenSeadragon이 console.assert를 사용하는데, 일부 환경에서 없을 수 있음 → 폴리필
// ⚠️ ES import는 호이스팅되므로 정적 import보다 먼저 실행되지 않음.
//    따라서 OpenSeadragon은 동적 import로 로드하여 폴리필 적용 후에 초기화.
if (typeof window !== 'undefined') {
  if (typeof console === 'undefined') {
    (window as unknown as Record<string, unknown>).console = {} as Console;
  }
  if (typeof console.assert !== 'function') {
    console.assert = function (condition?: boolean, ...args: unknown[]) {
      if (!condition) console.error(...args);
    };
  }
}

// OpenSeadragon 동적 로드 (폴리필 이후 실행 보장)
let _osdPromise: Promise<unknown> | null = null;
function loadOpenSeadragon(): Promise<unknown> {
  if (!_osdPromise) {
    _osdPromise = import('openseadragon');
  }
  return _osdPromise;
}
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, Loader2 } from 'lucide-react';

const DZI_PROXY_PATH = '/api/mri/pathology/dzi-proxy/';

/**
 * 외부 URL(ngrok 등)이면 Django DZI 프록시 URL로 변환.
 * 경로 기반 사용 시 OpenSeadragon이 .dzi → _files/level/col_row.jpeg 로 타일 URL을 올바르게 만듦.
 */
function getEffectiveDziUrl(rawUrl: string): string {
  const url = (rawUrl || '').trim();
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${DZI_PROXY_PATH}${encodeURIComponent(url)}`;
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
    if (!open || !effectiveDziUrl) return;

    setLoadError(null);
    setLoading(true);

    // 디버그: 고해상도 뷰어에서 사용하는 URL (브라우저 콘솔에서 확인)
    console.log('[고해상도 뷰어] raw dziUrl:', dziUrl);
    console.log('[고해상도 뷰어] effectiveDziUrl (프록시):', effectiveDziUrl);

    let cancelled = false;
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // 로딩 타임아웃: open/open-failed가 안 오면 8초 후 로딩 해제 + 안내 (컨테이너가 늦게 붙어도 타임아웃은 항상 동작)
    loadTimeoutId = setTimeout(() => {
      console.warn('[고해상도 뷰어] 8초 타임아웃 — open/open-failed 미발생. Network 탭에서 dzi-proxy 요청 상태 확인.');
      setLoading(false);
      setLoadError((prev) =>
        prev
          ? prev
          : '로딩 시간이 초과되었습니다. 서버 DZI 프록시와 워커 PC를 확인해 주세요.'
      );
    }, 8000);

    // 다이얼로그 레이아웃 완료 후 뷰어 초기화 (컨테이너 크기 확보)
    const timer = setTimeout(() => {
      const containerEl = containerRef.current;
      if (!containerEl) return; // 컨테이너 없으면 뷰어만 스킵, 위 8초 타임아웃으로 안내

      loadOpenSeadragon()
        .then((mod) => {
          if (cancelled) return;
          const OSD = typeof mod === 'function' ? mod : ((mod as { default?: unknown })?.default ?? mod);
          if (typeof OSD !== 'function') {
            setLoading(false);
            setLoadError('뷰어를 시작할 수 없습니다. (OpenSeadragon 로드 실패)');
            return;
          }
          const viewer = (OSD as CallableFunction)({
            element: containerEl,
            tileSources: effectiveDziUrl,
            prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
            showNavigator: true,
            navigatorPosition: 'BOTTOM_RIGHT',
            animationTime: 0.3,
            maxZoomPixelRatio: 4,
            smoothTileEdgesMinZoom: Infinity,
            immediateRender: true,
            loadTilesWithAjax: true,
            ajaxHeaders: {
              'ngrok-skip-browser-warning': 'true',
            },
            debugMode: false,
          });
          viewerRef.current = viewer;

          const osd = viewer as unknown as { addHandler: (name: string, fn: () => void) => void };
          osd.addHandler('open-failed', () => {
            console.error('[고해상도 뷰어] open-failed — DZI/타일 로드 실패. Network 탭에서 실패한 dzi-proxy 요청 확인.');
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
            // 디버그: DZI 메타데이터 정보 출력
            try {
              const v = viewer as unknown as Record<string, unknown>;
              const world = v.world as { getItemAt: (i: number) => unknown } | undefined;
              const tiledImage = world?.getItemAt(0) as Record<string, unknown> | undefined;
              const source = tiledImage?.source as Record<string, unknown> | undefined;
              const dims = source?.dimensions as { x: number; y: number } | undefined;
              const levels = (source as { levels?: unknown[] } | undefined)?.levels;
              const maxLevel = (source as { maxLevel?: number } | undefined)?.maxLevel;
              console.log('[고해상도 뷰어] open — DZI 로드 성공');
              console.log('[고해상도 뷰어] 원본 크기:', dims?.x, 'x', dims?.y);
              console.log('[고해상도 뷰어] 레벨 수:', levels?.length ?? maxLevel ?? 'unknown');
              console.log('[고해상도 뷰어] tileSize:', (source as { tileSize?: number } | undefined)?.tileSize);
            } catch { /* ignore */ }
          });
        })
        .catch((err) => {
          if (cancelled) return;
          if (loadTimeoutId) clearTimeout(loadTimeoutId);
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[고해상도 뷰어] OpenSeadragon 초기화 실패:', err);
          setLoading(false);
          setLoadError(`뷰어를 시작할 수 없습니다. (${msg})`);
        });
    }, 200);

    return () => {
      cancelled = true;
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
