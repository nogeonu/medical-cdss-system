# 약물 상호작용 API 연동 가이드

## 현재 구현 상태

현재는 **하드코딩된 약물 상호작용 데이터**를 사용하고 있습니다:

```python
# services.py
DRUG_INTERACTIONS = {
    'warfarin': {
        'aspirin': {'severity': 'severe', 'description': '출혈 위험 증가'},
        'ibuprofen': {'severity': 'moderate', 'description': '출혈 위험 증가'},
    },
    # ... 제한적인 데이터만 있음
}
```

**문제점:**
- 약물 데이터가 매우 제한적 (3-4개 조합만)
- 실제 약물명과 매칭 어려움
- 업데이트가 어려움
- 실제 의료 환경에서는 사용 불가

---

## 개선 방안

### 방안 1: 외부 약물 상호작용 API 사용 (권장)

#### 1.1 DrugBank API
- **URL**: https://go.drugbank.com/
- **특징**: 
  - 무료 버전 제공 (제한적)
  - 유료 버전: 상세한 약물 상호작용 데이터
  - REST API 제공

#### 1.2 RxNorm API (미국)
- **URL**: https://www.nlm.nih.gov/research/umls/rxnorm/
- **특징**:
  - 무료
  - 약물 표준화 이름 제공
  - 상호작용 데이터는 제한적

#### 1.3 FDA Drug Interactions API
- **URL**: https://www.fda.gov/drugs/drug-interactions-labeling
- **특징**:
  - 공식 FDA 데이터
  - 무료
  - API는 직접 제공하지 않음 (데이터 다운로드)

#### 1.4 한국 식약처 의약품안전나라
- **URL**: https://nedrug.mfds.go.kr/
- **특징**:
  - 한국 약물 정보
  - 공식 API 제공 여부 확인 필요
  - 한국어 약물명 지원

---

### 방안 2: 데이터베이스에 약물 상호작용 정보 저장

#### 2.1 모델 생성
```python
# ocs/models.py에 추가
class Drug(models.Model):
    """약물 정보"""
    name = models.CharField(max_length=200, unique=True)
    name_korean = models.CharField(max_length=200, blank=True)  # 한글명
    drug_code = models.CharField(max_length=50, blank=True)  # 약물 코드
    created_at = models.DateTimeField(auto_now_add=True)

class DrugInteraction(models.Model):
    """약물 상호작용"""
    drug1 = models.ForeignKey(Drug, on_delete=models.CASCADE, related_name='interactions_as_drug1')
    drug2 = models.ForeignKey(Drug, on_delete=models.CASCADE, related_name='interactions_as_drug2')
    severity = models.CharField(max_length=20, choices=[
        ('mild', '경미'),
        ('moderate', '중등도'),
        ('severe', '심각'),
    ])
    description = models.TextField()
    source = models.CharField(max_length=100, blank=True)  # 출처
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = [['drug1', 'drug2']]
```

#### 2.2 데이터 입력
- CSV 파일로 대량 import
- 관리자 페이지에서 수동 입력
- 외부 API에서 주기적으로 동기화

---

### 방안 3: 하이브리드 방식 (권장)

1. **기본 데이터**: DB에 저장 (자주 사용되는 약물)
2. **외부 API**: DB에 없는 약물은 API 호출
3. **캐싱**: API 결과를 DB에 저장하여 재사용

---

## 구현 예시: DrugBank API 연동

### 1. DrugBank API 클라이언트 생성

```python
# ocs/drug_api.py
import requests
import os
from typing import List, Dict, Optional
from django.conf import settings

class DrugBankAPI:
    """DrugBank API 클라이언트"""
    
    BASE_URL = "https://api.drugbank.com/v1"
    
    def __init__(self):
        self.api_key = os.getenv('DRUGBANK_API_KEY', '')
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
    
    def search_drug(self, drug_name: str) -> Optional[Dict]:
        """약물 검색"""
        try:
            response = requests.get(
                f"{self.BASE_URL}/drugs",
                params={'q': drug_name},
                headers=self.headers,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                if data.get('drugs'):
                    return data['drugs'][0]  # 첫 번째 결과
            return None
        except Exception as e:
            logger.error(f"DrugBank API error: {e}")
            return None
    
    def get_drug_interactions(self, drug_id: str) -> List[Dict]:
        """약물 상호작용 조회"""
        try:
            response = requests.get(
                f"{self.BASE_URL}/drugs/{drug_id}/interactions",
                headers=self.headers,
                timeout=10
            )
            if response.status_code == 200:
                return response.json().get('interactions', [])
            return []
        except Exception as e:
            logger.error(f"DrugBank API error: {e}")
            return []
    
    def check_interaction(self, drug1_name: str, drug2_name: str) -> Optional[Dict]:
        """두 약물 간 상호작용 체크"""
        drug1 = self.search_drug(drug1_name)
        drug2 = self.search_drug(drug2_name)
        
        if not drug1 or not drug2:
            return None
        
        interactions = self.get_drug_interactions(drug1['id'])
        
        for interaction in interactions:
            if interaction.get('drug_id') == drug2['id']:
                return {
                    'drug1': drug1_name,
                    'drug2': drug2_name,
                    'severity': interaction.get('severity', 'moderate'),
                    'description': interaction.get('description', '')
                }
        
        return None
```

