import { Injectable } from '@nestjs/common';
import type { Book } from './book.model.js';
import type { CreateBookInput } from './create-book.input.js';

@Injectable()
export class BooksService {
  private readonly books: Book[] = [
    { id: '1', title: 'Clean Code', author: 'Robert C. Martin', publishedYear: 2008 },
    { id: '2', title: 'The Pragmatic Programmer', author: 'David Thomas', publishedYear: 1999 },
    { id: '3', title: 'Design Patterns', author: 'Gang of Four', publishedYear: 1994 },
  ];

  findAll(): Book[] {
    return this.books;
  }

  findOne(id: string): Book | undefined {
    return this.books.find((b) => b.id === id);
  }

  create(input: CreateBookInput): Book {
    const book: Book = {
      // In-memory demo IDs — a real implementation would use a database-generated ID.
      id: String(this.books.length + 1),
      title: input.title,
      author: input.author,
      ...(input.publishedYear !== undefined && { publishedYear: input.publishedYear }),
    };
    this.books.push(book);
    return book;
  }
}
