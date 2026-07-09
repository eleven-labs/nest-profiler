import { PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto.js';

/** Every product field, all optional — a partial update. */
export class UpdateProductDto extends PartialType(CreateProductDto) {}
