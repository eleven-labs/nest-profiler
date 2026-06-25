import type { LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';

import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Database,
  ExternalLink,
  Eye,
  Globe,
  Network,
  Settings2,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { GITHUB_URL } from '@/lib/constants';
import { i18n } from '@/lib/i18n';
import { JsonLd, softwareSourceCodeJsonLd, webSiteJsonLd } from '@/lib/json-ld';

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
};

interface Collector {
  description: string;
  icon: LucideIcon;
  title: string;
}

const COLLECTORS: Collector[] = [
  {
    icon: Database,
    title: 'Database',
    description:
      'TypeORM and MikroORM SQL queries with type, duration and slow-query highlighting.',
  },
  {
    icon: Network,
    title: 'MongoDB',
    description: 'Mongoose queries and aggregations with collection, duration and result count.',
  },
  {
    icon: Globe,
    title: 'HTTP Client / GraphQL',
    description:
      'Outgoing HttpService calls and GraphQL queries/mutations - method, URL, operation type and name.',
  },
  {
    icon: Boxes,
    title: 'Cache',
    description: 'GET_HIT / GET_MISS / SET / DEL operations with a hit-ratio badge.',
  },
  {
    icon: Terminal,
    title: 'Command',
    description: 'nest-commander CLI runs - command name, arguments, options and exit code.',
  },
  {
    icon: ShieldCheck,
    title: 'Security',
    description: 'request.user, JWT claims and roles - sensitive fields masked.',
  },
  {
    icon: Settings2,
    title: 'Config',
    description: 'ConfigService snapshot, flattened to dot-keys with secret masking.',
  },
  {
    icon: CheckCircle2,
    title: 'Validator',
    description: 'DTO validation results with per-property constraint violations.',
  },
  {
    icon: Activity,
    title: 'Timeline',
    description: 'Custom spans created with startSpan() rendered as synchronized bars.',
  },
];

const HIGHLIGHTS = [
  'Extensible collectors - implement IProfilerCollector to add your own panel',
  'Two storage backends: in-memory LRU or file-based persistence',
  'Request sampling & path filtering to control overhead',
  'Module-per-collector pattern - import each package where it belongs',
  'GraphQL support - Apollo, Mercurius and graphql-yoga via nest-profiler-graphql',
  'CLI command profiling - nest-commander runs shown next to HTTP requests via nest-profiler-commander',
];

const GALLERY: { alt: string; src: string }[] = [
  { src: '/screenshots/profiler/database.png', alt: 'Database panel with profiled SQL queries' },
  { src: '/screenshots/profiler/cache.png', alt: 'Cache panel with hit/miss operations' },
  { src: '/screenshots/profiler/security.png', alt: 'Security panel with decoded JWT claims' },
  { src: '/screenshots/profiler/validator.png', alt: 'Validator panel with constraint violations' },
];

export default async function LandingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const base = lang === i18n.defaultLanguage ? '' : `/${lang}`;
  const docsUrl = `${base}/docs`;
  const getStartedUrl = `${base}/docs/getting-started`;

  return (
    <main className="flex flex-1 flex-col">
      <JsonLd data={webSiteJsonLd()} />
      <JsonLd data={softwareSourceCodeJsonLd()} />
      {/* Hero */}
      <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-16 pb-12 text-center md:pt-24">
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-primary/5 px-3 py-1 text-xs font-medium text-fd-primary">
          <Eye className="size-3.5" /> Symfony Web Profiler–inspired
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fd-foreground md:text-6xl">
          See what your NestJS app really does
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-fd-muted-foreground">
          An execution profiler for NestJS with a rich panel UI at{' '}
          <code className="rounded-sm bg-fd-secondary px-1.5 py-0.5 text-sm">/_profiler</code>.
          Inspect SQL, HTTP calls, GraphQL, cache, auth, validation and custom spans - in real time.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
            href={getStartedUrl}
          >
            Get started <ArrowRight className="size-4" />
          </Link>
          <a
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground transition-colors hover:bg-fd-accent"
            href={GITHUB_URL}
            rel="noreferrer noopener"
            target="_blank"
          >
            View on GitHub <ExternalLink className="size-4" />
          </a>
        </div>

        <div className="mt-12 w-full overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-2xl shadow-fd-primary/5">
          <Image
            alt="Profiler UI - profiles list with filters, HTTP statuses, durations and global panels"
            className="h-auto w-full"
            height={1000}
            priority
            sizes="(max-width: 1152px) 100vw, 1152px"
            src="/screenshots/profiler/profiles-list.png"
            width={1440}
          />
        </div>
      </section>

      {/* Collectors grid */}
      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <h2 className="text-center text-2xl font-bold text-fd-foreground md:text-3xl">
          One panel per collector
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-fd-muted-foreground">
          Install the core package, then add only the collectors you need. Each is a self-contained
          NestJS module.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
          {COLLECTORS.map(({ icon: Icon, title, description }) => (
            <div
              className="rounded-xl border border-fd-border bg-fd-card p-5 transition-colors hover:border-fd-primary/40"
              key={title}
            >
              <div className="mb-3 flex items-center gap-4">
                <div className="inline-flex size-10 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
                  <Icon className="size-5" />
                </div>
                <h3 className="font-semibold text-fd-foreground">{title}</h3>
              </div>
              <p className="mt-1 text-sm text-fd-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Highlights */}
      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="rounded-2xl border border-fd-border bg-fd-card p-8">
          <h2 className="text-2xl font-bold text-fd-foreground">Built for everyday debugging</h2>
          <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            {HIGHLIGHTS.map((item) => (
              <li className="flex items-start gap-2 text-sm text-fd-muted-foreground" key={item}>
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-fd-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Gallery */}
      <section className="mx-auto w-full max-w-6xl px-4 py-12">
        <h2 className="text-center text-2xl font-bold text-fd-foreground md:text-3xl">
          A closer look
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {GALLERY.map(({ src, alt }) => (
            <div
              className="overflow-hidden rounded-xl border border-fd-border bg-fd-card"
              key={src}
            >
              <Image
                alt={alt}
                className="h-auto w-full"
                height={1000}
                sizes="(max-width: 768px) 100vw, 576px"
                src={src}
                width={1440}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-fd-foreground md:text-3xl">
          Ready to profile your app?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-fd-muted-foreground">
          Get the core package running and open the profiler UI in under five minutes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition-opacity hover:opacity-90"
            href={getStartedUrl}
          >
            Get started <ArrowRight className="size-4" />
          </Link>
          <Link
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-semibold text-fd-foreground transition-colors hover:bg-fd-accent"
            href={docsUrl}
          >
            Browse the docs
          </Link>
        </div>
      </section>
    </main>
  );
}
