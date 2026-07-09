import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ProductService } from '../application/product.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import type { Product } from '../domain/product.js';

@ApiTags('products')
@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'List all products — demonstrates the active SQL ORM collector' })
  @ApiResponse({ status: 200, description: 'Array of products' })
  findAll(): Promise<Product[]> {
    return this.products.findAll();
  }

  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products.csv"')
  @ApiOperation({
    summary: 'Export all products as CSV — streams the rows (QueryBuilder.stream()) into the file',
  })
  @ApiResponse({ status: 200, description: 'CSV export of every product' })
  exportCsv(): Promise<string> {
    return this.products.exportCsv();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by ID' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Product> {
    return this.products.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a product — triggers an INSERT + the validator collector' })
  @ApiResponse({ status: 201, description: 'Product created' })
  @ApiResponse({
    status: 400,
    description: 'Validation failed — check the Validator panel in /_profiler',
  })
  create(@Body() dto: CreateProductDto): Promise<Product> {
    return this.products.create(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product by ID' })
  @ApiParam({ name: 'id', type: Number, example: 1 })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<{ deleted: boolean }> {
    await this.products.remove(id);
    return { deleted: true };
  }
}
