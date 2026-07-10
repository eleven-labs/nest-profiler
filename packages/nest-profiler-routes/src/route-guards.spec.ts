import 'reflect-metadata';
import { Controller, Get, Injectable, UseGuards } from '@nestjs/common';
import type { CanActivate } from '@nestjs/common';
import { readRouteGuards } from './route-guards';

@Injectable()
class JwtGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class RolesGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@UseGuards(RolesGuard)
@Controller('admin')
class AdminController {
  @Get('me')
  @UseGuards(JwtGuard)
  me(): void {}

  @Get('open')
  open(): void {}

  // Same guard at the controller and the handler — must be de-duplicated.
  @Get('dup')
  @UseGuards(RolesGuard)
  dup(): void {}

  // Guard registered as an instance rather than a class.
  @Get('instance')
  @UseGuards(new JwtGuard())
  instance(): void {}
}

@Controller('public')
class PublicController {
  @Get()
  list(): void {}
}

describe('readRouteGuards', () => {
  it('collects controller and handler guards (controller first)', () => {
    expect(readRouteGuards(AdminController, 'me')).toEqual(['RolesGuard', 'JwtGuard']);
  });

  it('returns only the controller guard when the handler has none', () => {
    expect(readRouteGuards(AdminController, 'open')).toEqual(['RolesGuard']);
  });

  it('de-duplicates a guard applied at both levels', () => {
    expect(readRouteGuards(AdminController, 'dup')).toEqual(['RolesGuard']);
  });

  it('resolves an instance guard by its constructor name', () => {
    expect(readRouteGuards(AdminController, 'instance')).toEqual(['RolesGuard', 'JwtGuard']);
  });

  it('returns an empty array for an unguarded route', () => {
    expect(readRouteGuards(PublicController, 'list')).toEqual([]);
  });
});
