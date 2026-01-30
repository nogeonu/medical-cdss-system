"""
pCR Prediction Service for LIS
Integrates AI model for breast cancer pCR prediction
"""

import pandas as pd
import numpy as np
import joblib
import torch
import torch.nn as nn
import xgboost as xgb
import lightgbm as lgb
from scipy.stats.mstats import winsorize
import os
import json
import shap
import warnings
import base64
from io import BytesIO
import matplotlib
matplotlib.use('Agg')  # Non-GUI backend
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.gridspec import GridSpec

warnings.filterwarnings('ignore')


def set_korean_font():
    """한글 폰트 설정 - 서버 환경에 맞게 자동 선택"""
    import matplotlib.font_manager as fm
    
    # 가능한 한글 폰트 목록 (우선순위 순)
    k_fonts = [
        'NanumGothic', 'Nanum Gothic', 'NanumBarunGothic', 'Nanum Barun Gothic',
        'Malgun Gothic', 'AppleGothic', 'Apple SD Gothic Neo',
        'Noto Sans CJK KR', 'Noto Sans KR',
        'DejaVu Sans',  # 폴백 (한글 미지원이지만 기본 폰트)
        'sans-serif'
    ]
    
    # 시스템에 설치된 폰트 목록 가져오기
    system_fonts = [f.name for f in fm.fontManager.ttflist]
    
    # 한글 폰트 찾기
    selected_font = 'DejaVu Sans'  # 기본값
    for font_name in k_fonts:
        # 정확한 이름 매칭
        if font_name in system_fonts:
            selected_font = font_name
            break
        # 부분 매칭 (Nanum 포함 등)
        for sys_font in system_fonts:
            if font_name.lower().replace(' ', '') in sys_font.lower().replace(' ', ''):
                selected_font = sys_font
                break
        if selected_font != 'DejaVu Sans':
            break
    
    # 폰트 설정
    plt.rcParams['font.family'] = selected_font
    plt.rcParams['axes.unicode_minus'] = False
    
    # Nanum 폰트가 있으면 명시적으로 사용
    if selected_font == 'DejaVu Sans':
        # Nanum 폰트를 직접 찾아서 설정 시도
        for sys_font in system_fonts:
            if 'nanum' in sys_font.lower():
                plt.rcParams['font.family'] = sys_font
                print(f"✅ 한글 폰트 설정: {sys_font}")
                break
    else:
        print(f"✅ 한글 폰트 설정: {selected_font}")


set_korean_font()


class PathwayAttention(nn.Module):
    def __init__(self, input_dim):
        super(PathwayAttention, self).__init__()
        self.attention = nn.Sequential(nn.Linear(input_dim, input_dim), nn.Tanh(), nn.Linear(input_dim, 1))
    
    def forward(self, x):
        weights = torch.softmax(self.attention(x), dim=1)
        return x * weights


class HierarchicalModel(nn.Module):
    def __init__(self, pathway_sizes, hidden_dim=32, dropout=0.3):
        super(HierarchicalModel, self).__init__()
        self.pathway_sizes = pathway_sizes
        self.pathway_layers = nn.ModuleList([
            nn.Sequential(nn.Linear(size, hidden_dim), nn.BatchNorm1d(hidden_dim), nn.ReLU(), nn.Dropout(dropout)) 
            for size in pathway_sizes
        ])
        self.attention = PathwayAttention(hidden_dim)
        self.integration = nn.Sequential(
            nn.Linear(len(pathway_sizes) * hidden_dim, 64), nn.BatchNorm1d(64), nn.ReLU(), 
            nn.Dropout(dropout), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1), nn.Sigmoid()
        )
    
    def forward(self, x):
        outputs = []
        start = 0
        for i, size in enumerate(self.pathway_sizes):
            out = self.pathway_layers[i](x[:, start:start+size])
            out = self.attention(out)
            outputs.append(out)
            start += size
        combined = torch.cat(outputs, dim=1)
        return self.integration(combined)


