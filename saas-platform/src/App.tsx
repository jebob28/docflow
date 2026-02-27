import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Documents from '@/pages/Documents';
import SharedDocuments from '@/pages/SharedDocuments';
import Sectors from '@/pages/Sectors';
import AccessManagement from '@/pages/AccessManagement';
import Trash from '@/pages/Trash';
import Settings from '@/pages/Settings';
import Config from '@/pages/Config';
import Profile from '@/pages/Profile';
import Scanner from '@/pages/Scanner';
import PublicShareView from '@/pages/PublicShareView';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Toaster } from 'sonner';

const isAuthenticated = () => !!localStorage.getItem('token');

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <DashboardLayout>{children}</DashboardLayout>;
};

function App() {
  return (
    <Router>
      <Toaster position="top-right" richColors />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/public/share/:token" element={<PublicShareView />} />
        
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/documents" 
          element={
            <ProtectedRoute>
              <Documents />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/shared" 
          element={
            <ProtectedRoute>
              <SharedDocuments />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/sectors" 
          element={
            <ProtectedRoute>
              <Sectors />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/access-management" 
          element={
            <ProtectedRoute>
              <AccessManagement />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/trash" 
          element={
            <ProtectedRoute>
              <Trash />
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
          path="/config" 
          element={
            <ProtectedRoute>
              <Config />
            </ProtectedRoute>
          } 
        />
        
        <Route 
          path="/scanner" 
          element={
            <ProtectedRoute>
              <Scanner />
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
        
        {/* Outras rotas podem ser adicionadas aqui seguindo o mesmo padrão */}
        
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
