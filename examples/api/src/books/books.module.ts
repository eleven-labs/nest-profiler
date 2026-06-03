import { Module } from '@nestjs/common';
import { BooksResolver } from './books.resolver';
import { BooksService } from './books.service';

@Module({
  providers: [BooksResolver, BooksService],
})
export class BooksModule {}
