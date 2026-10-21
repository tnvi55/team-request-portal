import { HealthStatus } from './health-status';

// M1 placeholder: proves the browser reaches Next.js and NestJS through one origin (localhost:8080).
export default function HomePage() {
  return (
    <main className="page">
      <h1>Team Request Portal</h1>
      <p className="muted">Workspace foundation (M1). Sign-in and requests arrive in later milestones.</p>
      <HealthStatus />
    </main>
  );
}
