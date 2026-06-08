import { ImageResponse } from 'next/og';

import { SITE_NAME } from '@/lib/constants';

export const alt = `${SITE_NAME} — NestJS Web Profiler`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#0b0b0f',
        backgroundImage:
          'radial-gradient(circle at 20% 20%, rgba(229,34,90,0.25), transparent 45%)',
        padding: '72px',
        color: '#ffffff',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            fontSize: 34,
            fontWeight: 700,
            color: '#e5225a',
          }}
        >
          {SITE_NAME}
        </div>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 800, lineHeight: 1.1 }}>
          A Symfony-inspired Web Profiler for NestJS
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#b8b8c4', maxWidth: '900px' }}>
          Profile every request — HTTP, database, cache, security, GraphQL, timeline and more.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          fontSize: 26,
          color: '#9a9aa8',
        }}
      >
        Powered &amp; maintained by{' '}
        <span style={{ color: '#ffffff', fontWeight: 700, marginLeft: '8px' }}>Eleven Labs</span>
      </div>
    </div>,
    size,
  );
}