### 2. 서비스 로직 수정

```python
# ocs/services.py 수정
from .drug_api import DrugBankAPI
from .models import Drug, DrugInteraction

def check_drug_interactions(order):
    """약물 상호작용 체크 (DB + API)"""
    if order.order_type != 'prescription':
        return None
    
    medications = order.order_data.get('medications', [])
    if not medications:
        return None
    
    drug_names = [med.get('name', '').lower() for med in medications if med.get('name')]
    
    interactions = []
    checked_drugs = []
    
    # 1. DB에서 먼저 확인
    for i, drug1_name in enumerate(drug_names):
        checked_drugs.append(drug1_name)
        for drug2_name in drug_names[i+1:]:
            # DB에서 상호작용 확인
            interaction = DrugInteraction.objects.filter(
                drug1__name__iexact=drug1_name,
                drug2__name__iexact=drug2_name
            ).first()
            
            if not interaction:
                # 역방향도 확인
                interaction = DrugInteraction.objects.filter(
                    drug1__name__iexact=drug2_name,
                    drug2__name__iexact=drug1_name
                ).first()
            
            if interaction:
                interactions.append({
                    'drug1': drug1_name,
                    'drug2': drug2_name,
                    'severity': interaction.severity,
                    'description': interaction.description
                })
            else:
                # 2. DB에 없으면 API 호출 (선택적)
                # api = DrugBankAPI()
                # api_result = api.check_interaction(drug1_name, drug2_name)
                # if api_result:
                #     interactions.append(api_result)
                pass
    
    if interactions:
        severities = [inter['severity'] for inter in interactions]
        severity = 'severe' if 'severe' in severities else ('moderate' if 'moderate' in severities else 'mild')
        
        return DrugInteractionCheck.objects.create(
            order=order,
            checked_drugs=checked_drugs,
            interactions=interactions,
            severity=severity
        )
    
    return None
```

---

## 한국 약물 데이터 연동

### 식약처 의약품안전나라

```python
# ocs/korea_drug_api.py
import requests
from typing import List, Dict

class KoreaDrugAPI:
    """식약처 의약품안전나라 API"""
    
    BASE_URL = "https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail"
    
    def search_drug(self, drug_name: str) -> List[Dict]:
        """약물 검색"""
        try:
            response = requests.get(
                self.BASE_URL,
                params={'itemSeq': drug_name},  # 실제 파라미터 확인 필요
                timeout=10
            )
            if response.status_code == 200:
                return response.json()
            return []
        except Exception as e:
            logger.error(f"Korea Drug API error: {e}")
            return []
```

---

## 권장 구현 단계

### 1단계: DB 모델 생성 (즉시)
- `Drug`, `DrugInteraction` 모델 생성
- 기본 약물 데이터 입력 (자주 사용되는 약물)

### 2단계: 관리자 페이지에서 데이터 입력
- Django Admin에서 약물 및 상호작용 정보 입력
- CSV import 기능 추가

### 3단계: 외부 API 연동 (선택)
- DrugBank 또는 한국 약물 API 연동
- API 결과를 DB에 캐싱

---

## 환경 변수 설정

```bash
# .env 파일에 추가
DRUGBANK_API_KEY=your_api_key_here
KOREA_DRUG_API_KEY=your_api_key_here
```

---

## 참고 자료

1. **DrugBank**: https://go.drugbank.com/
2. **RxNorm**: https://www.nlm.nih.gov/research/umls/rxnorm/
3. **식약처 의약품안전나라**: https://nedrug.mfds.go.kr/
4. **FDA Drug Interactions**: https://www.fda.gov/drugs/drug-interactions-labeling
