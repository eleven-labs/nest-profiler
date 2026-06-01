import 'fumadocs-ui/style.css';

import './global.css';
import type { ReactNode } from 'react';

import { RootProvider } from 'fumadocs-ui/provider/next';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <body>
        <RootProvider search={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
