import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TokenService, type DemoToken } from '../application/token.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

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
  getToken(@Query('role') role = 'user'): DemoToken {
    return this.tokens.issue(role);
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
