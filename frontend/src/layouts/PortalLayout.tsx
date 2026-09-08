// The signed-in shell: sidebar + topbar + content outlet + the toast rail.
import { Outlet } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import { Topbar } from '@/components/Topbar'
import { Toaster } from '@/components/Toaster'

export default function PortalLayout() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <div className="flex-1 p-6">
          <Outlet />
        </div>
        <Toaster />
      </main>
    </div>
  )
}
