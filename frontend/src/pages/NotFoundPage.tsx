import { Link } from 'react-router-dom'
import { PATHS } from '@/routes/paths'

export default function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="text-center">
        <p className="text-5xl font-semibold text-ink-300">404</p>
        <p className="mt-3 text-sm text-ink-700">There is nothing at this address.</p>
        <Link to={PATHS.home} className="mt-2 inline-block text-sm font-semibold text-brand-700">
          Go to the app
        </Link>
      </div>
    </div>
  )
}
