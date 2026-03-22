import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

/**
 * Accepts either JWT (user) or API key (agent) authentication.
 * Sets req.user (JWT) or req.agent (API key) depending on which succeeds.
 */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtAuthGuard,
    private readonly apiKeyGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Try JWT first
    try {
      const jwtResult = await this.jwtGuard.canActivate(context);
      if (jwtResult) return true;
    } catch {}

    // Try API key
    try {
      const apiResult = await this.apiKeyGuard.canActivate(context);
      if (apiResult) return true;
    } catch {}

    return false;
  }
}
