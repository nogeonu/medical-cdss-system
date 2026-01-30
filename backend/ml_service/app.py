from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import os
import sys
import pandas as pd
import numpy as np
import base64
from io import BytesIO
from PIL import Image
import pydicom
import cv2

app = Flask(__name__)
CORS(app)

# pCR 예측 모델 로드
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
try:
    from lis.pcr_predictor import PCRPredictor
    print(f"🔍 pCR 예측 모델 로드 시도 중...")
    print(f"현재 작업 디렉토리: {os.getcwd()}")
    print(f"ml_service 경로: {os.path.dirname(__file__)}")
    pcr_predictor = PCRPredictor()
    pcr_model_loaded = True
    print(f"✅ pCR 예측 모델 로드 완료")
except Exception as e:
    pcr_predictor = None
    pcr_model_loaded = False
    print(f"❌ pCR 예측 모델 로드 실패: {e}")
    import traceback
    traceback.print_exc()

# 폐암 ML 모델 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
model_path = os.path.join(current_dir, '..', 'lung_cancer', 'ml_model', 'lung_cancer_model.pkl')
feature_path = os.path.join(current_dir, '..', 'lung_cancer', 'ml_model', 'feature_names.pkl')

# 모델 파일이 존재하는지 확인
if os.path.exists(model_path) and os.path.exists(feature_path):
    model = joblib.load(model_path)
    feature_names = joblib.load(feature_path)
    model_loaded = True
    print(f"✅ ML 모델 로드 완료: {model_path}")
    print(f"✅ Feature names 로드 완료: {len(feature_names)}개")
else:
    model = None
    feature_names = None
    model_loaded = False
    print(f"❌ ML 모델 로드 실패: {model_path}, {feature_path}")

@app.route('/health', methods=['GET'])
def health():
    """헬스 체크 엔드포인트"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': model_loaded,
        'pcr_model_loaded': pcr_model_loaded
    })

@app.route('/predict', methods=['POST'])
def predict():
    """폐암 예측 API"""
    if not model_loaded:
        return jsonify({
            'error': 'ML 모델이 로드되지 않았습니다. 모델 파일을 확인해주세요.'
        }), 500
    
    try:
        data = request.get_json()
        
        # 증상 데이터를 딕셔너리로 변환
        # 모델은 1=아니오, 2=예를 사용하므로 True를 2로, False를 1로 변환
        symptoms_dict = {
            'GENDER': 1 if data.get('gender') in ['M', '남성', '1'] else 0,
            'AGE': data.get('age', 0),
            'SMOKING': 2 if data.get('smoking') else 1,
            'YELLOW_FINGERS': 2 if data.get('yellow_fingers') else 1,
            'ANXIETY': 2 if data.get('anxiety') else 1,
            'PEER_PRESSURE': 2 if data.get('peer_pressure') else 1,
            'CHRONIC DISEASE': 2 if data.get('chronic_disease') else 1,
            'FATIGUE ': 2 if data.get('fatigue') else 1,
            'ALLERGY ': 2 if data.get('allergy') else 1,
            'WHEEZING': 2 if data.get('wheezing') else 1,
            'ALCOHOL CONSUMING': 2 if data.get('alcohol_consuming') else 1,
            'COUGHING': 2 if data.get('coughing') else 1,
            'SHORTNESS OF BREATH': 2 if data.get('shortness_of_breath') else 1,
            'SWALLOWING DIFFICULTY': 2 if data.get('swallowing_difficulty') else 1,
            'CHEST PAIN': 2 if data.get('chest_pain') else 1,
        }
        
        # DataFrame 생성 및 특성 순서 맞추기
        features = pd.DataFrame([symptoms_dict])
        features = features[feature_names]  # 특성 순서 맞추기
        
        # 예측 수행
        prediction_proba = model.predict_proba(features)[0]
        prediction = model.predict(features)[0]
        
        # 위험도 계산
        probability_percent = float(prediction_proba[1]) * 100
        if probability_percent >= 70:
            risk_level = '높음'
            risk_message = '폐암 위험도가 높습니다. 즉시 전문의 상담을 권장합니다.'
        elif probability_percent >= 40:
            risk_level = '중간'
            risk_message = '폐암 위험도가 중간입니다. 정기적인 검진을 권장합니다.'
        else:
            risk_level = '낮음'
            risk_message = '폐암 위험도가 낮습니다. 건강한 생활 습관을 유지하세요.'
        
        return jsonify({
            'prediction': 'YES' if prediction == 1 else 'NO',
            'probability': round(probability_percent, 2),
            'risk_level': risk_level,
            'risk_message': risk_message,
            'symptoms': symptoms_dict
        }), 200
        
    except Exception as e:
        print(f"❌ 예측 중 오류: {e}")
        return jsonify({
            'error': f'예측 중 오류가 발생했습니다: {str(e)}'
        }), 500

@app.route('/predict_pcr', methods=['POST'])
def predict_pcr():
    """pCR 예측 API"""
    if not pcr_model_loaded:
        return jsonify({
            'error': 'pCR 예측 모델이 로드되지 않았습니다. 모델 파일을 확인해주세요.'
        }), 503
    
    try:
        data = request.get_json()
        
        # 유전자 발현값 추출
        gene_values = data.get('gene_values', {})
        patient_info = data.get('patient_info', {})
        
        # 필수 유전자 확인
        required_genes = ['CXCL13', 'CD8A', 'CCR7', 'C1QA', 'LY9', 'CXCL10', 'CXCL9', 'STAT1',
                         'CCND1', 'MKI67', 'TOP2A', 'BRCA1', 'RAD51', 'PRKDC', 'POLD3', 'POLB', 'LIG1',
                         'ERBB2', 'ESR1', 'PGR', 'ARAF', 'PIK3CA', 'AKT1', 'MTOR', 'TP53', 'PTEN', 'MYC']
        
        missing_genes = [g for g in required_genes if g not in gene_values]
        if missing_genes:
            return jsonify({
                'error': f'필수 유전자 발현값이 없습니다: {missing_genes}'
            }), 400
        
        # pCR 예측 수행
        result = pcr_predictor.generate_report_image(gene_values, patient_info)
        
        return jsonify({
            'success': True,
            'probability': result['probability'],
            'prediction': result['prediction'],
            'image': result['image'],
            'top_genes': result['top_genes'],
            'pathway_scores': result['pathway_scores']
        }), 200
        
    except Exception as e:
        print(f"❌ pCR 예측 중 오류: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': f'pCR 예측 중 오류가 발생했습니다: {str(e)}'
        }), 500

if __name__ == '__main__':
    # 개발 환경: 5002 포트 사용
    app.run(host='0.0.0.0', port=5002, debug=True)

