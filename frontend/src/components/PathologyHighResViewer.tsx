/**
 * 병리 이미지 고해상도 뷰어 (OpenSeadragon + DZI)
 * 워커 PC의 타일 서버(DZI) URL로 원본 TIF를 실시간 Crop하여 줌인/줌아웃
 */
import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle } from 'lucide-react';

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

  useEffect(() => {
    if (!open || !containerRef.current || !dziUrl?.trim()) return;

    try {
      viewerRef.current = OpenSeadragon({
        element: containerRef.current,
        tileSources: dziUrl,
        prefixUrl: 'https://openseadragon.github.io/openseadragon/images/',
        showNavigator: true,
        navigatorPosition: 'BOTTOM_RIGHT',
        animationTime: 0.3,
      });
    } catch (err) {
      console.error('OpenSeadragon 초기화 실패:', err);
    }

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [open, dziUrl]);

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
        <div className="flex-1 min-h-0 p-4 pt-2">
          {dziUrl ? (
            <div
              ref={containerRef}
              className="w-full h-full min-h-[500px] bg-slate-900 rounded-lg"
              style={{ minHeight: '60vh' }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-2 text-muted-foreground">
              <AlertCircle className="h-12 w-12" />
              <p>DZI URL이 제공되지 않았습니다.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
