import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add any auth tokens here if needed
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access
      console.error('Unauthorized access');
    }
    return Promise.reject(error);
  }
);

export const apiRequest = async (method: string, url: string, data?: any) => {
  try {
    const response = await apiClient.request({
      method,
      url,
      data,
      headers: data instanceof FormData ? {
        'Content-Type': 'multipart/form-data',
      } : undefined,
    });
    return response.data;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
};

export const loginApi = async (data: { username: string; password: string }) => {
  const res = await apiClient.post('/api/auth/login', data);
  return res.data;
};

export const meApi = async () => {
  const res = await apiClient.get('/api/auth/me');
  return res.data;
};

export const logoutApi = async () => {
  const res = await apiClient.post('/api/auth/logout');
  return res.data;
};

export const registerApi = async (data: { username: string; password: string; email?: string; department?: string; first_name?: string; last_name?: string }) => {
  const res = await apiClient.post('/api/auth/register', data);
  return res.data;
};

export const patientLoginApi = async (data: { account_id: string; password: string }) => {
  const res = await apiClient.post('/api/patients/login/', data);
  return res.data;
};

export const getDoctorsApi = async (department?: string) => {
  const query = department ? `?department=${encodeURIComponent(department)}` : '';
  const res = await apiClient.get(`/api/auth/doctors/${query}`);
  return res.data;
};

export const getPatientProfile = async (accountId: string) => {
  const res = await apiClient.get(`/api/patients/profile/${accountId}/`);
  return res.data;
};

export const updatePatientProfile = async (accountId: string, data: Record<string, unknown>) => {
  const res = await apiClient.put(`/api/patients/profile/${accountId}/`, data);
  return res.data;
};

export const patientSignupApi = async (data: { account_id: string; name: string; email: string; phone: string; password: string }) => {
  const res = await apiClient.post('/api/patients/signup/', data);
  return res.data;
};

export const getAppointmentsApi = async (params?: Record<string, unknown>) => {
  const res = await apiClient.get('/api/patients/appointments/', { params });
  return res.data;
};

export const getPatientsApi = async (
  params?: Record<string, unknown>,
) => {
  const res = await apiClient.get('/api/patients/patients/', {
    params,
  });
  return res.data;
};

export const searchPatientsApi = async (searchTerm: string) => {
  // lung_cancer 앱의 환자 검색 API 사용 (환자 정보 페이지와 동일)
  const res = await apiClient.get('/api/lung_cancer/patients/', {
    params: { search: searchTerm },
  });
  // 응답 형식: {results: [...]} 또는 배열
  return res.data.results || res.data || [];
};

export const createAppointmentApi = async (data: Record<string, unknown>) => {
  const res = await apiClient.post('/api/patients/appointments/', data);
  return res.data;
};

export const updateAppointmentApi = async (id: string, data: Record<string, unknown>) => {
  const res = await apiClient.patch(`/api/patients/appointments/${id}/`, data);
  return res.data;
};

export const deleteAppointmentApi = async (id: string) => {
  const res = await apiClient.delete(`/api/patients/appointments/${id}/`);
  return res.data;
};

// OCS API
export const getOrdersApi = async (params?: Record<string, unknown>) => {
  const res = await apiClient.get('/api/ocs/orders/', { params });
  return res.data;
};

export const getOrderApi = async (id: string) => {
  const res = await apiClient.get(`/api/ocs/orders/${id}/`);
  return res.data;
};

export const createOrderApi = async (data: Record<string, unknown>) => {
  const res = await apiClient.post('/api/ocs/orders/', data);
  return res.data;
};

export const updateOrderApi = async (id: string, data: Record<string, unknown>) => {
  const res = await apiClient.patch(`/api/ocs/orders/${id}/`, data);
  return res.data;
};

export const deleteOrderApi = async (id: string) => {
  const res = await apiClient.delete(`/api/ocs/orders/${id}/`);
  return res.data;
};

export const sendOrderApi = async (id: string) => {
  const res = await apiClient.post(`/api/ocs/orders/${id}/send/`);
  return res.data;
};

export const startProcessingOrderApi = async (id: string) => {
  const res = await apiClient.post(`/api/ocs/orders/${id}/start_processing/`);
  return res.data;
};

export const completeOrderApi = async (id: string) => {
  const res = await apiClient.post(`/api/ocs/orders/${id}/complete/`);
  return res.data;
};

export const cancelOrderApi = async (id: string, reason?: string) => {
  const res = await apiClient.post(`/api/ocs/orders/${id}/cancel/`, { reason });
  return res.data;
};

export const revalidateOrderApi = async (id: string) => {
  const res = await apiClient.post(`/api/ocs/orders/${id}/revalidate/`);
  return res.data;
};

export const getOrderStatisticsApi = async () => {
  const res = await apiClient.get('/api/ocs/orders/statistics/');
  return res.data;
};

export const getMyOrdersApi = async () => {
  const res = await apiClient.get('/api/ocs/orders/my_orders/');
  return res.data;
};

export const getPendingOrdersApi = async (department?: string) => {
  const params = department ? { department } : {};
  const res = await apiClient.get('/api/ocs/orders/pending_orders/', { params });
  return res.data;
};

// 알림 API
export const getNotificationsApi = async (params?: Record<string, unknown>) => {
  const res = await apiClient.get('/api/ocs/notifications/', { params });
  return res.data;
};

export const markNotificationReadApi = async (id: string) => {
  const res = await apiClient.post(`/api/ocs/notifications/${id}/mark_read/`);
  return res.data;
};

export const markAllNotificationsReadApi = async () => {
  const res = await apiClient.post('/api/ocs/notifications/mark_all_read/');
  return res.data;
};

export const getUnreadNotificationCountApi = async () => {
  const res = await apiClient.get('/api/ocs/notifications/unread_count/');
  return res.data;
};

// 영상 분석 결과 API
export const getImagingAnalysisApi = async (params?: Record<string, unknown>) => {
  const res = await apiClient.get('/api/ocs/imaging-analysis/', { params });
  return res.data;
};

export const getImagingAnalysisByIdApi = async (id: string) => {
  const res = await apiClient.get(`/api/ocs/imaging-analysis/${id}/`);
  return res.data;
};

export const getPatientAnalysisDataApi = async (patientId: string) => {
  const res = await apiClient.get(`/api/ocs/imaging-analysis/get_patient_analysis_data/?patient_id=${encodeURIComponent(patientId)}`);
  return res.data;
};

export const createImagingAnalysisApi = async (data: Record<string, unknown> | FormData) => {
  // FormData인 경우 (이미지 파일 포함)
  if (data instanceof FormData) {
    const res = await apiClient.post('/api/ocs/imaging-analysis/', data, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  }
  // 일반 객체인 경우
  const res = await apiClient.post('/api/ocs/imaging-analysis/', data);
  return res.data;
};

export default apiClient;
