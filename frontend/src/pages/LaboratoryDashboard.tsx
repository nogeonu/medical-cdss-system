import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  FlaskConical, 
  Search,
  FileText,
  Activity,
  Dna,
  ArrowRight
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import {
  getLabTestsApi,
  getRNATestsApi,
} from '@/lib/api';

interface LabTest {
  id: number;
  accession_number: string;
  patient_name: string;
  patient_id: string;
  patient_age: number;
  patient_gender: string;
  test_date: string;
  result_date: string;
}

interface RNATest {
  id: number;
  accession_number: string;
  patient_name: string;
  patient_id: string;
  patient_age: number;
  patient_gender: string;
  test_date: string;
  result_date: string;
}

export default function LaboratoryDashboard() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [labTests, setLabTests] = useState<LabTest[]>([]);
  const [rnaTests, setRNATests] = useState<RNATest[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast({
        title: '검색어를 입력해주세요',
        description: '환자 이름 또는 검사번호를 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const [labData, rnaData] = await Promise.all([
        getLabTestsApi({ search: searchTerm }),
        getRNATestsApi({ search: searchTerm }),
      ]);
      setLabTests(labData.results || labData);
      setRNATests(rnaData.results || rnaData);
      
      const totalResults = (labData.results?.length || labData.length || 0) + 
                          (rnaData.results?.length || rnaData.length || 0);
      
      if (totalResults === 0) {
        toast({
          title: '검색 결과 없음',
          description: '검색 조건에 맞는 검사 결과가 없습니다.',
        });
      } else {
        toast({
          title: '검색 완료',
          description: `${totalResults}개의 결과를 찾았습니다.`,
        });
      }
    } catch (error: any) {
      toast({
        title: '검색 실패',
        description: error?.response?.data?.error || '검색 중 오류가 발생했습니다.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setSearchTerm('');
    setLabTests([]);
    setRNATests([]);
    setHasSearched(false);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">검사실 정보 시스템</h1>
          <p className="text-muted-foreground mt-1">
            Laboratory Information System (LIS) - 환자 검사 결과 조회
          </p>
        </div>
        <Button 
          onClick={() => navigate('/laboratory-ai-analysis')}
          className="bg-primary hover:bg-primary/90"
        >
          <Dna className="mr-2 h-4 w-4" />
          AI 분석
        </Button>
      </div>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            검사 결과 검색
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="환자 이름 또는 검사번호로 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-10"
              />
            </div>
            <Button 
              onClick={handleSearch} 
              disabled={loading || !searchTerm.trim()}
              className="bg-primary hover:bg-primary/90"
            >
              {loading ? '검색 중...' : '검색'}
            </Button>
            {hasSearched && (
              <Button 
                onClick={handleClear} 
                variant="outline"
              >
                초기화
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      {hasSearched && (
        <div className="space-y-6">
          {/* Lab Tests Results */}
          {labTests.length > 0 && (
            <Card>
              <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-blue-600" />
                  혈액검사 결과 ({labTests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {labTests.map((test) => (
                    <div
                      key={test.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <p className="font-semibold text-lg">{test.patient_name}</p>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                            {test.patient_id}
                          </Badge>
                          <Badge variant="outline" className="bg-gray-50">
                            {test.patient_gender}, {test.patient_age}세
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>검사번호: <span className="font-medium text-gray-900">{test.accession_number}</span></span>
                          <span>접수일: {test.test_date}</span>
                          {test.result_date && <span>결과일: {test.result_date}</span>}
                        </div>
                      </div>
                      <Badge className="bg-green-100 text-green-800">
                        <FileText className="mr-1 h-3 w-3" />
                        결과 있음
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* RNA Tests Results */}
          {rnaTests.length > 0 && (
            <Card>
              <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
                <CardTitle className="flex items-center gap-2">
                  <Dna className="h-5 w-5 text-purple-600" />
                  RNA 검사 결과 ({rnaTests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {rnaTests.map((test) => (
                    <div
                      key={test.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <p className="font-semibold text-lg">{test.patient_name}</p>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                            {test.patient_id}
                          </Badge>
                          <Badge variant="outline" className="bg-gray-50">
                            {test.patient_gender}, {test.patient_age}세
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span>검사번호: <span className="font-medium text-gray-900">{test.accession_number}</span></span>
                          <span>접수일: {test.test_date}</span>
                          {test.result_date && <span>결과일: {test.result_date}</span>}
                        </div>
                      </div>
                      <Badge className="bg-purple-100 text-purple-800">
                        <Dna className="mr-1 h-3 w-3" />
                        결과 있음
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* No Results */}
          {labTests.length === 0 && rnaTests.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Search className="mx-auto h-12 w-12 mb-4 text-gray-400" />
                <p className="text-lg font-semibold mb-2">검색 결과가 없습니다</p>
                <p className="text-sm">다른 검색어로 시도해보세요</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty State */}
      {!hasSearched && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FlaskConical className="mx-auto h-16 w-16 mb-4 text-gray-400" />
            <p className="text-lg font-semibold mb-2">검사 결과 검색</p>
            <p className="text-sm mb-4">환자 이름 또는 검사번호를 입력하여 검사 결과를 조회하세요</p>
            <Button 
              onClick={() => navigate('/laboratory-ai-analysis')}
              variant="outline"
              className="mt-4"
            >
              AI 분석 페이지로 이동
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
