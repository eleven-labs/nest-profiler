import 'reflect-metadata';
import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { DiscoveryService, MetadataScanner, ModuleRef } from '@nestjs/core';
import { HttpRouteSource } from './http-route-source';

class CreatePetDto {
  @IsString()
  name!: string;
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

  const registerRouteSource = jest.fn();
  const moduleRef = {
    get: jest.fn().mockReturnValue({ registerRouteSource }),
  } as unknown as ModuleRef;

  const source = new HttpRouteSource(discovery, scanner, moduleRef);
  return { source, moduleRef, registerRouteSource };
}

const petsWrapper = { instance: new PetsController(), metatype: PetsController };

describe('HttpRouteSource', () => {
  it('discovers REST routes and registers itself with the core at bootstrap', () => {
    const { source, registerRouteSource } = buildSource([petsWrapper]);
    source.onApplicationBootstrap();

    expect(registerRouteSource).toHaveBeenCalledWith(source);
    const group = source.collect();
    expect(group.source).toBe('http');
    expect(group.label).toBe('REST');
    expect(group.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /pets',
      'GET /pets/:id',
    ]);
  });

  it('attaches introspected inputs to each route', () => {
    const { source } = buildSource([petsWrapper]);
    source.onApplicationBootstrap();
    const group = source.collect();

    const create = group.routes.find((r) => r.handler === 'create');
    expect(create?.inputs?.body?.name).toBe('CreatePetDto');

    const findOne = group.routes.find((r) => r.handler === 'findOne');
    expect(findOne?.inputs?.params).toEqual(['id']);
  });

  it('returns an empty group before bootstrap', () => {
    const { source } = buildSource([petsWrapper]);
    expect(source.collect().routes).toEqual([]);
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

    expect(source.collect().routes).toEqual([
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
    expect(source.collect().routes.length).toBe(2);
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

    expect(source.collect().routes.length).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('route-args metadata shape'));
    warn.mockRestore();
  });
});
