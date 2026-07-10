import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TokenService, type DemoToken } from '../application/token.service.js';
import { JwtAuthGuard, PROFILER_JWT_COOKIE } from './jwt-auth.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly tokens: TokenService) {}

  @Get('token')
  @ApiOperation({ summary: 'Generate a demo JWT (unsigned) — for profiler testing only' })
  @ApiQuery({
    name: 'role',
    required: false,
    example: 'admin',
    enum: ['user', 'admin', 'moderator'],
  })
  @ApiResponse({ status: 200, description: 'Demo JWT token and usage example' })
  getToken(
    @Query('role') role = 'user',
    @Res({ passthrough: true }) res: ServerResponse,
  ): DemoToken {
    const demo = this.tokens.issue(role);
    // Demo convenience: also drop the JWT in a cookie so the profiler's `PROFILER_AUTH=cookie`
    // strategy is testable in a browser — visit this URL once, then browse /_profiler.
    res.setHeader(
      'Set-Cookie',
      `${PROFILER_JWT_COOKIE}=${demo.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`,
    );
    return demo;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth('jwt')
  @ApiOperation({
    summary: 'Protected endpoint — decodes Bearer JWT and captures it in the Security panel',
  })
  @ApiResponse({
    status: 200,
    description: 'Authenticated — check the Security panel in /_profiler',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid Authorization header' })
  getProfile(): Record<string, unknown> {
    return {
      message: 'This endpoint uses JwtAuthGuard. Check the Security tab in /_profiler.',
      hint: 'Use GET /auth/token to get a demo JWT, then pass it as Authorization: Bearer <token>',
    };
  }
}
