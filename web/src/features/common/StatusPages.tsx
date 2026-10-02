import { Lock, MapPinOff } from 'lucide-react';
import { ButtonLink, EmptyState } from '@/components/ui';

export function NoAccess() {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access to this page"
      description="Your role does not include this area. Ask a manager if you need it."
      action={<ButtonLink to="/">Go to start page</ButtonLink>}
    />
  );
}

export function NotFound() {
  return <EmptyState icon={MapPinOff} title="Page not found" description="The link may be out of date." action={<ButtonLink to="/">Go to start page</ButtonLink>} />;
}
