import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { createApi } from './api';
import { ApiProvider } from './api/hooks';
import { AuthProvider } from './auth/AuthContext';
import { createAppRouter } from './app/router';
import './styles/tokens.css';
import './styles.css';
import './styles/shell.css';

const api = createApi();
const router = createAppRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider api={api}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ApiProvider>
  </StrictMode>,
);
