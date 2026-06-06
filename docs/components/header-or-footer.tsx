import { ElevenLabsLogo } from '@/components/Eleven-labs-logo';
import { cn } from '@/lib/cn';
import { ELEVEN_LABS_URL } from '@/lib/constants';

export function HeaderOrFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t border-fd-border', className)}>
      <div
        className="
          mx-auto flex w-full max-w-6xl items-center justify-center gap-2 px-6 py-8 text-sm
          text-fd-muted-foreground
        "
      >
        <span>Powered &amp; maintained by</span>
        <a
          aria-label="Eleven Labs"
          className="text-eleven-labs-logo transition-opacity hover:opacity-70"
          href={ELEVEN_LABS_URL}
          rel="noreferrer"
          target="_blank"
        >
          <ElevenLabsLogo className="h-5 w-auto" />
        </a>
      </div>
    </footer>
  );
}
