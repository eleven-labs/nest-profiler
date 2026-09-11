import { ConditionalModule } from '@nestjs/config';
import type { ModuleMetadata } from '@nestjs/common';
import { isHttpClient } from '../../../config/features.config.js';
import { ReviewerAxiosModule } from './reviewer.axios.module.js';
import { ReviewerFetchModule } from './reviewer.fetch.module.js';

/**
 * The `HTTP_CLIENT` selection for the {@link ReviewerGateway} port. Whichever loader adapter
 * `FEATURE_DATALOADER` picks needs the gateway, and a module only sees what it imports itself —
 * so the selection is declared once here and imported by both, instead of being duplicated.
 */
export const reviewerGatewayImports = (): NonNullable<ModuleMetadata['imports']> => [
  ConditionalModule.registerWhen(ReviewerAxiosModule, isHttpClient('axios')),
  ConditionalModule.registerWhen(ReviewerFetchModule, isHttpClient('fetch')),
];
