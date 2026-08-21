import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto, ChangeInitialPasswordDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

const AUTH_RATE_LIMIT = process.env['NODE_ENV'] === 'test' ? 1_000_000 : 5;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body);

    if ('accessToken' in result) {
      return result;
    }

    if ('mustChangePassword' in result) {
      res.status(HttpStatus.FORBIDDEN);
      return {
        message: 'You must change your password before continuing',
        mustChangePassword: true,
      };
    }

    if ('locked' in result) {
      res.status(HttpStatus.LOCKED);
      return { message: 'Account locked', retryAfterSeconds: result.retryAfterSeconds };
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid username or password' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } })
  async changeInitialPassword(@Body() body: ChangeInitialPasswordDto) {
    // Excluded from AuthContextMiddleware (like login): accounts flagged needsPasswordUpdate are
    // deliberately issued no tokens, so the client proves ownership with username + current
    // password instead. Only the must-change state is accepted (see AuthService).
    await this.authService.changeInitialPassword(
      body.username,
      body.currentPassword,
      body.newPassword,
    );
    return { success: true };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } })
  async refresh(@Body() body: RefreshTokenDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(body);

    if ('accessToken' in result) {
      return result;
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid or expired refresh token' };
  }
}
