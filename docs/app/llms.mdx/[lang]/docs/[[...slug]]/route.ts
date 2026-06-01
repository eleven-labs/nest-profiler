import { notFound } from 'next/navigation';

import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';

interface RouteContext {
  params: Promise<{ lang: string; slug?: string[] }>;
}

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext) {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: { 'Content-Type': 'text/markdown' },
  });
}
