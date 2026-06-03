import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ProfilerService } from '@eleven-labs/nest-profiler';
import { Book } from './book.model';
import { BooksService } from './books.service';
import { CreateBookInput } from './create-book.input';

@Resolver(() => Book)
export class BooksResolver {
  constructor(
    private readonly booksService: BooksService,
    private readonly profilerService: ProfilerService,
  ) {}

  @Query(() => [Book], { description: 'Retrieve all books' })
  books(): Book[] {
    const end = this.profilerService.startSpan('books.findAll');
    try {
      return this.booksService.findAll();
    } finally {
      end();
    }
  }

  @Query(() => Book, { nullable: true, description: 'Retrieve a single book by id' })
  book(@Args('id', { type: () => ID }) id: string): Book | undefined {
    const end = this.profilerService.startSpan('books.findOne');
    try {
      return this.booksService.findOne(id);
    } finally {
      end();
    }
  }

  @Mutation(() => Book, { description: 'Create a new book' })
  createBook(@Args('input') input: CreateBookInput): Book {
    const end = this.profilerService.startSpan('books.create');
    try {
      return this.booksService.create(input);
    } finally {
      end();
    }
  }
}
