import { DiscoveryService } from '@nestjs/core';

export interface ProfilerCollectorMetadata {
  name: string;
  label?: string;
  icon?: string;
  priority?: number;
  scope?: 'request' | 'global';
  group?: string;
  groupLabel?: string;
  groupIcon?: string;
  groupPriority?: number;
}

export const ProfilerCollector = DiscoveryService.createDecorator<ProfilerCollectorMetadata>();
