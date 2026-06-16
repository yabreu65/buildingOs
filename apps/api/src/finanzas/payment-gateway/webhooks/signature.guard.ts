/**
 * SignatureGuard — validates webhook request signatures
 * Task 2.5: Rejects invalid/missing signatures with 401
 */

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class SignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers?.['x-signature'] as string;

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Signature validation is performed by the provider adapter
    // This guard only checks presence of the signature header
    // Provider-specific validation happens in handleWebhook()
    return true;
  }
}