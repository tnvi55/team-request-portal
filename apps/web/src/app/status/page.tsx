import { HealthStatus } from '../health-status';

// Public: dependency readiness through the same origin (no user data).
export default function StatusPage() {
  return (
    <main className="page">
      <h1>System status</h1>
      <HealthStatus />
    </main>
  );
}
