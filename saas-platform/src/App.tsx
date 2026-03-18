import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Documents from '@/pages/Documents';
import Contracts from '@/pages/Contracts';
import ContractTemplates from '@/pages/ContractTemplates';
import ContractExpirations from '@/pages/ContractExpirations';
import SharedDocuments from '@/pages/SharedDocuments';
import Sectors from '@/pages/Sectors';
import AccessManagement from '@/pages/AccessManagement';
import Trash from '@/pages/Trash';
import Settings from '@/pages/Settings';
import Config from '@/pages/Config';
import Profile from '@/pages/Profile';
import Scanner from '@/pages/Scanner';
import Retention from '@/pages/Retention';
import Workflows from '@/pages/Workflows';
import PublicShareView from '@/pages/PublicShareView';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Toaster } from 'sonner';

type TokenPayload = {
  exp?: number;
  role?: string;
  is_master?: boolean;
};

const getTokenPayload = (): TokenPayload | null => {
  const token = localStorage.getItem('token');
  if (!token || token === 'undefined' || token === 'null') return null;

  try {
    return JSON.parse(atob(token.split('.')[1])) as TokenPayload;
  } catch {
    return null;
  }
};

const isAuthenticated = () => {
  const payload = getTokenPayload();
  if (!payload) return false;
  if (payload.exp && Date.now() / 1000 >= payload.exp) return false;
  return true;
};

const canAccessRestrictedRoute = () => {
  const payload = getTokenPayload();
  if (!payload) return false;
  if (payload.is_master) return true;
  return (payload.role || '').toUpperCase() !== 'USER';
};

const ProtectedRoute = ({ children, restricted = false }: { children: React.ReactNode; restricted?: boolean }) => {
  if (!isAuthenticated()) {
    localStorage.clear();
    return <Navigate to="/login" replace />;
  }
  if (restricted && !canAccessRestrictedRoute()) {
    return <Navigate to="/dashboard" replace />;
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
          path="/contracts" 
          element={
            <ProtectedRoute>
              <Contracts />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/contracts/templates" 
          element={
            <ProtectedRoute>
              <ContractTemplates />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/contracts/expirations" 
          element={
            <ProtectedRoute>
              <ContractExpirations />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/documents/view/:id" 
          element={
            <ProtectedRoute>
              <Documents />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/shared" 
          element={
            <ProtectedRoute restricted>
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
            <ProtectedRoute restricted>
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
            <ProtectedRoute restricted>
              <Settings />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/config" 
          element={
            <ProtectedRoute restricted>
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
          path="/retention" 
          element={
            <ProtectedRoute>
              <Retention />
            </ProtectedRoute>
          } 
        />

        <Route 
          path="/workflows" 
          element={
            <ProtectedRoute>
              <Workflows />
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
