import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { registerApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, User, Mail, Lock, Stethoscope } from "lucide-react";
import doctorBg from "@/assets/doctor-bg.jpg";

export default function Signup() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password || !department) {
      setError("아이디/비밀번호/진료과(또는 부서)를 모두 입력해주세요.");
      return;
    }
    try {
      setLoading(true);
      console.log("[회원가입] 전송 데이터:", {
        username,
        email,
        department,
        first_name: firstName,
        last_name: lastName,
      });
      const result = await registerApi({
        username,
        password,
        email,
        department,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
      });
      console.log("[회원가입] 성공:", result);
      alert("회원가입이 완료되었습니다!");
      navigate("/login", { replace: true });
    } catch (err: any) {
      console.error("[회원가입] 실패:", err);
      const msg = err?.response?.data?.detail || "회원가입에 실패했습니다.";
      console.error("[회원가입] 에러 메시지:", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-black">
      {/* Left Panel - Signup Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <Activity className="text-blue-500 text-3xl mb-4" />
            <h1 className="text-4xl font-bold text-white mb-2">Sign Up</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label
                htmlFor="username"
                className="text-white text-sm mb-2 block"
              >
                User Name
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="pl-10 bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label
                  htmlFor="lastName"
                  className="text-white text-sm mb-2 block"
                >
                  성 (Last Name)
                </Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="성"
                  className="bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                />
              </div>
              <div>
                <Label
                  htmlFor="firstName"
                  className="text-white text-sm mb-2 block"
                >
                  이름 (First Name)
                </Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="이름"
                  className="bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email" className="text-white text-sm mb-2 block">
                Email (Optional)
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="pl-10 bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <Label
                htmlFor="password"
                className="text-white text-sm mb-2 block"
              >
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter Password"
                  className="pl-10 bg-gray-900 border-gray-700 text-white placeholder-gray-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <Label
                htmlFor="department"
                className="text-white text-sm mb-2 block"
              >
                부서 / 진료과
              </Label>
              <div className="relative">
                <Stethoscope className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 z-10" />
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="pl-10 bg-gray-900 border-gray-700 text-white focus:border-blue-500">
                    <SelectValue placeholder="원무과 또는 진료과를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="원무과">원무과 (Admin Staff)</SelectItem>
                    <SelectItem value="호흡기내과">
                      호흡기내과 (Medical Staff)
                    </SelectItem>
                    <SelectItem value="외과">
                      외과 (Medical Staff)
                    </SelectItem>
                    <SelectItem value="방사선과">
                      방사선과 (Medical Staff)
                    </SelectItem>
                    <SelectItem value="영상의학과">
                      영상의학과 (Medical Staff)
                    </SelectItem>
                    <SelectItem value="약국">
                      약국 (Medical Staff)
                    </SelectItem>
                    <SelectItem value="검사실">
                      검사실 (Medical Staff)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 px-4 py-2 rounded">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg uppercase tracking-wide disabled:opacity-50"
              disabled={loading}
            >
              {loading ? "Signing Up..." : "SIGN UP"}
            </Button>
          </form>

          <div className="mt-6 text-center text-white text-sm">
            Already have an account?{" "}
            <Link className="text-blue-500 hover:underline" to="/login">
              Sign in
            </Link>
          </div>
        </div>
      </div>

      {/* Right Panel - Visual */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden">
        {/* Background Image with Overlay */}
        <div className="absolute inset-0">
          <img
            src={doctorBg}
            alt="Doctor"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/50"></div>
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 to-black/50"></div>
        </div>
        <div className="relative z-10 p-12 flex flex-col justify-between">
          <div></div>
          <div>
            <h2 className="text-3xl font-light text-white mb-6 drop-shadow-lg">
              스마트한 의료 시스템으로
              <br />더 나은 진료를 시작하세요.
            </h2>
            <Link
              to="#"
              className="text-xs text-gray-300 hover:text-blue-500 uppercase tracking-wide transition"
            >
              LEARN MORE →
            </Link>
          </div>
          <div className="flex justify-end">
            <div className="bg-white/20 backdrop-blur-md p-4 rounded-lg flex gap-4 cursor-pointer hover:bg-white/30 transition border border-white/20">
              <Activity className="w-5 h-5 text-blue-300" />
              <div className="text-white text-sm">
                <div className="font-medium">병원 관리 시스템</div>
                <div className="text-xs text-gray-300">CDSSentials</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
