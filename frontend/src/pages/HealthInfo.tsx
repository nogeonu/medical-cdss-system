import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Calendar, ArrowRight, Home } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function HealthInfo() {
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const healthContents = [
    {
      title: "환절기 호흡기 건강 관리",
      category: "계절 건강",
      date: "2025.10.15",
      image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=800&auto=format&fit=crop",
      desc: "일교차가 큰 환절기, 면역력을 높이고 호흡기 질환을 예방하는 생활 수칙을 알아봅니다. 실내 습도 유지와 충분한 수분 섭취가 중요합니다.",
      details: (
        <div className="space-y-4">
          <div className="bg-emerald-50 p-4 rounded-xl">
            <h4 className="font-bold text-emerald-800 mb-2">💡 핵심 포인트</h4>
            <ul className="list-disc list-inside text-sm text-emerald-700 space-y-1">
              <li>실내 습도 40~60% 유지하기</li>
              <li>하루 1.5L 이상 미지근한 물 마시기</li>
              <li>외출 후 손 씻기 및 가글하기</li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">1. 습도 조절이 관건</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              건조한 공기는 호흡기 점막을 마르게 하여 바이러스 침투를 용이하게 합니다. 가습기를 활용하거나 젖은 수건을 널어 실내 습도를 50% 수준으로 유지해주세요.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">2. 호흡기에 좋은 차(Tea)</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>도라지차:</strong> 사포닌 성분이 가래를 삭이고 기침을 멎게 합니다.<br/>
              <strong>배즙:</strong> 루테올린 성분이 기관지 염증을 완화합니다.<br/>
              <strong>생강차:</strong> 몸을 따뜻하게 하고 혈액순환을 돕습니다.
            </p>
          </div>
        </div>
      )
    },
    {
      title: "직장인을 위한 스트레칭",
      category: "운동 가이드",
      date: "2025.10.10",
      image: "https://images.unsplash.com/photo-1599901860904-17e6ed7083a0?q=80&w=800&auto=format&fit=crop",
      desc: "하루 종일 앉아있는 당신을 위해, 사무실에서 5분 만에 할 수 있는 거북목 예방 스트레칭. 목과 어깨의 긴장을 풀어주는 간단한 동작들을 소개합니다.",
      details: (
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-xl">
            <h4 className="font-bold text-blue-800 mb-2">🕒 5분 루틴</h4>
            <ul className="list-disc list-inside text-sm text-blue-700 space-y-1">
              <li>목 돌리기 (좌우 10회)</li>
              <li>어깨 으쓱하기 (20회)</li>
              <li>손목 털기 (30초)</li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">1. 거북목 교정 스트레칭</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              의자에 바르게 앉아 턱을 가슴 쪽으로 당깁니다. 양손으로 뒤통수를 감싸고 지그시 눌러 뒷목을 늘려줍니다. 15초간 유지하며 3회 반복합니다.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">2. 굽은 등 펴기</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              양손을 등 뒤로 깍지 끼고 가슴을 활짝 폅니다. 날개뼈가 서로 닿는다는 느낌으로 조여주며 고개를 살짝 젖힙니다. 시선은 천장을 향하게 하세요.
            </p>
          </div>
        </div>
      )
    },
    {
      title: "슈퍼푸드 식단 가이드",
      category: "영양 정보",
      date: "2025.10.05",
      image: "https://images.unsplash.com/photo-1490645935967-10de6ba17061?q=80&w=800&auto=format&fit=crop",
      desc: "항산화 성분이 풍부한 슈퍼푸드를 활용하여 매일 건강한 식단을 구성하는 방법을 소개합니다. 블루베리, 시금치, 아몬드 등 주변에서 쉽게 구할 수 있는 재료들입니다.",
      details: (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-orange-50 p-3 rounded-lg text-center">
              <span className="text-2xl">🫐</span>
              <p className="text-xs font-bold text-orange-800 mt-1">블루베리</p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <span className="text-2xl">🥬</span>
              <p className="text-xs font-bold text-green-800 mt-1">시금치</p>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg text-center">
              <span className="text-2xl">🥜</span>
              <p className="text-xs font-bold text-yellow-800 mt-1">아몬드</p>
            </div>
            <div className="bg-red-50 p-3 rounded-lg text-center">
              <span className="text-2xl">🍅</span>
              <p className="text-xs font-bold text-red-800 mt-1">토마토</p>
            </div>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">아침 추천 메뉴</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              그릭 요거트에 블루베리와 아몬드를 곁들여 드세요. 단백질과 항산화 성분을 동시에 섭취하여 하루를 활기차게 시작할 수 있습니다.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">저녁 추천 메뉴</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              토마토와 시금치를 넣은 오믈렛이나 샐러드를 추천합니다. 소화가 잘 되고 비타민이 풍부하여 수면 중 회복을 돕습니다.
            </p>
          </div>
        </div>
      )
    },
    {
      title: "올바른 수면 습관",
      category: "생활 습관",
      date: "2025.09.28",
      image: "https://images.pexels.com/photos/3775120/pexels-photo-3775120.jpeg?auto=compress&cs=tinysrgb&w=800",
      desc: "하루 7시간 이상의 질 좋은 수면은 면역력 강화와 피부 건강에 필수적입니다. 수면의 질을 높이는 침실 환경 조성법과 잠들기 전 루틴을 알아봅니다.",
      details: (
        <div className="space-y-4">
          <div className="bg-indigo-50 p-4 rounded-xl">
            <h4 className="font-bold text-indigo-800 mb-2">🌙 4-7-8 호흡법</h4>
            <ol className="list-decimal list-inside text-sm text-indigo-700 space-y-1">
              <li>4초간 코로 숨을 들이마십니다.</li>
              <li>7초간 숨을 참습니다.</li>
              <li>8초간 입으로 숨을 천천히 내뱉습니다.</li>
            </ol>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">수면 환경 조성</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              침실 온도는 20~22도로 서늘하게 유지하고, 암막 커튼으로 빛을 완전히 차단하세요. 자기 전 1시간은 스마트폰 사용을 자제하여 블루라이트 노출을 줄여야 합니다.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">피부 재생 골든타임</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              밤 10시부터 새벽 2시 사이는 피부 세포 재생이 가장 활발한 시간입니다. 가능한 이 시간에 깊은 잠에 들 수 있도록 수면 패턴을 맞춰보세요.
            </p>
          </div>
        </div>
      )
    },
    {
      title: "마음 챙김 명상 가이드",
      category: "정신 건강",
      date: "2025.09.15",
      image: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?q=80&w=800&auto=format&fit=crop",
      desc: "스트레스로 지친 마음을 위로하는 명상 시간. 하루 10분, 나에게 집중하는 시간을 통해 마음의 평화를 찾아보세요.",
      details: (
        <div className="space-y-4">
          <div className="bg-purple-50 p-4 rounded-xl">
            <h4 className="font-bold text-purple-800 mb-2">🧘‍♀️ 5분 명상 루틴</h4>
            <ul className="list-disc list-inside text-sm text-purple-700 space-y-1">
              <li>편안한 자세로 앉아 눈을 감습니다.</li>
              <li>호흡이 들어오고 나가는 느낌에 집중합니다.</li>
              <li>잡생각이 들면 다시 호흡으로 돌아옵니다.</li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">명상의 효과</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              규칙적인 명상은 스트레스 호르몬인 코르티솔 수치를 낮추고, 집중력과 감정 조절 능력을 향상시킵니다. 불안감이 들 때 3분만 눈을 감고 호흡해보세요.
            </p>
          </div>
          <div>
            <h4 className="font-bold text-slate-800 mb-2">일상 속 명상</h4>
            <p className="text-sm text-slate-600 leading-relaxed">
              거창한 준비는 필요 없습니다. 출근길 버스 안에서, 점심 식사 후 벤치에서, 잠들기 전 침대 위에서 잠시 멈춤 버튼을 눌러보세요.
            </p>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container flex items-center justify-between py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg text-slate-900">CDSS Health</span>
          </Link>
          <Link to="/">
            <Button variant="ghost" size="sm" className="gap-2">
              <Home className="w-4 h-4" />
              홈으로 돌아가기
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12">
        <div className="container">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-bold mb-4">
              <Activity className="w-4 h-4" />
              <span>Health & Wellness</span>
            </div>
            <h1 className="text-4xl font-bold mb-4 text-slate-900">건강 정보</h1>
            <p className="text-lg text-slate-600">
              건강한 삶을 위한 유용한 정보와 전문가의 조언을 확인하세요.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {healthContents.map((item, idx) => (
              <Card 
                key={idx} 
                className="border-none shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group cursor-pointer h-full flex flex-col bg-white"
                onClick={() => setSelectedItem(item)}
              >
                <div className="relative h-56 overflow-hidden">
                  <img 
                    src={item.image} 
                    alt={item.title} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute top-4 left-4">
                    <Badge className="bg-white/90 text-slate-800 hover:bg-white backdrop-blur-sm border-none shadow-sm font-bold">
                      {item.category}
                    </Badge>
                  </div>
                </div>
                <CardContent className="p-6 flex-1 flex flex-col">
                  <div className="text-xs text-slate-500 mb-3 flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    {item.date}
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-slate-900 group-hover:text-primary transition-colors line-clamp-2">
                    {item.title}
                  </h3>
                  <p className="text-slate-600 text-sm line-clamp-3 mb-6 flex-1 leading-relaxed">
                    {item.desc}
                  </p>
                  <div className="flex items-center text-sm font-bold text-primary mt-auto">
                    자세히 보기 <ArrowRight className="ml-1 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t py-8">
        <div className="container text-center text-sm text-slate-500">
          <p>© 2025 CDSS Medical Center. All rights reserved.</p>
        </div>
      </footer>

      {/* Details Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="mb-4 overflow-hidden rounded-xl">
                  <img 
                    src={selectedItem.image} 
                    alt={selectedItem.title} 
                    className="w-full h-48 object-cover"
                  />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="text-primary border-primary/20 bg-primary/5">
                    {selectedItem.category}
                  </Badge>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {selectedItem.date}
                  </span>
                </div>
                <DialogTitle className="text-2xl font-bold text-slate-900 mb-2">
                  {selectedItem.title}
                </DialogTitle>
                <DialogDescription className="text-base text-slate-600">
                  {selectedItem.desc}
                </DialogDescription>
              </DialogHeader>
              
              <div className="mt-4 border-t pt-6">
                {selectedItem.details}
              </div>

              <div className="mt-6 flex justify-end">
                <Button onClick={() => setSelectedItem(null)}>닫기</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}