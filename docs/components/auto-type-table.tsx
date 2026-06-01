import type { ComponentProps } from 'react';

import { createGenerator } from 'fumadocs-typescript';
import { AutoTypeTable as BaseAutoTypeTable } from 'fumadocs-typescript/ui';
import path from 'path';

const generator = createGenerator();
const MONOREPO_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), '..');

type Props = Omit<ComponentProps<typeof BaseAutoTypeTable>, 'generator'> & {
  path: string;
};

export function AutoTypeTable({ path: filePath, ...props }: Props) {
  const absolutePath = path.resolve(MONOREPO_ROOT, filePath);

  return <BaseAutoTypeTable {...props} generator={generator} path={absolutePath} />;
}
