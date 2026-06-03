import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TypeOrmCollectorModule } from '@eleven-labs/nest-profiler-typeorm';
import { isProfilerEnabled } from '../config/app.config';
import { Product } from './product.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    TypeOrmCollectorModule.forRoot({
      enabled: isProfilerEnabled(process.env),
      slowQueryThreshold: 50,
    }),
  ],
  providers: [ProductsService],
  controllers: [ProductsController],
  exports: [ProductsService],
})
export class ProductsModule {}
