import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loginApi, meApi, logoutApi, getPatientsApi } from '@/lib/api';

export type User = {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: 'medical_staff' | 'admin_staff' | 'superuser';
  doctor_id?: string | null;
  department?: string | null;
};

export type PatientUser = {
  account_id: string;
  patient_id: string;
  name: string;
  email: string;
  phone: string;
  patient_pk?: number | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (params: { username: string; password: string }) => Promise<User>;
  logout: () => Promise<void>;
  patientUser: PatientUser | null;
  setPatientUser: (patient: PatientUser | null) => void;
};

const PATIENT_USER_STORAGE_KEY = 'patient_user';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [patientUser, setPatientUserState] = useState<PatientUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const pathname = window.location.pathname;
      const isPatientRoute = pathname.startsWith('/patient');
      const isPublicRoute = ['/', '/index.html', '/login', '/signup', '/app-download'].includes(pathname);
      if (isPatientRoute || isPublicRoute) {
        setLoading(false);
        return;
      }

      try {
        const me = await meApi();
        setUser(me);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PATIENT_USER_STORAGE_KEY);
      if (stored) {
        setPatientUserState(JSON.parse(stored));
      }
    } catch {
      setPatientUserState(null);
    }
  }, []);

  useEffect(() => {
    if (!patientUser?.patient_id || patientUser.patient_pk != null) return;
    let cancelled = false;

    const parsePatientPk = (data: unknown): number | null => {
      if (Array.isArray(data) && data.length > 0) {
        const first = data[0] as { id?: unknown };
        return typeof first?.id === 'number' ? first.id : null;
      }
      if (data && typeof data === 'object') {
        const results = (data as { results?: unknown }).results;
        if (Array.isArray(results) && results.length > 0) {
          const first = results[0] as { id?: unknown };
          return typeof first?.id === 'number' ? first.id : null;
        }
      }
      return null;
    };

    const fetchPatientPk = async () => {
      try {
        const list = await getPatientsApi({ search: patientUser.patient_id });
        const patientPk = parsePatientPk(list);
        if (cancelled || patientPk == null) return;
        const updatedPatient: PatientUser = {
          ...patientUser,
          patient_pk: patientPk,
        };
        setPatientUserState(updatedPatient);
        try {
          localStorage.setItem(PATIENT_USER_STORAGE_KEY, JSON.stringify(updatedPatient));
        } catch {
          // ignore storage errors
        }
      } catch {
        // ignore patient list errors
      }
    };

    fetchPatientPk();
    return () => {
      cancelled = true;
    };
  }, [patientUser?.patient_id, patientUser?.patient_pk]);

  const setPatientUser = React.useCallback((patient: PatientUser | null) => {
    setPatientUserState(patient);
    try {
      if (patient) {
        localStorage.setItem(PATIENT_USER_STORAGE_KEY, JSON.stringify(patient));
      } else {
        localStorage.removeItem(PATIENT_USER_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    loading,
    patientUser,
    setPatientUser,
    login: async ({ username, password }) => {
      await loginApi({ username, password });
      const u = await meApi();
      setUser(u);
      return u;
    },
    logout: async () => {
      await logoutApi();
      setUser(null);
      setPatientUser(null);
    },
  }), [user, loading, patientUser, setPatientUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
