import { DashSkeleton } from './DashSkeleton'

// Shown the moment the dashboard is opened (from the logo, a breadcrumb or after signing in): its frame and
// grey cards where the videos will be (user, 2026-11-11: was the full-screen loader with the panda)
export default function DashboardLoading() {
  return <DashSkeleton />
}
