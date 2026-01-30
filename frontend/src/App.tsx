import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
} from "react-router-dom";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import Visualization3D from "@/pages/3DVisualization";
import LungCancerPrediction from "@/pages/LungCancerPrediction";
import LungCancerStats from "@/pages/LungCancerStats";
import MedicalRegistration from "@/pages/MedicalRegistration";
import KnowledgeHub from "@/pages/KnowledgeHub";
import ReservationInfo from "@/pages/ReservationInfo";
import NotFound from "@/pages/NotFound";
import MRIViewer from "@/pages/MRIViewer";
import MRIImageDetail from "@/pages/MRIImageDetail";
import Sidebar from "@/components/Sidebar";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import PatientLogin from "@/pages/PatientLogin";
import PatientSignup from "@/pages/PatientSignup";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/context/AuthContext";
import { CalendarProvider } from "@/context/CalendarContext";
import Home from "@/pages/Home";
import PatientMyPage from "@/pages/PatientMyPage";
import PatientMedicalRecords from "@/pages/PatientMedicalRecords";
import PatientDoctors from "@/pages/PatientDoctors";
import AppDownload from "@/pages/AppDownload";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import MedicalLayout from "@/components/MedicalLayout";
import OCS from "@/pages/OCS";
import ImagingAnalysisDetail from "@/pages/ImagingAnalysisDetail";
import Schedule from "@/pages/Schedule";
import LaboratoryDashboard from "@/pages/LaboratoryDashboard";
import LaboratoryAIAnalysis from "@/pages/LaboratoryAIAnalysis";
import PathologyAnalysis from "@/pages/PathologyAnalysis";
import HealthInfo from "@/pages/HealthInfo";
import BreastCancerStats from "@/pages/BreastCancerStats";

const queryClient = new QueryClient();

function AppContentInner() {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  const isPublicPage = [
    "/",
    "/login",
    "/signup",
    "/patient/login",
    "/patient/signup",
    "/patient/mypage",
    "/patient/records",
    "/patient/doctors",
    "/app-download",
    "/health-info",
    "/breast-cancer-stats",
  ].includes(location.pathname);

  // MRIImageDetail 페이지는 사이드바 숨김 (전체 화면)
  const isMriImageDetail = location.pathname.startsWith("/mri-viewer/") && location.pathname !== "/mri-viewer";

  const medicalStaffRoutes = (
    <Routes>
      <Route
        path="/medical_staff"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin_staff"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/patients"
        element={
          <ProtectedRoute>
            <Patients />
          </ProtectedRoute>
        }
      />
      <Route
        path="/medical-registration"
        element={
          <ProtectedRoute>
            <MedicalRegistration />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reservation-info"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <ReservationInfo />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <ReservationInfo />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/3d-visualization"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "superuser"]}>
            <Visualization3D />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mri-viewer"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "superuser"]}>
            <MRIViewer />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lung-cancer"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "superuser"]}>
            <LungCancerPrediction />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lung-cancer-stats"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "superuser"]}>
            <LungCancerStats />
          </ProtectedRoute>
        }
      />
      <Route
        path="/knowledge-hub"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "superuser"]}>
            <KnowledgeHub />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ocs"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <OCS />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ocs/imaging-analysis/:id"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <ImagingAnalysisDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ocs/orders/:id"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <OCS />
          </ProtectedRoute>
        }
      />
      <Route
        path="/laboratory-dashboard"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <LaboratoryDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/laboratory-ai-analysis"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <LaboratoryAIAnalysis />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pathology-analysis"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <PathologyAnalysis />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute allowedRoles={["medical_staff", "admin_staff", "superuser"]}>
            <Schedule />
          </ProtectedRoute>
        }
      />
      {/* 404 Route for internal pages */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex">
      {!isPublicPage && !isMriImageDetail && (
        <Sidebar isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen} />
      )}
      <div className={cn(
        "flex-1 transition-all duration-300",
        isPublicPage || isMriImageDetail ? "" : isSidebarOpen ? "ml-64" : "ml-20"
      )}>
        {isPublicPage || isMriImageDetail ? (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/patient/login" element={<PatientLogin />} />
            <Route path="/patient/signup" element={<PatientSignup />} />
            <Route path="/patient/mypage" element={<PatientMyPage />} />
            <Route path="/patient/records" element={<PatientMedicalRecords />} />
            <Route path="/patient/doctors" element={<PatientDoctors />} />
            <Route path="/app-download" element={<AppDownload />} />
            <Route path="/health-info" element={<HealthInfo />} />
            <Route path="/breast-cancer-stats" element={<BreastCancerStats />} />
            <Route
              path="/mri-viewer/:patientId"
              element={
              <ProtectedRoute allowedRoles={["medical_staff", "superuser"]}>
                  <MRIImageDetail />
              </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        ) : (
          <MedicalLayout isSidebarOpen={isSidebarOpen} setIsSidebarOpen={setIsSidebarOpen}>
            {medicalStaffRoutes}
          </MedicalLayout>
        )}
      </div>
    </div>
  );
}

function AppContent() {
  return (
    <Router>
      <AppContentInner />
      <Toaster />
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <CalendarProvider>
            <AppContent />
          </CalendarProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
