import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthPayload } from '../types';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
