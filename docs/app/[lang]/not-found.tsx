import { NotFoundContent } from '@/components/not-found-content';

// `notFound()` thrown inside `[lang]`; RootProvider comes from `[lang]/layout.tsx`.
export default function NotFound() {
  return <NotFoundContent />;
}
