import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const errorResponse = typeof exceptionResponse === 'string'
      ? { error: exceptionResponse, message: exceptionResponse, statusCode: status }
      : { ...(exceptionResponse as object), statusCode: status };

    this.logger.error(`HTTP ${status}: ${JSON.stringify(errorResponse)}`);

    response.status(status).json(errorResponse);
  }
}
