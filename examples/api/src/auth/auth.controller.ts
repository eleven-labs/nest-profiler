import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Get('token')
  @ApiOperation({ summary: 'Generate a demo JWT (unsigned) — for profiler testing only' })
  @ApiQuery({
    name: 'role',
    required: false,
    example: 'admin',
    enum: ['user', 'admin', 'moderator'],
  })
  @ApiResponse({ status: 200, description: 'Demo JWT token and usage example' })
  getToken(@Query('role') role = 'user'): { token: string; usage: string } {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: '42',
        username: 'demo_user',
        email: 'demo@example.com',
        roles: [role],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.demo_sig_not_verified`;
    return {
      token,
      usage: `curl -H "Authorization: Bearer ${token}" http://localhost:3000/auth/me`,
    };
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
