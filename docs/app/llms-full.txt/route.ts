import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const texts = await Promise.all(pages.map(getLLMText));

  return new Response(texts.join('\n\n'));
}
