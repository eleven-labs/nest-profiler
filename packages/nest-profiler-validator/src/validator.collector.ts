import { Injectable } from '@nestjs/common';
import * as path from 'path';
import { ProfilerCollector } from '@eleven-labs/nest-profiler';
import type { IProfilerCollector, Profile } from '@eleven-labs/nest-profiler';
import { getCollectorEntries } from '@eleven-labs/nest-profiler';
import type { ValidationEntry } from './validator-collector.interface';
import { VALIDATOR_KEY } from './validator-collector.interface';

const VALIDATOR_ICON = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 4v5c0 4 3 6.5 7 7 4-.5 7-3 7-7V4L8 1z"/><path fill="white" d="M5 8l2 2 4-4" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

@Injectable()
@ProfilerCollector({ name: 'validator', label: 'Validator', icon: VALIDATOR_ICON, priority: 25 })
export class ValidatorCollector implements IProfilerCollector {
  readonly name = 'validator';
  readonly label = 'Validator';
  readonly icon = VALIDATOR_ICON;
  readonly priority = 25;

  getBadgeValue(profile: Profile): string | number | null {
    const entries =
      (profile.collectors[this.name] as ValidationEntry[] | undefined) ??
      getCollectorEntries<ValidationEntry>(profile, VALIDATOR_KEY);
    if (!entries.length) return null;
    return entries.length;
  }

  getTemplatePath(): string {
    return path.join(__dirname, 'templates', 'validator-panel.ejs');
  }

  collect(profile: Profile): ValidationEntry[] {
    const entries = getCollectorEntries<ValidationEntry>(profile, VALIDATOR_KEY);
    delete profile.collectors[VALIDATOR_KEY];
    return entries;
  }
}
