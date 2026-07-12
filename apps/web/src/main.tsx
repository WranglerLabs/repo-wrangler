import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CommandCenter } from './routes/CommandCenter';
import { Repositories } from './routes/Repositories';
import { RepositoryDetail } from './routes/RepositoryDetail';
import { Workspaces } from './routes/Workspaces';
import { PlatformHealth } from './routes/PlatformHealth';
import { Credits } from './routes/Credits';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <CommandCenter /> },
      { path: 'repositories', element: <Repositories /> },
      { path: 'repositories/:id', element: <RepositoryDetail /> },
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'platform', element: <PlatformHealth /> },
      { path: 'credits', element: <Credits /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
