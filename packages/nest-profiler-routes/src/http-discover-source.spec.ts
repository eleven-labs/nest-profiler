import 'reflect-metadata';
import { Body, Controller, Get, Injectable, Logger, Post, UseGuards } from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { IsString } from 'class-validator';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { HTTP_ENTRYPOINT_TYPE_DEF, HTTP_ICON } from '@eleven-labs/nest-profiler';
import { HttpDiscoverSource } from './http-discover-source';

class CreatePetDto {
  @IsString()
  name!: string;
}

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Controller('pets')
class PetsController {
  @Get(':id')
  findOne(): void {}

  @Post()
  create(@Body() _dto: CreatePetDto): void {}
}

function buildSource(controllers: { instance: object; metatype: unknown }[]) {
  const discovery = {
    getControllers: () => controllers,
  } as Partial<DiscoveryService> as DiscoveryService;

  const scanner = {
    scanFromPrototype: (_instance: object, prototype: object, cb: (name: string) => void) => {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name !== 'constructor') cb(name);
      }
    },
  } as Partial<MetadataScanner> as MetadataScanner;

  const registerDiscoverSource = jest.fn();
  const moduleRef = {
    get: jest.fn().mockReturnValue({ registerDiscoverSource }),
  } as unknown as ModuleRef;

  const source = new HttpDiscoverSource(discovery, scanner, moduleRef);
  return { source, moduleRef, registerDiscoverSource };
}

const petsWrapper = { instance: new PetsController(), metatype: PetsController };

describe('HttpDiscoverSource', () => {
  it('discovers REST routes and registers itself with the core at bootstrap', () => {
    const { source, registerDiscoverSource } = buildSource([petsWrapper]);
    source.onApplicationBootstrap();

    expect(registerDiscoverSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group.source).toBe('http');
    // The protocol is named once: the same label the HTTP list section carries.
    expect(group.label).toBe('HTTP');
    expect(HTTP_ENTRYPOINT_TYPE_DEF.listSection.title).toBe('HTTP');
    // One glyph for the protocol: the REST Discover view and the HTTP list section share it.
    expect(group.icon).toBe(HTTP_ICON);
    expect(HTTP_ENTRYPOINT_TYPE_DEF.listSection.icon).toBe(HTTP_ICON);
    expect(group.entries.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /pets',
      'GET /pets/:id',
    ]);
  });

  it('attaches introspected inputs to each route', () => {
    const { source } = buildSource([petsWrapper]);
    source.onApplicationBootstrap();
    const group = source.collect();

    const create = group.entries.find((r) => r.handler === 'create');
    expect(create?.inputs?.body?.name).toBe('CreatePetDto');

    const findOne = group.entries.find((r) => r.handler === 'findOne');
    expect(findOne?.inputs?.params).toEqual(['id']);
  });

  it('returns an empty group before bootstrap', () => {
    const { source } = buildSource([petsWrapper]);
    expect(source.collect().entries).toEqual([]);
  });

  it('surfaces the guards protecting a route', () => {
    @UseGuards(AuthGuard)
    @Controller('secure')
    class SecureController {
      @Get()
      list(): void {}
    }
    const { source } = buildSource([
      { instance: new SecureController(), metatype: SecureController },
    ]);
    source.onApplicationBootstrap();

    expect(source.collect().entries[0]?.guards).toEqual(['AuthGuard']);
    // Unguarded REST routes carry no `guards` key.
    const { source: pets } = buildSource([petsWrapper]);
    pets.onApplicationBootstrap();
    expect(pets.collect().entries.every((r) => r.guards === undefined)).toBe(true);
  });

  it('normalises the root path to "/" and orders same-path routes by method', () => {
    @Controller()
    class RootController {
      @Get()
      root(): void {}

      @Post()
      submit(): void {}
    }
    const { source } = buildSource([{ instance: new RootController(), metatype: RootController }]);
    source.onApplicationBootstrap();

    expect(source.collect().entries).toEqual([
      { method: 'GET', path: '/', controller: 'RootController', handler: 'root' },
      { method: 'POST', path: '/', controller: 'RootController', handler: 'submit' },
    ]);
  });

  it('does not throw when the core is unavailable', () => {
    const { source, moduleRef } = buildSource([petsWrapper]);
    (moduleRef.get as jest.Mock).mockImplementation(() => {
      throw new Error('ProfilerCoreService not found');
    });
    expect(() => source.onApplicationBootstrap()).not.toThrow();
    expect(source.collect().entries.length).toBe(2);
  });

  it('excludes the profiler UI/API routes from the panel', () => {
    @Controller('_profiler')
    class ProfilerController {
      @Get()
      listProfiles(): void {}

      @Get(':token')
      getProfileDetail(): void {}
    }
    const { source } = buildSource([
      petsWrapper,
      { instance: new ProfilerController(), metatype: ProfilerController },
    ]);
    source.onApplicationBootstrap();

    const group = source.collect();
    expect(group.entries.every((r) => r.controller !== 'ProfilerController')).toBe(true);
    expect(group.entries.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /pets',
      'GET /pets/:id',
    ]);
  });

  it('warns when controllers exist but expose no route-args metadata (shape canary)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    class BareController {}
    const fn = function () {};
    Reflect.defineMetadata('method', 0, fn); // GET, no @Param/@Body/etc.
    Reflect.defineMetadata('path', '', fn);
    (BareController.prototype as Record<string, unknown>)['ping'] = fn;
    Reflect.defineMetadata('path', 'bare', BareController);

    const { source } = buildSource([{ instance: new BareController(), metatype: BareController }]);
    source.onApplicationBootstrap();

    expect(source.collect().entries.length).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('route-args metadata shape'));
    warn.mockRestore();
  });
});
