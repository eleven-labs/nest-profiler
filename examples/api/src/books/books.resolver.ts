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
    const result = this.booksService.findAll();
    end();
    return result;
  }

  @Query(() => Book, { nullable: true, description: 'Retrieve a single book by id' })
  book(@Args('id', { type: () => ID }) id: string): Book | undefined {
    const end = this.profilerService.startSpan('books.findOne');
    const result = this.booksService.findOne(id);
    end();
    return result;
  }

  @Mutation(() => Book, { description: 'Create a new book' })
  createBook(@Args('input') input: CreateBookInput): Book {
    const end = this.profilerService.startSpan('books.create');
    const result = this.booksService.create(input);
    end();
    return result;
  }
}
