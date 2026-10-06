import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import Timeline from './routes/Timeline.tsx'

const OneDriveCallback = lazy(() => import('./routes/OneDriveCallback.tsx'))
const DropboxCallback = lazy(() => import('./routes/DropboxCallback.tsx'))
const Privacy = lazy(() => import('./routes/Privacy.tsx'))
const Settings = lazy(() => import('./routes/Settings.tsx'))

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Timeline />} />
        <Route
          path="/settings"
          element={<Suspense fallback={null}><Settings /></Suspense>}
        />
        <Route
          path="/privacy"
          element={<Suspense fallback={null}><Privacy /></Suspense>}
        />
        <Route
          path="/auth/dropbox/callback"
          element={<Suspense fallback={null}><DropboxCallback /></Suspense>}
        />
        <Route path="/auth/onedrive/callback" element={<Suspense fallback={null}><OneDriveCallback /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
