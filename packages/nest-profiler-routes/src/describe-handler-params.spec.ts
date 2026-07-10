import 'reflect-metadata';
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import {
  describeHandlerParams,
  handlerHasRouteArgs,
  resetClassValidatorStorageCache,
} from './describe-handler-params';

/** Re-requires the module under test after a `jest.doMock('class-validator', …)` in isolation. */
function reloadModule(): typeof import('./describe-handler-params') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./describe-handler-params') as typeof import('./describe-handler-params');
  mod.resetClassValidatorStorageCache();
  return mod;
}

class CreateUserDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsEmail()
  email!: string;

  @IsInt()
  @IsOptional()
  age?: number;
}

class SearchQueryDto {
  @IsString()
  term!: string;

  @IsOptional()
  @IsString()
  sort?: string;
}

@Controller('users')
class UsersController {
  @Get(':id/posts/:postId')
  find(
    @Param('id') _id: string,
    @Param('postId') _postId: string,
    @Query('page') _page: string,
    @Headers('x-tenant') _tenant: string,
  ): void {}

  @Post()
  create(@Body() _dto: CreateUserDto): void {}

  @Get('search')
  search(@Query() _query: SearchQueryDto): void {}

  @Get('plain')
  plain(): void {}

  @Post('raw')
  raw(@Body() _s: string): void {}
}

class EdgeDto {
  @IsOptional()
  maybe?: string;

  @IsString()
  @IsString()
  dup!: string;

  @ValidateNested()
  nested!: CreateUserDto;
}

@Controller('edge')
class EdgeController {
  // Two @Body params — the second must not overwrite the first.
  @Post()
  body(@Body() _a: EdgeDto, @Body() _b: EdgeDto): void {}

  // Same query name twice — the duplicate must be de-duplicated.
  @Get('dup')
  dup(@Query('page') _a: string, @Query('page') _b: string): void {}

  // Whole-object @Query() typed as a primitive — no DTO to expand.
  @Get('rawq')
  rawq(@Query() _q: string): void {}
}

describe('describeHandlerParams', () => {
  beforeEach(() => resetClassValidatorStorageCache());

  it('derives path params from the route path, not the decorator', () => {
    const inputs = describeHandlerParams(UsersController, 'find', '/users/:id/posts/:postId');
    expect(inputs?.params).toEqual(['id', 'postId']);
  });

  it('extracts named query params and headers', () => {
    const inputs = describeHandlerParams(UsersController, 'find', '/users/:id/posts/:postId');
    expect(inputs?.query).toEqual(['page']);
    expect(inputs?.headers).toEqual(['x-tenant']);
  });

  it('introspects the @Body DTO: class name, TS types and class-validator rules', () => {
    const inputs = describeHandlerParams(UsersController, 'create', '/users');
    expect(inputs?.body?.name).toBe('CreateUserDto');

    const props = inputs?.body?.properties ?? [];
    const byName = (name: string) => props.find((p) => p.name === name);

    const name = byName('name');
    expect(name?.tsType).toBe('String');
    expect(name?.rules).toEqual(expect.arrayContaining(['isString', 'minLength']));

    const email = byName('email');
    expect(email?.tsType).toBe('String');
    expect(email?.rules).toEqual(['isEmail']);

    const age = byName('age');
    expect(age?.tsType).toBe('Number');
    expect(age?.optional).toBe(true);
  });

  it('marks @IsOptional properties as optional and does not list it as a rule', () => {
    const inputs = describeHandlerParams(UsersController, 'create', '/users');
    const age = inputs?.body?.properties.find((p) => p.name === 'age');
    expect(age?.optional).toBe(true);
    expect(age?.rules).not.toContain('conditionalValidation');
  });

  it('expands a whole-object @Query() DTO into its property names', () => {
    const inputs = describeHandlerParams(UsersController, 'search', '/users/search');
    expect(inputs?.query).toEqual(expect.arrayContaining(['term', 'sort']));
  });

  it('returns undefined for a handler with no params, query, headers or body', () => {
    expect(describeHandlerParams(UsersController, 'plain', '/users/plain')).toBeUndefined();
  });

  it('ignores a primitive @Body() (no DTO class to introspect)', () => {
    expect(describeHandlerParams(UsersController, 'raw', '/users/raw')).toBeUndefined();
  });

  it('de-duplicates repeated path params', () => {
    const inputs = describeHandlerParams(UsersController, 'plain', '/x/:id/:id');
    expect(inputs?.params).toEqual(['id']);
  });

  it('handles edge DTO metadata: nested rule, duplicate rule and optional-without-rule', () => {
    const inputs = describeHandlerParams(EdgeController, 'body', '/edge');
    const props = inputs?.body?.properties ?? [];
    const byName = (name: string) => props.find((p) => p.name === name);

    // `@IsOptional()` with no other decorator: optional, no rules key.
    expect(byName('maybe')).toEqual({ name: 'maybe', tsType: 'String', optional: true });
    // A repeated validator is listed once.
    expect(byName('dup')?.rules).toEqual(['isString']);
    // `@ValidateNested()` surfaces via its validation type, keeping the DTO class as the TS type.
    expect(byName('nested')).toMatchObject({
      tsType: 'CreateUserDto',
      rules: ['nestedValidation'],
    });
  });

  it('de-duplicates a query param declared twice and ignores a primitive @Query() DTO', () => {
    expect(describeHandlerParams(EdgeController, 'dup', '/edge/dup')?.query).toEqual(['page']);
    expect(describeHandlerParams(EdgeController, 'rawq', '/edge/rawq')).toBeUndefined();
  });

  it('degrades when class-validator has no getMetadataStorage export', () => {
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('class-validator', () => ({}));
      const inputs = reloadModule().describeHandlerParams(UsersController, 'create', '/users');
      expect(inputs?.body?.properties).toEqual([]);
    });
  });

  it('handlerHasRouteArgs reflects whether a handler declared parameter decorators', () => {
    expect(handlerHasRouteArgs(UsersController, 'create')).toBe(true);
    expect(handlerHasRouteArgs(UsersController, 'plain')).toBe(false);
  });

  describe('without class-validator', () => {
    it('degrades a @Body DTO to its class name with no properties', () => {
      jest.resetModules();
      jest.isolateModules(() => {
        jest.doMock('class-validator', () => {
          throw new Error('Cannot find module class-validator');
        });
        const inputs = reloadModule().describeHandlerParams(UsersController, 'create', '/users');
        expect(inputs?.body?.name).toBe('CreateUserDto');
        expect(inputs?.body?.properties).toEqual([]);
      });
    });

    it('degrades gracefully when the metadata storage lookup throws', () => {
      jest.resetModules();
      jest.isolateModules(() => {
        jest.doMock('class-validator', () => ({
          getMetadataStorage: () => ({
            getTargetValidationMetadatas: () => {
              throw new Error('boom');
            },
          }),
        }));
        const inputs = reloadModule().describeHandlerParams(UsersController, 'create', '/users');
        expect(inputs?.body?.name).toBe('CreateUserDto');
        expect(inputs?.body?.properties).toEqual([]);
      });
    });
  });
});
