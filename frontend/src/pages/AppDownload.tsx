import { useEffect, useState } from "react";
import { Download, Smartphone, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  assets: ReleaseAsset[];
}

export default function AppDownload() {
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLatestRelease = async () => {
      try {
        // Django 백엔드 프록시를 통해 GitHub API 호출
        const response = await fetch("/api/github/latest-release");
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || "최신 릴리즈를 가져올 수 없습니다.");
        }
        const data = await response.json();
        setRelease(data);
      } catch (err) {
        console.error("GitHub 릴리즈 조회 오류:", err);
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchLatestRelease();
  }, []);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const apkAsset = release?.assets.find((asset) => asset.name.endsWith(".apk"));
  const ipaAsset = release?.assets.find((asset) => asset.name.endsWith(".ipa"));

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* 헤더 */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">
              MOBILE APP DOWNLOAD
            </p>
            <h1 className="text-2xl font-bold text-slate-800">
              CDSS 메디컬 센터 환자 앱
            </h1>
            <p className="text-sm text-slate-500">
              언제 어디서나 간편하게 진료 예약, 건강 기록 확인, 의료진과의 소통이 가능합니다.
            </p>
          </div>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 rounded-full px-4 text-xs"
          >
            <Link to="/">홈으로</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto mt-10 max-w-5xl space-y-8 px-6">

        {/* 기능 소개 */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 mb-1">간편한 예약</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    병원 방문 없이 모바일에서 진료 예약부터 확인까지 한 번에
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 mb-1">안전한 개인정보</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    암호화된 통신으로 개인 건강 정보를 안전하게 보호합니다
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800 mb-1">실시간 알림</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    예약 확인, 진료 일정 등 중요한 정보를 푸시 알림으로 전달
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 다운로드 섹션 */}
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-8">
            {loading && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-sm text-slate-500">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                최신 버전 정보를 불러오는 중입니다...
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
                <p className="font-semibold text-red-600">{error}</p>
                <p className="mt-2 text-sm text-red-500">
                  잠시 후 다시 시도해주세요.
                </p>
              </div>
            )}

            {!loading && !error && release && (apkAsset || ipaAsset) && (
              <div className="space-y-6">
                {/* 앱 이미지 */}
                <div className="flex justify-center mb-6 w-full">
                  <img 
                    src="/images/phone1.png" 
                    alt="CDSS Mobile App" 
                    className="w-full max-w-4xl h-auto object-contain"
                  />
                </div>
                
                {/* 버전 정보 헤더 */}
                <div className="flex items-start gap-3 pb-6 border-b border-slate-200">
                  <Download className="h-5 w-5 text-primary mt-1" />
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-slate-800 mb-2">
                      최신 버전 다운로드
                    </h2>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">버전</span>
                        <Badge variant="outline" className="font-semibold text-slate-700">
                          {release.tag_name}
                        </Badge>
                      </div>
                      <div className="text-slate-600 text-sm">
                        배포일: <span className="font-semibold text-slate-800">{formatDate(release.published_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {release.body && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-6">
                    <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
                      <span className="text-primary">📋</span>
                      릴리즈 노트
                    </h3>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                      {release.body}
                    </div>
                  </div>
                )}

                {/* Android APK 다운로드 */}
                {apkAsset && (
                  <div className="rounded-lg border border-slate-200 bg-white p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50">
                        <span className="text-2xl">🤖</span>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-slate-800">Android</h3>
                        <p className="text-sm text-slate-500">APK 파일 · {formatFileSize(apkAsset.size)}</p>
                      </div>
                    </div>
                    <Button
                      size="lg"
                      className="w-full rounded-lg bg-emerald-600 py-4 text-base font-semibold text-white hover:bg-emerald-700"
                      onClick={() => window.open(apkAsset.browser_download_url, "_blank")}
                    >
                      <Download className="mr-2 h-5 w-5" />
                      Android APK 다운로드
                    </Button>
                    <div className="mt-4 rounded-lg border-l-4 border-emerald-600 bg-emerald-50 p-4">
                      <p className="mb-2 text-sm font-semibold text-emerald-900">📱 Android 설치 안내</p>
                      <p className="text-sm leading-relaxed text-emerald-800">
                        APK 파일을 설치하려면 "출처를 알 수 없는 앱 설치" 권한이 필요합니다.
                        설정 → 보안 → 알 수 없는 출처 허용에서 활성화해주세요.
                      </p>
                    </div>
                  </div>
                )}

                {/* iOS IPA 다운로드 */}
                {ipaAsset && (
                  <div className="rounded-lg border border-slate-200 bg-white p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-rose-50">
                        <span className="text-2xl">🍎</span>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-slate-800">iOS</h3>
                        <p className="text-sm text-slate-500">IPA 파일 · {formatFileSize(ipaAsset.size)}</p>
                      </div>
                    </div>
                    <Button
                      size="lg"
                      className="w-full rounded-lg bg-rose-600 py-4 text-base font-semibold text-white hover:bg-rose-700"
                      onClick={() => window.open(ipaAsset.browser_download_url, "_blank")}
                    >
                      <Download className="mr-2 h-5 w-5" />
                      iOS IPA 다운로드
                    </Button>
                    <div className="mt-4 rounded-lg border-l-4 border-rose-500 bg-rose-50 p-4">
                      <p className="mb-2 text-sm font-semibold text-rose-900">⚠️ iOS 설치 안내</p>
                      <ul className="space-y-1 text-sm leading-relaxed text-rose-800">
                        <li>• TestFlight 또는 개발자 프로비저닝 프로파일 필요</li>
                        <li>• 또는 AltStore, Sideloadly 등 사이드로딩 도구 사용</li>
                        <li>• 일반 사용자는 App Store 출시를 권장합니다</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!loading && !error && (!release || (!apkAsset && !ipaAsset)) && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
                <p className="font-semibold text-slate-600">
                  현재 다운로드 가능한 앱 파일이 없습니다.
                </p>
                <p className="text-sm text-slate-500">
                  새로운 버전이 곧 출시될 예정입니다.
                </p>
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-left text-sm">
                  <p className="mb-2 font-semibold text-slate-800">📱 앱 준비 중</p>
                  <p className="text-slate-600">
                    Flutter 앱이 GitHub Actions를 통해 빌드되는 중이거나,<br />
                    첫 번째 릴리즈가 아직 생성되지 않았습니다.
                  </p>
                  <p className="mt-2 text-slate-600">
                    릴리즈가 생성되면 이 페이지에서 자동으로 최신 APK를 다운로드할 수 있습니다.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => window.open("https://github.com/nogeonu/flutter-mobile/releases", "_blank")}
                  className="w-full"
                >
                  GitHub 릴리즈 페이지 확인하기 →
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 하단 정보 */}
        <div className="border-t border-slate-200 pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <span className="text-lg">ℹ️</span>
            </div>
            <div className="flex-1 text-sm leading-relaxed text-slate-600">
              <p className="mb-2 font-semibold text-slate-800">
                건양대학교 병원 · 환자 포털 서비스
              </p>
              <p>
                앱 사용 중 문제가 발생하면 병원 고객센터(1234-5678)로 문의해주세요.
              </p>
              <p className="mt-2">
                GitHub Repository:{" "}
                <a
                  href="https://github.com/nogeonu/flutter-mobile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  nogeonu/flutter-mobile
                </a>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