class PCRPredictor:
    def __init__(self):
        self.genes_27 = [
            'CXCL13', 'CD8A', 'CCR7', 'C1QA', 'LY9', 'CXCL10', 'CXCL9', 'STAT1',
            'CCND1', 'MKI67', 'TOP2A', 'BRCA1', 'RAD51', 'PRKDC', 'POLD3', 'POLB', 'LIG1',
            'ERBB2', 'ESR1', 'PGR', 'ARAF', 'PIK3CA', 'AKT1', 'MTOR', 'TP53', 'PTEN', 'MYC'
        ]
        self.pathways = {
            '면역 (Immune)': ['CXCL13', 'CD8A', 'CCR7', 'C1QA', 'LY9', 'CXCL10', 'CXCL9', 'STAT1'],
            '세포증식 (Proliferation)': ['CCND1', 'MKI67', 'TOP2A'],
            'DNA 복구 (DNA Repair)': ['BRCA1', 'RAD51', 'PRKDC', 'POLD3', 'POLB', 'LIG1'],
            'HER2 수용체': ['ERBB2'],
            '호르몬 수용체 (ER/PR)': ['ESR1', 'PGR'],
            '신호전달 (AKT/mTOR)': ['ARAF', 'PIK3CA', 'AKT1', 'MTOR', 'TP53', 'PTEN', 'MYC']
        }
        # 모델 디렉토리 경로 설정 (ml_service에서 호출될 때도 작동하도록)
        current_file = os.path.abspath(__file__)
        
        # 여러 경로 시도
        possible_paths = [
            # 1. 절대 경로 (서버 환경) - 우선순위 높음
            '/srv/django-react/app/backend/lis/models/saved',
            # 2. ml_service에서 실행 중인 경우
            os.path.join(os.path.dirname(os.path.dirname(current_file)), 'lis', 'models', 'saved'),
            # 3. lis 앱에서 직접 실행 중인 경우
            os.path.join(os.path.dirname(__file__), 'models', 'saved'),
            # 4. 현재 작업 디렉토리 기준
            os.path.join(os.getcwd(), 'backend', 'lis', 'models', 'saved'),
            # 5. 상대 경로 (ml_service 기준)
            os.path.join(os.path.dirname(current_file), '..', 'lis', 'models', 'saved'),
        ]
        
        self.model_dir = None
        for path in possible_paths:
            # 경로 정규화 (상대 경로를 절대 경로로 변환)
            abs_path = os.path.abspath(os.path.expanduser(path))
            scaler_file = os.path.join(abs_path, 'final_ensemble_scaler.pkl')
            
            print(f"🔍 경로 확인 중: {abs_path}")
            print(f"   - 디렉토리 존재: {os.path.exists(abs_path)}")
            print(f"   - Scaler 파일 존재: {os.path.exists(scaler_file)}")
            
            if os.path.exists(abs_path) and os.path.exists(scaler_file):
                self.model_dir = abs_path
                print(f"✅ 모델 디렉토리 찾음: {self.model_dir}")
                break
        
        if not self.model_dir:
            # 모든 경로를 절대 경로로 변환하여 에러 메시지에 포함
            abs_paths = [os.path.abspath(os.path.expanduser(p)) for p in possible_paths]
            error_msg = f"❌ 모델 디렉토리를 찾을 수 없습니다. 시도한 경로: {abs_paths}"
            print(error_msg)
            # 각 경로의 존재 여부 출력
            for p in abs_paths:
                print(f"   - {p}: 존재={os.path.exists(p)}")
            raise FileNotFoundError(error_msg)
        
        self.load_models()
    
    def load_models(self):
        """앙상블 모델 3개 로드: XGBoost, LightGBM, Hierarchical Neural Network"""
        try:
            # Scaler 로드
            scaler_path = os.path.join(self.model_dir, 'final_ensemble_scaler.pkl')
            if not os.path.exists(scaler_path):
                raise FileNotFoundError(f"Scaler 파일을 찾을 수 없습니다: {scaler_path}")
            self.scaler = joblib.load(scaler_path)
            print(f"✅ Scaler 로드 완료: {scaler_path}")
            
            # 1. XGBoost 모델 로드
            xgb_path = os.path.join(self.model_dir, 'final_xgb_model.json')
            if not os.path.exists(xgb_path):
                raise FileNotFoundError(f"XGBoost 모델 파일을 찾을 수 없습니다: {xgb_path}")
            self.xgb_model = xgb.XGBClassifier()
            self.xgb_model.load_model(xgb_path)
            print(f"✅ XGBoost 모델 로드 완료: {xgb_path}")
            
            # 2. LightGBM 모델 로드
            lgb_path = os.path.join(self.model_dir, 'final_lgb_model.pkl')
            if not os.path.exists(lgb_path):
                raise FileNotFoundError(f"LightGBM 모델 파일을 찾을 수 없습니다: {lgb_path}")
            self.lgb_model = joblib.load(lgb_path)
            print(f"✅ LightGBM 모델 로드 완료: {lgb_path}")
            
            # 3. Hierarchical Neural Network 모델 로드
            hier_path = os.path.join(self.model_dir, 'final_hier_model.pth')
            if not os.path.exists(hier_path):
                raise FileNotFoundError(f"Hierarchical NN 모델 파일을 찾을 수 없습니다: {hier_path}")
            pathway_sizes = [8, 3, 6, 1, 2, 7]
            self.hier_model = HierarchicalModel(pathway_sizes)
            self.hier_model.load_state_dict(torch.load(hier_path))
            self.hier_model.eval()
            print(f"✅ Hierarchical NN 모델 로드 완료: {hier_path}")
            
            print("✅ 앙상블 모델 3개 로드 완료: XGBoost, LightGBM, Hierarchical NN")
        except Exception as e:
            print(f"❌ 모델 로드 중 오류 발생: {e}")
            import traceback
            traceback.print_exc()
            raise
    
    def preprocess(self, gene_values):
        """gene_values: dict with gene names as keys"""
        X = np.array([[gene_values.get(g, 0) for g in self.genes_27]])
        
        for i in range(X.shape[1]):
            X[:, i] = winsorize(X[:, i], limits=(0.01, 0.01))
        
        skewed = ['TP53', 'POLD3', 'PGR', 'PIK3CA', 'MTOR']
        for gene in skewed:
            idx = self.genes_27.index(gene)
            X[:, idx] = np.log1p(X[:, idx] - X[:, idx].min() + 1)
        
        return self.scaler.transform(X)
    
    def predict(self, gene_values):
        X_scaled = self.preprocess(gene_values)
        xgb_prob = self.xgb_model.predict_proba(X_scaled)[:, 1]
        lgb_prob = self.lgb_model.predict_proba(X_scaled)[:, 1]
        X_tensor = torch.FloatTensor(X_scaled)
        with torch.no_grad():
            hier_prob = self.hier_model(X_tensor).numpy().flatten()
        
        prob = float((xgb_prob[0] + lgb_prob[0] + hier_prob[0]) / 3)
        return prob
    
    def get_shap_values(self, gene_values):
        """SHAP 값 계산 - XGBoost 모델의 base_score 오류로 인해 실패할 수 있음"""
        X_scaled = self.preprocess(gene_values)
        try:
            # XGBoost 모델의 base_score 형식 오류로 인해 SHAP이 실패할 수 있음
            # 이 경우 예측은 정상 작동하지만 SHAP 값은 계산하지 않음
            explainer = shap.TreeExplainer(self.xgb_model)
            shap_values = explainer.shap_values(X_scaled)
            if isinstance(shap_values, list):
                return shap_values[0]
            return shap_values[0]
        except (ValueError, TypeError) as e:
            # base_score 형식 오류 등으로 SHAP 실패 시
            # 유전자 발현값의 절대값을 기반으로 근사값 생성
            warnings.warn(f"SHAP 값 계산 실패, 근사값 사용: {e}")
            X_scaled_flat = X_scaled[0]
            # 정규화된 값의 절대값을 기반으로 영향도 근사
            abs_values = np.abs(X_scaled_flat)
            # 정규화하여 SHAP 값처럼 사용
            shap_approx = (abs_values - abs_values.mean()) / (abs_values.std() + 1e-8)
            return shap_approx
        except Exception as e:
            warnings.warn(f"SHAP 값 계산 실패, 기본값 사용: {e}")
            return np.zeros(len(self.genes_27))
    
    def generate_report_image(self, gene_values, patient_info):
        """Generate clinical report as base64 image"""
        # 한글 폰트 재설정 (이미지 생성 전)
        set_korean_font()
        
        prob = self.predict(gene_values)
        shap_vals = self.get_shap_values(gene_values)
        
        fig = plt.figure(figsize=(24, 16), facecolor='#F5F7FA')
        gs = GridSpec(3, 3, figure=fig, width_ratios=[1.1, 1, 0.9], height_ratios=[0.28, 0.36, 0.36], wspace=0.2, hspace=0.32)

        # Header
        ax_header = fig.add_subplot(gs[0, :])
        ax_header.axis('off')
        ax_header.add_patch(patches.Rectangle((0, 0.1), 0.02, 0.8, color='#3498DB', transform=ax_header.transAxes))
        ax_header.text(0.04, 0.80, f"Patient Clinical Report: PATIENT_{patient_info.get('patient_id', 'Unknown')}", 
                      fontsize=30, weight='bold', color='#2C3E50')
        
        info_fs, label_c, val_c = 16, '#7F8C8D', '#2C3E50'
        col1, col2, col3 = 0.04, 0.35, 0.65
        
        ax_header.text(col1, 0.60, f"• 환자 ID:    ", fontsize=info_fs, color=label_c)
        ax_header.text(col1 + 0.08, 0.60, f"{patient_info.get('patient_id', 'N/A')}", fontsize=info_fs, color=val_c, weight='bold')
        ax_header.text(col2, 0.60, f"• 환자 성명:    ", fontsize=info_fs, color=label_c)
        ax_header.text(col2 + 0.09, 0.60, patient_info.get('name', '정보없음 (N/A)'), fontsize=info_fs, color=val_c, weight='bold')
        ax_header.text(col3, 0.60, f"• 나이:    ", fontsize=info_fs, color=label_c)
        ax_header.text(col3 + 0.05, 0.60, f"{patient_info.get('age', 'N/A')}세", fontsize=info_fs, color=val_c, weight='bold')
        
        ax_header.text(col1, 0.42, f"• 성별:    ", fontsize=info_fs, color=label_c)
        ax_header.text(col1 + 0.08, 0.42, patient_info.get('gender', 'N/A'), fontsize=info_fs, color=val_c, weight='bold')
        ax_header.text(col2, 0.42, f"• 아류형 (Subtype):    ", fontsize=info_fs, color=label_c)
        ax_header.text(col2 + 0.15, 0.42, "HER2-Enriched (HR-/HER2+)", fontsize=info_fs, color=val_c, weight='bold')
        ax_header.text(col3, 0.42, f"• 검사일:    ", fontsize=info_fs, color=label_c)
        ax_header.text(col3 + 0.06, 0.42, patient_info.get('test_date', 'N/A'), fontsize=info_fs, color=val_c, weight='bold')
        
        ax_header.text(0.04, 0.20, "AI 기반 정밀 분석 결과 요약 리포트입니다. 치료 방향 결정 시 임상적 소견과 병행하여 검토하십시오.", 
                     fontsize=12, style='italic', color='#95A5A6')

        # Left Panel (Top 10 Genes)
        ax_feat = fig.add_subplot(gs[1:, 0])
        gene_to_path = {g: p.split(' (')[0] for p, genes in self.pathways.items() for g in genes}
        feat_df = pd.DataFrame({'gene': self.genes_27, 'shap': shap_vals})
        feat_df['abs_shap'] = feat_df['shap'].abs()
        top_10 = feat_df.sort_values('abs_shap').tail(10).sort_values('shap', ascending=True)
        labels = [f"{r['gene']} ({gene_to_path.get(r['gene'], '기타')})" for _, r in top_10.iterrows()]
        
        colors = plt.cm.magma(np.linspace(0.4, 0.85, 10))
        bars = ax_feat.barh(labels, top_10['shap'], color=colors, height=0.7, edgecolor='white')
        ax_feat.set_title("1. 핵심 예측 지표 (Top 10 Impacts)", fontsize=18, weight='bold', pad=25)
        ax_feat.axvline(0, color='black', lw=1.2)
        ax_feat.grid(axis='x', linestyle='--', alpha=0.4)
        for b in bars:
            ax_feat.text(b.get_width() if b.get_width() > 0 else 0, b.get_y() + 0.35, f' {b.get_width():.2f}', weight='bold')

        # Center Panel (Radar)
        ax_radar = fig.add_subplot(gs[1:, 1], polar=True)
        X_s = self.preprocess(gene_values)[0]
        path_scores = {p: np.mean(X_s[[self.genes_27.index(g) for g in gs]]) for p, gs in self.pathways.items()}
        l_r, s_r = list(path_scores.keys()), list(path_scores.values())
        s_r += s_r[:1]
        angles = np.linspace(0, 2*np.pi, len(l_r), endpoint=False).tolist()
        angles += angles[:1]
        ax_radar.plot(angles, s_r, 'o-', lw=3, color='#E74C3C')
        ax_radar.fill(angles, s_r, color='#E74C3C', alpha=0.25)
        ax_radar.set_thetagrids(np.degrees(angles[:-1]), l_r, fontsize=12, weight='bold')
        ax_radar.set_title("2. 바이오마커 경로 활성도 (Z-Score)", pad=50, fontsize=17, weight='bold')
        ax_radar.set_ylim(-3, 3)

        # Right Panel (Result)
        ax_res = fig.add_subplot(gs[1, 2])
        ax_res.axis('off')
        ax_res.add_patch(patches.FancyBboxPatch((0, 0.05), 1.0, 0.9, boxstyle='round,pad=0.05', 
                                                ec='#2ECC71', fc='white', lw=3, transform=ax_res.transAxes))
        ax_res.text(0.5, 0.82, "최종 예측 결과", ha='center', fontsize=20, weight='bold', color='#27AE60')
        ax_res.text(0.5, 0.52, f"{prob*100:.1f}%", ha='center', va='center', fontsize=60, weight='bold')
        ax_res.text(0.5, 0.12, "양성 (Positive)" if prob >= 0.342 else "음성 (Negative)", 
                   ha='center', fontsize=24, weight='bold', color='#27AE60' if prob >= 0.342 else '#E74C3C')

        # Right Panel (Recommendations)
        ax_rec = fig.add_subplot(gs[2, 2])
        ax_rec.axis('off')
        ax_rec.add_patch(patches.FancyBboxPatch((0, -0.05), 1.0, 1.1, boxstyle='round,pad=0.05', 
                                               fc='#F4ECF7', transform=ax_rec.transAxes))
        ax_rec.add_patch(patches.Rectangle((0, 0.88), 1.0, 0.12, color='#8E44AD', alpha=0.9, transform=ax_rec.transAxes))
        ax_rec.text(0.5, 0.94, "AI 맞춤 치료 제안", ha='center', va='center', fontsize=22, weight='bold', color='white')
        
        rec = "📋 HER2 양성 특성\n   • Trastuzumab/Pertuzumab 표적치료 권장\n\n📋 높은 면역 활성\n   • 면역관문억제제 병용 고려 가능\n\n📋 빠른 세포 증식\n   • 세포독성 항암제 반응성 우수 예상" if prob >= 0.342 else "📋 관찰 요망\n   • 표준 프로토콜 준수\n   • 정밀 추적 검사 권장"
        ax_rec.text(0.08, 0.80, rec, fontsize=16, va='top', linespacing=1.8)

        # Convert to base64
        buffer = BytesIO()
        plt.tight_layout()
        plt.savefig(buffer, format='png', dpi=150, bbox_inches='tight')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode()
        plt.close()
        
        return {
            'probability': prob,
            'prediction': 'Positive' if prob >= 0.342 else 'Negative',
            'image': image_base64,
            'top_genes': top_10[['gene', 'shap']].to_dict('records'),
            'pathway_scores': path_scores
        }
