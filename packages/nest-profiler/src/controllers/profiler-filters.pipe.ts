import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { ProfilerFiltersQuery } from './profiler-filters.query';

/**
 * Normalizes the raw profiler list query into a typed {@link ProfilerFiltersQuery}.
 *
 * Numeric filters are parsed leniently: absent, empty or non-numeric values are
 * dropped (left `undefined`) instead of producing `NaN` filters that would
 * silently hide every profile. String filters are passed through when non-empty.
 *
 * This is a self-contained pipe on purpose: the package stays free of any
 * particular validation library (class-validator, zod, …) so consumers keep full
 * control over their own global pipes and DTO validation stack.
 */
@Injectable()
export class ProfilerFiltersPipe implements PipeTransform<unknown, ProfilerFiltersQuery> {
  transform(value: unknown): ProfilerFiltersQuery {
    const raw = (value ?? {}) as Record<string, unknown>;
    return {
      method: this.toString(raw['method']),
      statusCode: this.toNumber(raw['statusCode']),
      minDuration: this.toNumber(raw['minDuration']),
      maxDuration: this.toNumber(raw['maxDuration']),
      url: this.toString(raw['url']),
    };
  }

  private toString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private toNumber(value: unknown): number | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
}
