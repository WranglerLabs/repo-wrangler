import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { CommandCenter } from './routes/CommandCenter';
import { Repositories } from './routes/Repositories';
import { RepositoryDetail } from './routes/RepositoryDetail';
import { Branches } from './routes/Branches';
import { Pipelines } from './routes/Pipelines';
import { ChangeRequests } from './routes/ChangeRequests';
import { Security } from './routes/Security';
import { Budgets } from './routes/Budgets';
import { Activity } from './routes/Activity';
import { Workspaces } from './routes/Workspaces';
import { PlatformHealth } from './routes/PlatformHealth';
import { Administration } from './routes/Administration';
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
      { path: 'branches', element: <Branches /> },
      { path: 'pipelines', element: <Pipelines /> },
      { path: 'change-requests', element: <ChangeRequests /> },
      { path: 'security', element: <Security /> },
      { path: 'budgets', element: <Budgets /> },
      { path: 'activity', element: <Activity /> },
      { path: 'workspaces', element: <Workspaces /> },
      { path: 'platform', element: <PlatformHealth /> },
      { path: 'admin', element: <Administration /> },
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
