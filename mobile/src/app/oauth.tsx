// duniya://oauth lands here when the system hands the sign-in redirect to the router (the sign-in itself is
// finished by expo-auth-session); we just go back to where the user is.
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function OAuthReturn() {
  const { state } = useAuth();
  return <Redirect href={state === 'ready' ? '/' : '/connect'} />;
}
