'use client';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { cn } from '../../lib/cn';

export const Popover = PopoverPrimitive.Root;

export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  align = 'center',
  className,
  sideOffset = 4,
  ...props
}: React.ComponentPropsWithRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        className={cn(
          `
            z-50 max-h-(--radix-popover-content-available-height) max-w-[98vw]
            min-w-[240px] origin-(--radix-popover-content-transform-origin)
            overflow-y-auto rounded-xl border bg-fd-popover/60 p-2 text-sm
            text-fd-popover-foreground shadow-lg backdrop-blur-lg
            focus-visible:outline-none
            data-[state=closed]:animate-fd-popover-out
            data-[state=open]:animate-fd-popover-in
          `,
          className,
        )}
        side="bottom"
        sideOffset={sideOffset}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const PopoverClose = PopoverPrimitive.PopoverClose;
