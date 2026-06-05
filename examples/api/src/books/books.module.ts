import { Module } from '@nestjs/common';
import { BooksResolver } from './books.resolver.js';
import { BooksService } from './books.service.js';

@Module({
  providers: [BooksResolver, BooksService],
})
export class BooksModule {}
