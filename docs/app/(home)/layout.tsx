import { HomeLayout } from '@hanzo/docs-ui/layouts/home';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: (
          <span className="font-semibold">
            <span className="text-primary">Hanzo</span>{' '}
            <span className="text-muted-foreground">HIPs</span>
          </span>
        ),
        url: '/',
      }}
    >
      {children}
    </HomeLayout>
  );
}
