import { redirect } from 'next/navigation';

// The app starts at the dashboard; RequireAuth sends signed-out visitors to /login.
export default function HomePage() {
  redirect('/dashboard');
}
