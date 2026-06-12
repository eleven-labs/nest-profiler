import { ImageResponse } from 'next/og';

import { SITE_NAME } from '@/lib/constants';

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

const MAX_DESCRIPTION_LENGTH = 140;

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function renderOGImage({
  title,
  description,
}: {
  description?: string;
  title: string;
}): ImageResponse {
  // Long page titles need a smaller headline to stay within the 1200×630 frame.
  const titleFontSize = title.length > 40 ? 56 : 72;

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
        <div style={{ display: 'flex', fontSize: titleFontSize, fontWeight: 800, lineHeight: 1.1 }}>
          {title}
        </div>
        {description ? (
          <div style={{ display: 'flex', fontSize: 30, color: '#b8b8c4', maxWidth: '900px' }}>
            {truncate(description, MAX_DESCRIPTION_LENGTH)}
          </div>
        ) : null}
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
    OG_IMAGE_SIZE,
  );
}
